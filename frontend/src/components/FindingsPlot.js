import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { savePrioritization, recommendPositions, askPositionsQuestion } from '../api/wasp-api';
import { navigateToFinding } from '../utils/navigation';
import { getStagingPosition } from '../utils/stagingLayout';
import { getPracticeUrl as resolveUrl } from '../utils/practiceUrls';
import './FindingsPlot.css';

// PLOT_SIZE: width/height of the main 2x2 impact-vs-complexity canvas (px)
const PLOT_SIZE = 600;

// Maps a lens alias to the short prefix used in wa.aws.amazon.com step-anchor URLs.
const LENS_URL_PREFIX = { softwareasaservice: 'saas', serverless: 'serv' };

// Lenses that use the wa.aws.amazon.com step-anchor URL scheme.
const STEP_URL_LENSES = new Set(['softwareasaservice', 'serverless']);

// Normalises a question ID for use in wa.aws.amazon.com URLs.
// e.g. "security_q3" → "SECURITY_3"
const formatQId = (qid) => {
  const m = qid.match(/^(.+)_q(\d+)$/i);
  return m ? `${m[1].toUpperCase()}_${m[2]}` : qid.toUpperCase();
};

// Resolves the URL for an individual best-practice choice within a finding.
// For STEP_URL_LENSES: uses the choice's global index in finding.allChoices to
// build a step-anchor URL. For other lenses: prefers the choice's own
// improvementPlan/helpfulResource URL, then falls back to a choice-ID page.
const getPracticeUrl = (practice, finding, stepIdx) => {
  const lens = finding.lensAlias || 'wellarchitected';
  if (STEP_URL_LENSES.has(lens)) {
    let version = finding.lensVersion || 'latest';
    if (finding.improvementPlanUrl) {
      const versionMatch = finding.improvementPlanUrl.match(/wa\.aws\.amazon\.com\/[^/]+\/([^/]+)\//);
      if (versionMatch) version = versionMatch[1];
    }
    const prefix = LENS_URL_PREFIX[lens] || lens;
    const fmtId = formatQId(finding.questionId);
    const allChoices = finding.allChoices || [];
    const globalIndex = allChoices.findIndex(c => c.choiceId === practice.choiceId);
    const step = globalIndex !== -1 ? globalIndex : stepIdx;
    return `https://wa.aws.amazon.com/${lens}/${version}/${prefix}.question.${fmtId}.en.html#step${step + 1}`;
  }
  if (practice.improvementPlan && practice.improvementPlan.Url) {
    return practice.improvementPlan.Url;
  }
  if (practice.helpfulResource && practice.helpfulResource.Url) {
    return practice.helpfulResource.Url;
  }
  if (practice.choiceId) {
    return `https://docs.aws.amazon.com/wellarchitected/latest/framework/${practice.choiceId}.html`;
  }
  return null;
};

// Returns the display title for a best-practice choice.
// Choices from the answers API have a 'title' field; fall back to choiceId.
const getPracticeTitle = (practice) => practice.title || practice.choiceId || 'Best practice';

function FindingsPlot({ workload, findings: propFindings, setActivePage, plotPositions, setPlotPositions, riskFilter, setRiskFilter, completedItems, setCompletedItems, aiMode = false, aiModel = '', aiSummaries = {}, businessSummary = '' }) {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(null);
  const [highlightedFinding, setHighlightedFinding] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showRecommendConfirm, setShowRecommendConfirm] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [positionReasons, setPositionReasons] = useState('');
  const [posQaHistory, setPosQaHistory] = useState([]);
  const [posQaInput, setPosQaInput] = useState('');
  const [posQaLoading, setPosQaLoading] = useState(false);
  const plotRef = useRef(null);
  const keyRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    if (propFindings && propFindings.length > 0) {
      const filtered = propFindings.filter(
        f => f.risk === 'high' || f.risk === 'medium'
      );
      filtered.sort((a, b) => {
        const aReset = completedItems[`${workload.storageKey}-${a.questionId}`]?.wasReset ? 1 : 0;
        const bReset = completedItems[`${workload.storageKey}-${b.questionId}`]?.wasReset ? 1 : 0;
        return aReset - bReset;
      });
      setFindings(filtered);
      setLoading(false);
    }
  }, [propFindings, workload.storageKey, completedItems]);

  // Track latest values for saves
  const latestStateRef = useRef({ plotPositions, riskFilter, completedItems, hasChanges });
  useEffect(() => {
    latestStateRef.current = { plotPositions, riskFilter, completedItems, hasChanges };
  }, [plotPositions, riskFilter, completedItems, hasChanges]);

  // Debounced auto-save: rather than writing to the DB on every drag event (which fires
  // dozens of times per second), we wait until the user has been idle for 3 seconds.
  // Each state change resets the timer, so only the final resting position is persisted.
  // latestStateRef is used inside the timeout callback so it always reads the most recent
  // values without needing those values as effect dependencies (which would restart the
  // timer on every render instead of only when hasChanges flips).
  useEffect(() => {
    if (!hasChanges) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const { plotPositions: pos, riskFilter: rf, completedItems: ci } = latestStateRef.current;
      if (Object.keys(pos).length === 0) return;
      try {
        setIsSaving(true);
        await savePrioritization(workload.storageKey, {
          plotPositions: pos,
          riskFilter: rf,
          completedItems: ci
        });
        setHasChanges(false);
        setIsSaving(false);
      } catch (err) {
        console.error('Failed to auto-save:', err);
        setIsSaving(false);
      }
    }, 3000);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasChanges, plotPositions]);

  // Save on unmount
  useEffect(() => {
    return () => {
      const { plotPositions: pos, riskFilter: rf, completedItems: ci, hasChanges: hc } = latestStateRef.current;
      if (hc && Object.keys(pos).length > 0) {
        savePrioritization(workload.storageKey, {
          plotPositions: pos,
          riskFilter: rf,
          completedItems: ci
        }).catch(err => console.error('Failed to save on unmount:', err));
      }
    };
  }, [workload.storageKey]);

  const handleMouseDown = (e, questionId) => {
    e.preventDefault();
    const currentPos = plotPositions[questionId];
    setDragging({ questionId, originalPosition: currentPos ? { x: currentPos.x, y: currentPos.y, staged: currentPos.staged } : null });
    setHighlightedFinding(questionId);
    
    if (keyRef.current) {
      const keyItem = keyRef.current.querySelector(`[data-finding-id="${questionId}"]`);
      if (keyItem) {
        keyItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!dragging || !plotRef.current) return;

    const rect = plotRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left - 20;
    let y = e.clientY - rect.top - 20;

    x = Math.max(0, Math.min(x, 810));
    y = Math.max(0, Math.min(y, 740));

    const staged = x > 600 && y <= 600;
    const completed = y > 600 && x <= 600;

    setPlotPositions(prev => ({
      ...prev,
      [dragging.questionId]: { x, y, staged, completed }
    }));
    setHasChanges(true);
  };

  const handleMouseUp = async () => {
    if (dragging) {
      const pos = plotPositions[dragging.questionId];
      
      // The completed zone is the horizontal strip below y=600 and within x<=600.
      // When a circle is dropped there we create a completedItems entry so the
      // ImplementationPlan knows to include it in the next milestone.
      // Conversely, if the user drags it back out of the completed zone we remove
      // the entry — but only if it hasn't been locked into a milestone yet
      // (milestoneNumber present) and hasn't been explicitly reset (wasReset flag).
      if (pos && pos.completed) {
        const finding = findings.find(f => f.questionId === dragging.questionId);
        if (finding) {
          const itemKey = `${workload.storageKey}-${finding.questionId}`;
          
          if (!completedItems[itemKey]) {
            const newCompletedItems = {
              ...completedItems,
              [itemKey]: {
                completedAt: new Date().toISOString(),
                questionId: finding.questionId,
                questionTitle: finding.questionTitle,
                pillar: finding.pillar,
                lensAlias: finding.lensAlias || 'wellarchitected',
                originalPosition: dragging.originalPosition || null
              }
            };
            
            setCompletedItems(newCompletedItems);
            setHasChanges(true);
          }
        }
      }
      else if (pos && !pos.completed) {
        const finding = findings.find(f => f.questionId === dragging.questionId);
        if (finding) {
          const itemKey = `${workload.storageKey}-${finding.questionId}`;
          
          if (completedItems[itemKey] && !completedItems[itemKey].milestoneNumber && !completedItems[itemKey].wasReset) {
            const newCompletedItems = { ...completedItems };
            delete newCompletedItems[itemKey];
            setCompletedItems(newCompletedItems);
            setHasChanges(true);
          }
        }
      }
      
      setDragging(null);
      setHighlightedFinding(null);
    }
  };

  const handleReset = async () => {
    if (window.confirm('Are you sure you want to reset all findings back to the staging area? This will clear all your current positioning.')) {
      const positions = {};
      findings.forEach((finding, index) => {
        positions[finding.questionId] = getStagingPosition(index);
      });
      
      setPlotPositions(positions);
      setHasChanges(true);
      
      try {
        await savePrioritization(workload.storageKey, {
          plotPositions: positions,
          riskFilter,
          completedItems
        });
        setHasChanges(false);
      } catch (err) {
        console.error('Failed to save reset positions:', err);
      }
    }
  };

  const handleRecommendPositions = async () => {
    setShowRecommendConfirm(false);
    setIsRecommending(true);
    try {
      // Build findings with AI summaries for the model
      const findingsData = findings.map(f => {
        // Match AI summaries by resolving URLs the same way ImprovementPlan does
        const bpSummaries = (f.bestPractices || []).map((bp, idx) => {
          const url = resolveUrl(bp, f, idx) || '';
          return url ? aiSummaries[url] || '' : '';
        }).filter(Boolean);

        return {
          questionId: f.questionId,
          questionTitle: f.questionTitle,
          pillar: f.pillar,
          risk: f.risk,
          aiSummary: bpSummaries.join(' '),
          bestPractices: (f.bestPractices || []).map(bp => ({
            title: bp.title || bp.choiceId || '',
          })),
        };
      });

      const result = await recommendPositions(aiModel, businessSummary, findingsData);

      // Apply the recommended positions
      // The AI may return question IDs with pillar prefixes (e.g. "sec_network-protection")
      // so we need to match flexibly against the actual position keys
      const newPositions = { ...plotPositions };
      let applied = 0;
      const positionKeys = new Set(Object.keys(newPositions));

      for (const rec of result.positions) {
        let matchedKey = null;
        let recId = rec.questionId;
        
        // AI may return "Pillar (questionId)" format — extract the ID from parentheses
        const parenMatch = recId.match(/\(([^)]+)\)/);
        if (parenMatch) {
          recId = parenMatch[1];
        }
        
        if (positionKeys.has(recId)) {
          // Exact match
          matchedKey = recId;
        } else {
          // Try stripping a prefix the model may have added (e.g. "sec_" from "sec_network-protection")
          const stripped = recId.replace(/^[a-z]+_/, '');
          if (positionKeys.has(stripped)) {
            matchedKey = stripped;
          } else {
            // Try finding a position key that ends with the AI's ID or vice versa
            for (const key of positionKeys) {
              if (key.endsWith(recId) || recId.endsWith(key) || key.includes(recId) || recId.includes(key)) {
                matchedKey = key;
                break;
              }
            }
          }
        }
        if (matchedKey) {
          newPositions[matchedKey] = {
            x: Math.max(0, Math.min(580, rec.x)),
            y: Math.max(0, Math.min(580, rec.y)),
            staged: false,
            completed: false,
          };
          applied++;
        }
      }

      if (applied === 0) {
        alert('The model returned positions but none matched your findings. Try a different model.');
        setIsRecommending(false);
        return;
      }

      setPlotPositions(newPositions);
      setHasChanges(true);

      // Store full position data for Q&A (not displayed directly)
      // Include the display number (1-based index) so users can ask "why is 7 more impactful than 8"
      // Pre-compute quadrant names so the model doesn't misinterpret the y axis
      const getQuadrant = (x, y) => {
        if (x > 300 && y > 300) return 'Quick Win';
        if (x > 300 && y <= 300) return 'Strategic Initiative (Major Task)';
        if (x <= 300 && y > 300) return 'Incremental Task';
        return 'Low Priority';
      };

      const positionData = result.positions
        .map(r => {
          const displayIdx = findings.findIndex(f => f.questionId === r.questionId || f.questionId.endsWith(r.questionId) || r.questionId.endsWith(f.questionId));
          const num = displayIdx >= 0 ? displayIdx + 1 : '?';
          const finding = displayIdx >= 0 ? findings[displayIdx] : null;
          const title = finding ? finding.questionTitle : r.questionId;
          const quadrant = getQuadrant(r.x, r.y);
          return `#${num} "${title}": Quadrant=${quadrant}, Impact=${r.x > 300 ? 'High' : 'Low'} (x=${r.x}), Complexity=${r.y <= 300 ? 'High' : 'Low'} (y=${r.y})${r.reason ? ', Reason: ' + r.reason : ''}`;
        })
        .join('\n');
      
      // Also store the findings text for full context
      const findingsText = findingsData.map((f, i) => {
        const bpTitles = (f.bestPractices || []).map(bp => bp.title).filter(Boolean).join('; ');
        let text = `#${i + 1} [${f.risk.toUpperCase()}] ${f.pillar} (${f.questionId}): ${f.questionTitle}`;
        if (bpTitles) text += `\n  Remediation: ${bpTitles}`;
        if (f.aiSummary) text += `\n  AI Summary: ${f.aiSummary}`;
        return text;
      }).join('\n');

      setPositionReasons(positionData + '\n\nFindings Detail:\n' + findingsText);
      setPosQaHistory([]);

      // Auto-save
      try {
        await savePrioritization(workload.storageKey, {
          plotPositions: newPositions,
          riskFilter,
          completedItems
        });
        setHasChanges(false);
      } catch (err) {
        console.error('Failed to save recommended positions:', err);
      }
    } catch (err) {
      console.error('Failed to get AI recommendations:', err);
      alert('Failed to get AI recommendations: ' + (err.details || err.message));
    } finally {
      setIsRecommending(false);
    }
  };

  const handleAskPositions = async (e) => {
    e.preventDefault();
    const question = posQaInput.trim();
    if (!question || !positionReasons) return;

    setPosQaHistory(prev => [...prev, { type: 'question', text: question }]);
    setPosQaInput('');
    setPosQaLoading(true);

    try {
      const result = await askPositionsQuestion(aiModel, question, businessSummary, positionReasons);
      setPosQaHistory(prev => [...prev, { type: 'answer', text: result.answer }]);
    } catch (err) {
      setPosQaHistory(prev => [...prev, { type: 'error', text: err.details || err.message || 'Failed to get answer' }]);
    } finally {
      setPosQaLoading(false);
    }
  };

  const toggleRiskFilter = (riskLevel) => {
    setRiskFilter(prev => ({
      ...prev,
      [riskLevel]: !prev[riskLevel]
    }));
    setHasChanges(true);
  };

  // Filtering rules (applied in order):
  //   1. Items with wasReset=true are always shown — they were un-completed and need
  //      to be re-prioritized, so hiding them based on risk level would lose them.
  //   2. Respect the high/medium risk toggles from the UI.
  //   3. Drop anything that isn't high or medium risk (e.g. "none" or "unanswered").
  //   4. Hide items that have been locked into a prior milestone (milestoneNumber set)
  //      unless they were subsequently reset — those belong in the prior-milestones
  //      section of the ImplementationPlan, not on the active plot.
  const filteredFindings = useMemo(() => findings.filter(finding => {
    const risk = finding.risk.toLowerCase();
    const itemKey = `${workload.storageKey}-${finding.questionId}`;
    const completed = completedItems[itemKey];
    // Include reset items regardless of risk level
    if (completed && completed.wasReset) return true;
    if (risk === 'high' && !riskFilter.high) return false;
    if (risk === 'medium' && !riskFilter.medium) return false;
    if (risk !== 'high' && risk !== 'medium') return false;
    if (completed && completed.milestoneNumber && !completed.wasReset) return false;
    return true;
  }), [findings, completedItems, workload.storageKey, riskFilter]);

  useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, plotPositions]);

  useEffect(() => {
    // Draw canvas after findings are loaded
    if (!loading && findings.length > 0) {
      // Small delay to ensure canvas is rendered
      setTimeout(() => drawCanvas(), 100);
    }
  }, [loading, findings]);

  const drawCanvas = () => {
    const canvas = document.getElementById('plot-canvas');
    if (!canvas) {
      return;
    }
    
    const ctx = canvas.getContext('2d');
    canvas.width = PLOT_SIZE;
    canvas.height = PLOT_SIZE;
    
    // Set canvas style to match dimensions
    canvas.style.width = `${PLOT_SIZE}px`;
    canvas.style.height = `${PLOT_SIZE}px`;
    
    // Draw quadrant backgrounds (each quadrant is PLOT_SIZE/2 square)
    const half = PLOT_SIZE / 2;
    ctx.fillStyle = 'rgba(144, 238, 144, 0.15)'; // Light green — quick wins
    ctx.fillRect(half, half, half, half);
    
    ctx.fillStyle = 'rgba(173, 216, 230, 0.15)'; // Light blue — major tasks
    ctx.fillRect(half, 0, half, half);
    
    ctx.fillStyle = 'rgba(255, 255, 224, 0.15)'; // Light yellow — incremental
    ctx.fillRect(0, half, half, half);
    
    ctx.fillStyle = 'rgba(255, 192, 203, 0.15)'; // Light pink — low priority
    ctx.fillRect(0, 0, half, half);
    
    // Draw grid lines
    ctx.strokeStyle = '#232F3E';
    ctx.lineWidth = 2;
    
    // Vertical center line
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, PLOT_SIZE);
    ctx.stroke();
    
    // Horizontal center line
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(PLOT_SIZE, half);
    ctx.stroke();
    
    // Draw quadrant labels
    ctx.fillStyle = '#232F3E';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    
    ctx.fillText('Low priority', half / 2, 30);
    ctx.fillText('Major tasks', half + half / 2, 30);
    ctx.fillText('Incremental tasks', half / 2, PLOT_SIZE - 10);
    ctx.fillText('Quick wins', half + half / 2, PLOT_SIZE - 10);
    
    // Draw axis labels
    ctx.fillStyle = '#687078';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    
    // X-axis labels (left = Low Impact, right = High Impact)
    ctx.fillText('Low', 50, half + 15);
    ctx.fillText('Impact', 50, half + 28);
    ctx.fillText('High', PLOT_SIZE - 50, half + 15);
    ctx.fillText('Impact', PLOT_SIZE - 50, half + 28);
    
    // Y-axis labels (top = High Complexity, bottom = Low Complexity)
    ctx.save();
    ctx.translate(half + 15, 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('High', 0, 0);
    ctx.restore();
    
    ctx.save();
    ctx.translate(half + 28, 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Complexity', 0, 0);
    ctx.restore();
    
    ctx.save();
    ctx.translate(half + 15, PLOT_SIZE - 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Low', 0, 0);
    ctx.restore();
    
    ctx.save();
    ctx.translate(half + 28, PLOT_SIZE - 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Complexity', 0, 0);
    ctx.restore();
  };

  if (loading) {
    return <div className="findings-plot loading">Loading findings...</div>;
  }

  if (findings.length === 0) {
    return (
      <div className="findings-plot empty">
        <h3>✅ No Findings</h3>
        <p>This workload has no high or medium risk findings. Great job!</p>
      </div>
    );
  }

  return (
    <div className="findings-plot-container">
      {showRecommendConfirm && (
        <div className="recommend-overlay">
          <div className="recommend-dialog">
            <h3>Recommend Positions</h3>
            <p>AI will analyse all findings and recommend where each should be positioned on the matrix. This will overwrite all current positions.</p>
            <p className="ai-disclaimer" style={{ margin: '1rem 0' }}>AI-generated for informational purposes only. Generative AI can make mistakes — please double-check the output.</p>
            <div className="recommend-dialog-actions">
              <button className="btn btn-primary" onClick={handleRecommendPositions}>Confirm</button>
              <button className="btn btn-secondary" onClick={() => setShowRecommendConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <h2>Prioritise Findings</h2>
      
      <div className="instructions-box">
        <h3>📋 How to Use This Analysis</h3>
        <p><strong>Your Task:</strong> Position each finding on the Eisenhower-style matrix below based on two factors:</p>
        <ul>
          <li><strong>Impact (X-axis):</strong> How much business value or risk reduction will this provide?</li>
          <li><strong>Complexity (Y-axis):</strong> How difficult or time-consuming will this be to implement?</li>
        </ul>
        <p><strong>Instructions:</strong></p>
        <ol>
          <li>Review each finding in the key on the right</li>
          <li>Drag the numbered circles to position them on the plot, or click "Recommend Positions" (AI Mode) to let AI place them for you</li>
          <li>Use the checkboxes to filter by risk level</li>
          <li>Click "Generate Implementation Plan" when done to create your prioritized action plan</li>
        </ol>
        <p><strong>Quadrants:</strong> Top-right = High Impact, High Complexity (strategic initiatives). Bottom-right = High Impact, Low Complexity (quick wins).</p>
      </div>

      <div className="risk-filter">
        <label>Show Risk Levels:</label>
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={riskFilter.high}
            onChange={() => toggleRiskFilter('high')}
          />
          <span className="high-risk-text">High Risk</span>
        </label>
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={riskFilter.medium}
            onChange={() => toggleRiskFilter('medium')}
          />
          <span className="medium-risk-text">Medium Risk</span>
        </label>
        <button 
          className="btn-reset"
          onClick={handleReset}
          title="Reset all findings to staging area"
          style={{ marginLeft: 'auto' }}
        >
          🔄 Reset Positions
        </button>
        {aiMode && aiModel && (
          <button
            className="btn-recommend"
            onClick={() => setShowRecommendConfirm(true)}
            disabled={isRecommending}
            title="Let AI recommend positions based on the business summary"
            style={{ marginLeft: '0.5rem' }}
          >
            {isRecommending ? '⏳ Recommending...' : '🤖 Recommend Positions'}
          </button>
        )}
        {hasChanges && !isSaving && (
          <span style={{ marginLeft: '1rem', color: '#FF9900', fontSize: '14px', fontWeight: 'bold' }}>
            ● Unsaved changes
          </span>
        )}
        {isSaving && (
          <span style={{ marginLeft: '1rem', color: '#FF9900', fontSize: '14px', fontWeight: 'bold' }}>
            ● Saving...
          </span>
        )}
      </div>

      <p className="help-text">
        Drag numbered circles on the plot to position by Impact (x-axis) vs Complexity (y-axis)
      </p>
      
      <div className="plot-wrapper">
        <div className="plot-area" ref={plotRef} style={{ position: 'relative', width: '850px', height: '740px', border: '2px solid #D5DBDB', borderRadius: '8px', background: 'white', display: 'flex', flexDirection: 'column' }}>
          {/* Top section with plot and staging area */}
          <div style={{ display: 'flex', height: '600px' }}>
            {/* Main plot canvas - 600px */}
            <div style={{ position: 'relative', width: '600px', height: '600px', borderRight: '2px dashed #D5DBDB' }}>
              <canvas id="plot-canvas" style={{ position: 'absolute', top: 0, left: 0, width: '600px', height: '600px' }}></canvas>
            </div>
            
            {/* Staging area - 250px */}
            <div style={{ position: 'relative', width: '250px', height: '600px', background: '#f9f9f9', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '20px' }}>
              <div style={{ fontSize: '12px', color: '#687078', marginBottom: '20px', textAlign: 'center', padding: '0 10px' }}>
                <strong>Drag to Plot</strong>
                <br />
                <span style={{ fontSize: '11px' }}>Position by Impact vs Complexity</span>
              </div>
            </div>
          </div>
          
          {/* Completed area - horizontal section below plot */}
          <div className="completed-area" style={{ position: 'relative', width: '600px', height: '140px', background: '#f9f9f9', borderTop: '2px dashed #D5DBDB', display: 'flex', alignItems: 'flex-start', paddingLeft: '20px', paddingTop: '20px' }}>
            <div style={{ fontSize: '12px', color: '#687078', textAlign: 'left', marginRight: '30px', flexShrink: 0, maxWidth: '200px' }}>
              <strong>Previously Completed Since Last Milestone</strong>
              <br />
              <span style={{ fontSize: '11px' }}>Drag completed items here</span>
            </div>
          </div>
          
          {/* All draggable circles */}
          <div className="plot-items" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {filteredFindings.map((finding, displayIndex) => {
              const pos = plotPositions[finding.questionId] || { x: 620, y: 80 + (displayIndex * 55), staged: true, completed: false };
              return (
                <div
                  key={finding.questionId}
                  className={`plot-circle ${finding.risk === 'unanswered' ? 'medium' : finding.risk.toLowerCase()}`}
                  style={{ 
                    left: `${pos.x}px`, 
                    top: `${pos.y}px`,
                    pointerEvents: 'auto',
                    opacity: pos.staged ? 0.7 : (pos.completed ? 0.6 : 1)
                  }}
                  onMouseDown={(e) => handleMouseDown(e, finding.questionId)}
                  title={`${finding.questionId} - ${finding.questionTitle}`}
                >
                  {displayIndex + 1}
                </div>
              );
            })}
          </div>
        </div>

        <div className="findings-key" ref={keyRef}>
          <h4>Findings Key</h4>
          <div className="key-list">
            {filteredFindings.map((finding, displayIndex) => {
              const isHighlighted = highlightedFinding === finding.questionId;
              
              return (
                <div 
                  key={finding.questionId} 
                  className={`key-item ${isHighlighted ? 'highlighted' : ''}`}
                  data-finding-id={finding.questionId}
                >
                  <span className={`key-number ${finding.risk === 'unanswered' ? 'medium' : finding.risk.toLowerCase()}`}>
                    {displayIndex + 1}
                  </span>
                  <div className="key-content">
                    <div className="key-header">
                      <span className="key-id">{finding.questionId}</span>
                      {' '}
                      <span className="key-title">{finding.questionTitle}</span>
                    </div>
                    <div className="key-details">
                      <p className="key-recommendation">
                        <strong>Recommendation:</strong>{' '}
                        {finding.bestPractices && finding.bestPractices.length > 0 ? (
                          finding.bestPractices.map((practice, idx) => {
                            const practiceUrl = getPracticeUrl(practice, finding, idx);
                            const practiceTitle = getPracticeTitle(practice);
                            
                            return (
                              <React.Fragment key={idx}>
                                {idx > 0 && ', '}
                                {practiceUrl ? (
                                  <a href={practiceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#FF9900' }}>
                                    {practiceTitle}
                                  </a>
                                ) : (
                                  <span>{practiceTitle}</span>
                                )}
                              </React.Fragment>
                            );
                          })
                        ) : (
                          'Implement AWS Well-Architected best practices for this question'
                        )}
                      </p>
                      <p className="key-link">
                        → <button 
                          className="btn-link-inline"
                          onClick={() => navigateToFinding(finding.questionId, setActivePage)}
                        >
                          View in Improvement Plan
                        </button>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {positionReasons && aiMode && (
        <div className="section positions-qa-section">
          <h3>Ask about the recommendations</h3>
          <p className="ai-disclaimer">AI-generated for informational purposes only. Generative AI can make mistakes — please double-check the output.</p>
          <div className="qa-history">
            {posQaHistory.map((item, i) => (
              <div key={i} className={`qa-bubble qa-${item.type}`}>
                {item.type === 'answer' ? <ReactMarkdown>{item.text}</ReactMarkdown> : <p>{item.text}</p>}
              </div>
            ))}
            {posQaLoading && (
              <div className="qa-bubble qa-answer qa-thinking">
                <div className="summary-spinner" />
                <span>Thinking...</span>
              </div>
            )}
          </div>
          <form className="qa-form" onSubmit={handleAskPositions}>
            <input
              type="text"
              className="qa-input"
              value={posQaInput}
              onChange={(e) => setPosQaInput(e.target.value)}
              placeholder="Ask about why a finding was placed where it is..."
              disabled={posQaLoading}
              aria-label="Ask about position recommendations"
            />
            <button type="submit" className="btn btn-primary" disabled={posQaLoading || !posQaInput.trim()}>
              Ask
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default FindingsPlot;
