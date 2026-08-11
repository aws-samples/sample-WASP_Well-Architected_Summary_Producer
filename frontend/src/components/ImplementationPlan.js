import { useState, useEffect } from 'react';
import { createMilestone, updateAnswer, savePrioritization } from '../api/wasp-api';
import { navigateToFinding } from '../utils/navigation';
import { getStagingPosition, COMPLETED_Y, COLUMN_WIDTH } from '../utils/stagingLayout';
import './ImplementationPlan.css';

function ImplementationPlan({ workload, findings: propFindings, setActivePage, plotPositions, setPlotPositions, completedItems = {}, setCompletedItems, reloadLens }) {
  const [creating, setCreating] = useState(false);
  const [milestone, setMilestone] = useState(null);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  // pendingResets holds questions the user wants to un-complete before the next milestone.
  // They're staged here (not applied immediately) so the user can review and undo them.
  // On milestone creation, each entry triggers an AWS answer reset and the item is moved
  // back to the staging area with a wasReset=true marker so it re-enters the active workflow.
  const [pendingResets, setPendingResets] = useState({});

  const navigateToPlot = (questionId) => {
    setActivePage('findings');
    
    setTimeout(() => {
      const keyItem = document.querySelector(`[data-finding-id="${questionId}"]`);
      if (keyItem) {
        keyItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        keyItem.style.backgroundColor = '#fff3cd';
        setTimeout(() => {
          keyItem.style.backgroundColor = '';
        }, 2000);
      }
    }, 100);
  };

  // Self-healing: runs once per lens load via App.js (not here)
  // Moved to App.js to prevent re-running on tab switches

  useEffect(() => {
    generatePlan();
  }, [workload.storageKey, propFindings, plotPositions, completedItems]);

  // Note: Plot positions are managed by FindingsPlot. ImplementationPlan only reads them.
  // Auto-save is handled by FindingsPlot. ImplementationPlan only saves explicitly
  // (milestone creation, toggle complete).

  const generatePlan = () => {
    const allFindings = propFindings.filter(f => f.risk === 'high' || f.risk === 'medium');
    // wasReset items go to the end so they don't displace the active findings' display numbers
    allFindings.sort((a, b) => {
      const aReset = completedItems[`${workload.storageKey}-${a.questionId}`]?.wasReset ? 1 : 0;
      const bReset = completedItems[`${workload.storageKey}-${b.questionId}`]?.wasReset ? 1 : 0;
      return aReset - bReset;
    });
    
    // Determine current lens from findings
    const currentLens = allFindings.length > 0 ? (allFindings[0].lensAlias || 'wellarchitected') : 'wellarchitected';
    
    const seenQuestionIds = new Set();
    
    const categorized = {
      quickWins: [],
      majorTasks: [],
      incremental: [],
      lowPriority: [],
      completedSinceLastMilestone: [],
      completedInPriorMilestones: []
    };
    
    // Categorize each finding by its quadrant on the 600×600 plot.
    // The plot origin is top-left, so:
    //   x > 300 → right half → High Impact
    //   y > 300 → bottom half → Low Complexity  (y increases downward)
    // Quadrant mapping:
    //   High Impact + Low Complexity  → Quick Wins   (bottom-right)
    //   High Impact + High Complexity → Major Tasks  (top-right)
    //   Low Impact  + Low Complexity  → Incremental  (bottom-left)
    //   Low Impact  + High Complexity → Low Priority (top-left)
    allFindings.forEach((finding, displayIndex) => {
      const pos = plotPositions[finding.questionId];
      seenQuestionIds.add(finding.questionId);
      
      const findingWithPos = {
        ...finding,
        number: displayIndex + 1,
        position: pos || { x: 0, y: 0, staged: true, completed: false },
        // 300 = half of the 600px plot — right half = High Impact, bottom half = Low Complexity
        impact: pos && pos.x > 300 ? 'High' : 'Low',
        complexity: pos && pos.y > 300 ? 'Low' : 'High'
      };
      
      const itemKey = `${workload.storageKey}-${finding.questionId}`;
      const completedItem = completedItems[itemKey];
      const isCompletedByPosition = pos && (pos.completed === true || pos.y > 600);
      
      // Items locked into a prior milestone go to their own section
      if (completedItem && completedItem.milestoneNumber && !completedItem.wasReset) {
        categorized.completedInPriorMilestones.push(findingWithPos);
        return;
      }
      
      // Items completed since last milestone (checkbox or drag) stay in their
      // quadrant so they don't vanish — they also appear in the completed summary.
      // We track them in completedSinceLastMilestone for the milestone creation flow.
      const isCompletedSinceLastMilestone = (completedItem && !completedItem.wasReset) || isCompletedByPosition;
      if (isCompletedSinceLastMilestone) {
        categorized.completedSinceLastMilestone.push(findingWithPos);
      }
      
      if (!pos || pos.staged) return;
      
      // Use the ORIGINAL plot position for quadrant categorization, not the
      // completed-zone position. This keeps the item visible in its quadrant.
      const originalPos = (isCompletedSinceLastMilestone && completedItem)
        ? (completedItem.originalPosition || pos)
        : pos;
      const impact = originalPos.x > 300 ? 'High' : 'Low';
      const complexity = originalPos.y > 300 ? 'Low' : 'High';
      
      if (impact === 'High' && complexity === 'Low') {
        categorized.quickWins.push(findingWithPos);
      } else if (impact === 'High' && complexity === 'High') {
        categorized.majorTasks.push(findingWithPos);
      } else if (impact === 'Low' && complexity === 'Low') {
        categorized.incremental.push(findingWithPos);
      } else {
        categorized.lowPriority.push(findingWithPos);
      }
    });
    
    // Add completed items that are no longer in the findings list (same lens only)
    Object.entries(completedItems).forEach(([itemKey, completedItem]) => {
      if (!completedItem.milestoneNumber || completedItem.wasReset) return;
      if ((completedItem.lensAlias || 'wellarchitected') !== currentLens) return;
      
      const questionId = completedItem.questionId;
      if (!questionId) return;
      if (seenQuestionIds.has(questionId)) return;
      
      categorized.completedInPriorMilestones.push({
        questionId: completedItem.questionId,
        questionTitle: completedItem.questionTitle,
        number: questionId,
        position: { x: 0, y: 0, staged: false, completed: true },
        impact: 'N/A',
        complexity: 'N/A',
        risk: 'resolved',
        pillar: completedItem.pillar || 'Reliability',
        lensAlias: completedItem.lensAlias || currentLens,
        bestPractices: []
      });
    });
    
    Object.keys(categorized).forEach(key => {
      categorized[key].sort((a, b) => (b.position?.x || 0) - (a.position?.x || 0));
    });
    
    setPlan(categorized);
  };

  // handleCreateMilestone is a multi-step atomic-ish operation:
  //   Step 1 — Select all best practices in AWS for each item completed since the last milestone.
  //            This ensures the WAFR review reflects the work done before the snapshot is taken.
  //   Step 2 — For any pendingResets, restore the question's previous answer state in AWS
  //            (or clear it entirely if there was no prior selection). This un-completes the
  //            question so it reappears as an active finding after the milestone.
  //   Step 3 — Create the AWS milestone, which snapshots the current review state.
  //   Step 4 — Update local state: stamp completed items with the new milestone number,
  //            move reset items back to the staging area, persist everything to DynamoDB.
  //   The 2-second pause between steps 1/2 and step 3 gives AWS time to process the
  //   answer updates before the milestone snapshot is taken.
  const handleCreateMilestone = async () => {
    setCreating(true);
    setError(null);
    
    try {
      const itemsToProcess = plan.completedSinceLastMilestone;
      const hasResets = Object.keys(pendingResets).length > 0;
      const pendingResetsSnapshot = { ...pendingResets }; // Capture before any state changes
      
      if (itemsToProcess.length === 0 && !hasResets) {
        setError('No items completed since last milestone and no items to reset.');
        setCreating(false);
        return;
      }
      
      // Step 1: For each completed item, select all best practices in AWS
      const previouslySelectedMap = {}; // Store previous selections for potential reset
      if (itemsToProcess.length > 0) {
        for (const finding of itemsToProcess) {
          try {
            const allChoiceIds = finding.bestPractices
              .map(bp => bp.choiceId)
              .filter(id => {
                if (!id) return false;
                const lowerCaseId = id.toLowerCase();
                if (lowerCaseId.endsWith('_no') || lowerCaseId === 'no_choice' || lowerCaseId === 'none') return false;
                const practice = finding.bestPractices.find(bp => bp.choiceId === id);
                if (practice && practice.title) {
                  const lowerTitle = practice.title.toLowerCase();
                  if (lowerTitle.includes('none of') || lowerTitle.includes('not applicable')) return false;
                }
                return true;
              });
            
            if (allChoiceIds.length > 0) {
              const lensAlias = finding.lensAlias || 'wellarchitected';
              // Save previously selected choices (allChoices minus unselected = previously selected)
              const allChoiceSet = new Set((finding.allChoices || []).map(c => c.choiceId));
              const unselectedSet = new Set(allChoiceIds);
              previouslySelectedMap[finding.questionId] = [...allChoiceSet].filter(id => !unselectedSet.has(id));
              
              await updateAnswer(workload.workloadId, finding.questionId, allChoiceIds, lensAlias);
            }
          } catch (err) {
            console.error(`Failed to update ${finding.questionId}:`, err.message);
          }
        }
      }
      
      // Step 2: For each pending reset, deselect all choices in AWS
      if (hasResets) {
        for (const [questionId, resetItem] of Object.entries(pendingResetsSnapshot)) {
          try {
            const lensAlias = resetItem.lensAlias || 'wellarchitected';
            // Restore previously selected choices, or send empty if none were selected before
            const itemKey = `${workload.storageKey}-${questionId}`;
            const previouslySelected = completedItems[itemKey]?.previouslySelected || [];
            if (previouslySelected.length > 0) {
              await updateAnswer(workload.workloadId, questionId, previouslySelected, lensAlias, '', true, null, true);
            } else {
              await updateAnswer(workload.workloadId, questionId, [], lensAlias, '', true, null, true);
            }
          } catch (err) {
            console.error(`Failed to reset ${questionId}:`, err.message);
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 3: Create the milestone
      const result = await createMilestone(
        workload.workloadId,
        `WASP Prioritization - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`
      );
      
      setMilestone(result);
      
      const updatedCompletedItems = { ...completedItems };
      
      itemsToProcess.forEach(finding => {
        const itemKey = `${workload.storageKey}-${finding.questionId}`;
        if (updatedCompletedItems[itemKey]) {
          updatedCompletedItems[itemKey].milestoneNumber = result.milestoneNumber;
          updatedCompletedItems[itemKey].milestoneName = `Milestone #${result.milestoneNumber}`;
          if (previouslySelectedMap[finding.questionId]) {
            updatedCompletedItems[itemKey].previouslySelected = previouslySelectedMap[finding.questionId];
          }
        }
      });
      
      const updatedPositions = { ...plotPositions };
      const allFindings = propFindings.filter(f => f.risk === 'high' || f.risk === 'medium');
      
      Object.keys(pendingResetsSnapshot).forEach((questionId, resetIdx) => {
        const itemKey = `${workload.storageKey}-${questionId}`;
        // wasReset=true marks an item that was previously completed in a milestone but has
        // since been intentionally un-completed. It's kept in completedItems (rather than
        // deleted) so the sort order in generatePlan can push it to the end of the staging
        // area, and so the stale-position guard in App.js knows not to re-apply the old
        // completed position on next load.
        updatedCompletedItems[itemKey] = { wasReset: true, questionId };
        
        // Place at the end of the staging area
        const stagingIndex = allFindings.length + resetIdx;
        updatedPositions[questionId] = getStagingPosition(stagingIndex);
      });
      
      setCompletedItems(updatedCompletedItems);
      setPlotPositions(updatedPositions);
      setPendingResets({});
      
      await savePrioritization(workload.storageKey, {
        completedItems: updatedCompletedItems,
        plotPositions: updatedPositions
      });
      
    } catch (err) {
      setError('Failed to create milestone: ' + err.message);
      console.error('Milestone creation error:', err);
    } finally {
      setCreating(false);
    }
    
    // Reload lens data AFTER the try/catch so a reload failure doesn't mask
    // a successful milestone creation. This refreshes all views (improvement plan,
    // findings plot, etc.) to reflect the updated AWS state.
    if (reloadLens) {
      try {
        await reloadLens();
      } catch (err) {
        console.error('Lens reload after milestone failed:', err);
      }
    }
  };

  const handleResetQuestion = (finding) => {
    setPendingResets(prev => ({
      ...prev,
      [finding.questionId]: {
        questionId: finding.questionId,
        questionTitle: finding.questionTitle,
        lensAlias: finding.lensAlias || 'wellarchitected'
      }
    }));
  };

  const handleUndoReset = (questionId) => {
    setPendingResets(prev => {
      const updated = { ...prev };
      delete updated[questionId];
      return updated;
    });
  };

  const handleToggleComplete = (finding) => {
    const itemKey = `${workload.storageKey}-${finding.questionId}`;
    const newCompletedItems = { ...completedItems };
    
    if (newCompletedItems[itemKey] && newCompletedItems[itemKey].milestoneNumber) {
      return;
    }
    
    const updatedPlotPositions = { ...plotPositions };
    
    // Treat wasReset items as not-yet-completed (they were un-done from a prior milestone)
    const existingEntry = newCompletedItems[itemKey];
    const isActuallyCompleted = existingEntry && !existingEntry.wasReset;
    
    if (isActuallyCompleted) {
      // Uncomplete the item (only if not in a milestone)
      // Restore the original plot position so the item goes back to its quadrant
      const savedOriginal = newCompletedItems[itemKey].originalPosition;
      delete newCompletedItems[itemKey];
      
      if (savedOriginal) {
        updatedPlotPositions[finding.questionId] = { ...savedOriginal, completed: false };
      } else {
        const allFindings = propFindings.filter(f => f.risk === 'high' || f.risk === 'medium');
        const displayIndex = allFindings.findIndex(f => f.questionId === finding.questionId);
        updatedPlotPositions[finding.questionId] = getStagingPosition(displayIndex);
      }
    } else {
      // Complete the item — save the original position so we know which quadrant it was in
      const currentPos = plotPositions[finding.questionId];
      newCompletedItems[itemKey] = {
        completedAt: new Date().toISOString(),
        questionId: finding.questionId,
        questionTitle: finding.questionTitle,
        pillar: finding.pillar,
        lensAlias: finding.lensAlias || 'wellarchitected',
        originalPosition: currentPos ? { x: currentPos.x, y: currentPos.y, staged: currentPos.staged } : null
      };
      
      const completedRow = Object.keys(newCompletedItems).filter(k => !newCompletedItems[k].milestoneNumber).length - 1;
      
      updatedPlotPositions[finding.questionId] = {
        x: 250 + (completedRow * COLUMN_WIDTH),
        y: COMPLETED_Y,
        staged: false,
        completed: true
      };
    }
    
    setPlotPositions(updatedPlotPositions);
    setCompletedItems(newCompletedItems);
    
    // Save immediately — use updatedPlotPositions (not the stale plotPositions
    // from the closure) so the completed/uncompleted position is persisted correctly.
    savePrioritization(workload.storageKey, {
      completedItems: newCompletedItems,
      plotPositions: updatedPlotPositions
    }).catch(err => console.error('ImplementationPlan: Failed to save:', err));
  };

  const renderPlanItem = (finding, className = '', isFromPriorMilestone = false) => {
    const itemKey = `${workload.storageKey}-${finding.questionId}`;
    const completedItem = completedItems[itemKey];
    const isCompleted = !!completedItem && !completedItem.wasReset;
    
    return (
      <div key={finding.questionId} className={`plan-item ${className} ${isCompleted ? 'completed' : ''}`}>
        <div className="plan-item-header">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={() => handleToggleComplete(finding)}
            disabled={isFromPriorMilestone}
            className="completion-checkbox"
            title={isFromPriorMilestone ? 'Cannot modify items from prior milestones' : ''}
          />
          <h4>
            {finding.number}. {finding.questionTitle} ({finding.questionId})
            {completedItem && completedItem.milestoneNumber && (
              <span className="milestone-badge"> • Milestone #{completedItem.milestoneNumber}</span>
            )}
          </h4>
        </div>
        <p><strong>Risk:</strong> {finding.risk.charAt(0).toUpperCase() + finding.risk.slice(1)}</p>
        <p><strong>Pillar:</strong> {finding.pillar}</p>
        <p><strong>Priority:</strong> {finding.impact} Impact, {finding.complexity} Complexity</p>
        <p><strong>Position:</strong> ({Math.round(finding.position.x)}, {Math.round(finding.position.y)})</p>
        {completedItem && completedItem.completedAt && (
          <p><strong>Completed:</strong> {new Date(completedItem.completedAt).toLocaleDateString()}</p>
        )}
        {!isFromPriorMilestone && (
          <div style={{ marginTop: '0.5rem' }}>
            <button 
              className="btn-link"
              onClick={() => navigateToFinding(finding.questionId, setActivePage)}
              style={{ marginRight: '1rem' }}
            >
              📋 View in Improvement Plan
            </button>
            <button 
              className="btn-link"
              onClick={() => navigateToPlot(finding.questionId)}
            >
              📊 View in Plot
            </button>
          </div>
        )}
        {isFromPriorMilestone && !pendingResets[finding.questionId] && (
          <div style={{ marginTop: '0.5rem' }}>
            <button 
              className="btn-link"
              onClick={() => handleResetQuestion(finding)}
              style={{ color: '#d13212' }}
            >
              {completedItem?.previouslySelected?.length > 0
                ? '🔄 Reset Question — revert to previous answers'
                : '🔄 Reset Question — mark none of the best practices apply to this question'}
            </button>
          </div>
        )}
        {pendingResets[finding.questionId] && (
          <div style={{ marginTop: '0.5rem', color: '#d13212', fontStyle: 'italic' }}>
            ⏳ Queued for reset — click Create Milestone to apply
            <button 
              className="btn-link"
              onClick={() => handleUndoReset(finding.questionId)}
              style={{ marginLeft: '0.5rem' }}
            >
              Undo
            </button>
          </div>
        )}
      </div>
    );
  };

  if (!plan) {
    return <div className="implementation-plan">Loading plan...</div>;
  }

  const totalFindings = plan.quickWins.length + plan.majorTasks.length + 
                        plan.incremental.length + plan.lowPriority.length;
  const pendingResetCount = Object.keys(pendingResets).length;

  if (totalFindings === 0 && plan.completedSinceLastMilestone.length === 0 && plan.completedInPriorMilestones.length === 0 && pendingResetCount === 0) {
    return (
      <div className="implementation-plan">
        <h2>Implementation Roadmap for {workload.workloadName}</h2>
        <div className="empty-state">
          <p>📋 No findings have been prioritized yet.</p>
          <p>Go to the <strong>Prioritise Findings</strong> page and drag findings from the staging area onto the plot to create your implementation plan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="implementation-plan">
      <h2>Implementation Roadmap for {workload.workloadName}</h2>
      <p className="help-text">
        Based on your prioritization: {plan.quickWins.length} Quick Wins, {plan.majorTasks.length} Major Tasks, 
        {plan.incremental.length} Incremental, {plan.lowPriority.length} Low Priority
        {plan.completedSinceLastMilestone.length > 0 && ` • ${plan.completedSinceLastMilestone.length} Completed Since Last Milestone`}
        {plan.completedInPriorMilestones.length > 0 && ` • ${plan.completedInPriorMilestones.length} Completed in Prior Milestones`}
      </p>
      
      <div className="plan-actions">
        <button
          className="btn-primary"
          onClick={handleCreateMilestone}
          disabled={creating}
        >
          {creating ? 'Creating...' : '📸 Create Milestone'}
        </button>
        
        {milestone && (
          <div className="success-message">
            ✅ Milestone #{milestone.milestoneNumber} created successfully!
          </div>
        )}
        
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}
      </div>

      {plan.quickWins.length > 0 && (
        <div className="plan-section">
          <h3>Phase 1: Quick Wins (0-30 Days)</h3>
          <p>Start here for immediate impact with minimal complexity</p>
          {plan.quickWins.map((finding) => renderPlanItem(finding, 'quick-win'))}
        </div>
      )}

      {plan.majorTasks.length > 0 && (
        <div className="plan-section">
          <h3>Phase 2: Major Tasks (30-90 Days)</h3>
          <p>High impact initiatives requiring significant planning and resources</p>
          {plan.majorTasks.map((finding) => renderPlanItem(finding, 'major-task'))}
        </div>
      )}

      {plan.incremental.length > 0 && (
        <div className="plan-section">
          <h3>Phase 3: Incremental Improvements (90-180 Days)</h3>
          <p>Ongoing enhancements for continuous improvement</p>
          {plan.incremental.map((finding) => renderPlanItem(finding))}
        </div>
      )}

      {plan.lowPriority.length > 0 && (
        <div className="plan-section">
          <h3>Phase 4: Low Priority (180+ Days)</h3>
          <p>Address when resources permit</p>
          {plan.lowPriority.map((finding) => renderPlanItem(finding, 'low-priority'))}
        </div>
      )}

      {plan.completedSinceLastMilestone.length > 0 && (
        <div className="plan-section completed-section">
          <h3>✅ Completed Since Last Milestone</h3>
          <p>Items that have been marked as complete and will be finalized in the next milestone</p>
          {plan.completedSinceLastMilestone.map((finding) => renderPlanItem(finding, 'completed-item', false))}
        </div>
      )}

      {pendingResetCount > 0 && (
        <div className="plan-section reset-section">
          <h3>⏳ To Be Marked Uncompleted ({pendingResetCount})</h3>
          <p>These items will be unchecked in AWS and moved to "Drag to Plot" when you Create Milestone</p>
          {Object.entries(pendingResets).map(([questionId, item]) => (
            <div key={questionId} className="plan-item reset-item">
              <div className="plan-item-header">
                <h4>{item.questionTitle} ({questionId})</h4>
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <button 
                  className="btn-link"
                  onClick={() => handleUndoReset(questionId)}
                >
                  ↩️ Undo Reset
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {plan.completedInPriorMilestones.length > 0 && (
        <div className="plan-section prior-milestone-section">
          <h3>Previously Completed in Prior Milestones</h3>
          <p>Items that were completed and finalized in previous milestones (cannot be modified)</p>
          {plan.completedInPriorMilestones.map((finding) => renderPlanItem(finding, 'prior-milestone-item', true))}
        </div>
      )}
    </div>
  );
}

export default ImplementationPlan;
