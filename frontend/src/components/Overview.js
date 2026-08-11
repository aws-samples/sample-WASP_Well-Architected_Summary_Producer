import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { navigateToFinding } from '../utils/navigation';
import { generateBusinessSummary, askSummaryQuestion } from '../api/wasp-api';
import { getPracticeUrl } from '../utils/practiceUrls';
import './Overview.css';

function Overview({ workload, findings = [], setActivePage, aiMode = false, aiModel = '', aiSummaries = {}, setAiSummaries, businessSummary = '', setBusinessSummary, businessSummaryMeta = null, setBusinessSummaryMeta, qaHistory = [], setQaHistory, summaryLoading = false, setSummaryLoading, summaryError = null, setSummaryError }) {
  // Maps human-readable pillar names to the pillarId strings used by the AWS Well-Architected Tool API.
  // This is needed because the API returns pillarId (e.g. 'operationalExcellence')
  // while findings and UI use the display name (e.g. 'Operational Excellence').
  const pillarIdMap = {
    'Security': 'security',
    'Reliability': 'reliability',
    'Operational Excellence': 'operationalExcellence',
    'Performance Efficiency': 'performance',
    'Cost Optimization': 'costOptimization',
    'Sustainability': 'sustainability'
  };

  const pillarSummaries = workload.pillarReviewSummaries || [];
  // Build a set of pillar IDs that are actually present in this workload's review,
  // so we only render cards for pillars the workload was assessed against.
  const activePillarIds = new Set(pillarSummaries.map(p => p.pillarId));
  
  // Ordered list of all possible pillars, filtered down to only those active in this workload.
  // The ordering here controls the display order of risk cards on the page.
  const allPillars = [
    'Security',
    'Reliability',
    'Operational Excellence',
    'Performance Efficiency',
    'Cost Optimization',
    'Sustainability'
  ].filter(pillar => activePillarIds.has(pillarIdMap[pillar]));

  // Initialise a stats bucket for each active pillar.
  // high/medium come from findings; unanswered comes from pillar summaries.
  const pillarStats = {};
  allPillars.forEach(pillar => {
    pillarStats[pillar] = { high: 0, medium: 0, unanswered: 0 };
  });

  // Populate unanswered counts from the pillar review summaries returned by the API.
  // The API tracks UNANSWERED separately from risk levels, so we pull it from riskCounts.
  pillarSummaries.forEach(pillar => {
    const pillarId = pillar.pillarId;
    const pillarName = Object.keys(pillarIdMap).find(key => pillarIdMap[key] === pillarId);
    
    if (pillarName && pillarStats[pillarName]) {
      const riskCounts = pillar.riskCounts || {};
      pillarStats[pillarName].unanswered = riskCounts.UNANSWERED || 0;
    }
  });

  // Tally high/medium risk counts from the findings array.
  // Normalise to lowercase to handle both 'HIGH'/'high' from different API versions.
  if (findings && Array.isArray(findings)) {
    findings.forEach(finding => {
      if (pillarStats[finding.pillar]) {
        const risk = finding.risk.toLowerCase();
        if (risk === 'high' || risk === 'medium') {
          pillarStats[finding.pillar][risk]++;
        }
      }
    });
  }

  // Navigates to the improvement plan page and scrolls to the first finding
  // that matches the given pillar and risk level. Used when a user clicks a
  // risk count badge on a pillar card — takes them straight to the relevant finding.
  const navigateToFirstFinding = (pillarName, riskLevel) => {
    const finding = findings.find(f => 
      f.pillar === pillarName && 
      f.risk.toLowerCase() === riskLevel.toLowerCase()
    );
    
    if (finding) {
      navigateToFinding(finding.questionId, setActivePage);
    }
  };

  // Opens the AWS Well-Architected Tool console directly to the unanswered questions
  // for the given pillar. This lets the user answer questions without leaving context.
  // Falls back gracefully if workloadId or pillarId can't be resolved.
  const openFirstUnansweredQuestion = (pillarName) => {
    const pillarId = pillarIdMap[pillarName];
    if (!pillarId) {
      console.error('Could not find pillar ID for:', pillarName);
      return;
    }
    
    // Use the first region associated with the workload, defaulting to us-east-1.
    const region = workload.awsRegions?.[0] || 'us-east-1';
    
    if (!workload.workloadId) {
      console.error('No workload ID found');
      alert('Cannot open AWS console: No workload ID found');
      return;
    }
    
    // Build a deep-link URL to the Well-Architected Tool console filtered to this pillar's questions.
    const currentLens = workload.lensAlias || 'wellarchitected';
    const consoleUrl = `https://${region}.console.aws.amazon.com/wellarchitected/home?region=${region}#/workload/${workload.workloadId}/lens/${currentLens}/questions?pillarId=${pillarId}`;
    
    window.open(consoleUrl, '_blank', 'noopener,noreferrer');
  };

  // AI Business Summary state (loading/error are lifted to App, Q&A state is local)
  const [qaInput, setQaInput] = useState('');
  const [qaLoading, setQaLoading] = useState(false);

  const handleGenerateSummary = async (regenerate = false) => {
    setSummaryLoading(true);
    setSummaryError(null);
    if (regenerate) {
      setBusinessSummary('');
      setBusinessSummaryMeta(null);
      setQaHistory([]);
    }

    try {
      const result = await generateBusinessSummary(aiModel, buildWorkloadContext(), buildFindingsSummary(), workload.storageKey, regenerate);
      setBusinessSummary(result.summary);
      setBusinessSummaryMeta({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId, fromCache: result.fromCache });
      if (result.aiSummaries && setAiSummaries) {
        setAiSummaries(result.aiSummaries);
      }
    } catch (err) {
      setSummaryError(err.details || err.message || 'Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const buildWorkloadContext = () => {
    const highRiskFindings = findings.filter(f => f.risk.toLowerCase() === 'high');
    const mediumRiskFindings = findings.filter(f => f.risk.toLowerCase() === 'medium');
    return {
      workloadId: workload.workloadId,
      lensAlias: workload.lensAlias,
      workloadName: workload.workloadName,
      description: workload.description,
      environment: workload.environment,
      industry: workload.industry,
      industryType: workload.industryType,
      awsRegions: workload.awsRegions,
      lensName: workload.lensName,
      owner: workload.owner,
      architecturalDesign: workload.architecturalDesign,
      highRiskCount: highRiskFindings.length,
      mediumRiskCount: mediumRiskFindings.length,
    };
  };

  const buildFindingsSummary = () => {
    const highRiskFindings = findings.filter(f => f.risk.toLowerCase() === 'high');
    const mediumRiskFindings = findings.filter(f => f.risk.toLowerCase() === 'medium');
    const result = [...highRiskFindings, ...mediumRiskFindings].map(f => ({
      questionId: f.questionId,
      risk: f.risk,
      pillar: f.pillar,
      questionTitle: f.questionTitle,
      bestPractices: (f.bestPractices || []).map((bp, idx) => ({
        title: bp.title || bp.name || bp,
        description: bp.description || '',
        improvementPlan: bp.improvementPlan?.DisplayText || bp.improvementPlan?.displayText || '',
        helpfulResource: bp.helpfulResource?.DisplayText || bp.helpfulResource?.displayText || '',
        helpfulResourceUrl: getPracticeUrl(bp, f, idx) || '',
      })),
    }));
    return result;
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    const question = qaInput.trim();
    if (!question || !businessSummary) return;

    setQaHistory(prev => [...prev, { type: 'question', text: question }]);
    setQaInput('');
    setQaLoading(true);

    try {
      const result = await askSummaryQuestion(aiModel, question, businessSummary, buildWorkloadContext(), buildFindingsSummary());
      setQaHistory(prev => [...prev, { type: 'answer', text: result.answer, meta: { inputTokens: result.inputTokens, outputTokens: result.outputTokens } }]);
    } catch (err) {
      setQaHistory(prev => [...prev, { type: 'error', text: err.details || err.message || 'Failed to get answer' }]);
    } finally {
      setQaLoading(false);
    }
  };

  return (
    <div className="overview-page">
      <div className="section">
        <h2>Workload Information</h2>
        <div className="info-card">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Workload</span>
              <span className="info-value">{workload.workloadName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Owner</span>
              <span className="info-value">{workload.owner || 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Environment</span>
              <span className="info-value">{workload.environment || 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Region</span>
              <span className="info-value">{workload.awsRegions?.join(', ') || 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Report Date</span>
              <span className="info-value">{new Date(workload.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Risk Summary</h2>
        <div className="risk-grid">
          {allPillars.map(pillar => {
            const stats = pillarStats[pillar];
            const hasFindings = stats.high > 0 || stats.medium > 0;
            // Card colour reflects the worst risk level: high > medium > none
            const cardClass = stats.high > 0 ? 'high-risk' : (stats.medium > 0 ? 'medium-risk' : 'no-risk');

            return (
              <div key={pillar} className={`risk-card ${cardClass}`}>
                <h4>{pillar}</h4>
                <div className="risk-stats">
                  {/* Clicking a non-zero count navigates to the first matching finding */}
                  <div 
                    className={`risk-stat ${stats.high > 0 ? 'clickable' : ''}`}
                    onClick={() => stats.high > 0 && navigateToFirstFinding(pillar, 'high')}
                    style={{ cursor: stats.high > 0 ? 'pointer' : 'default' }}
                  >
                    <div className="risk-number">{stats.high}</div>
                    <div className="risk-label">High Risk</div>
                  </div>
                  <div 
                    className={`risk-stat ${stats.medium > 0 ? 'clickable' : ''}`}
                    onClick={() => stats.medium > 0 && navigateToFirstFinding(pillar, 'medium')}
                    style={{ cursor: stats.medium > 0 ? 'pointer' : 'default' }}
                  >
                    <div className="risk-number" style={{ color: 'var(--warning)' }}>{stats.medium}</div>
                    <div className="risk-label">Medium Risk</div>
                  </div>
                  {/* Clicking unanswered opens the AWS console so the user can answer them */}
                  <div 
                    className={`risk-stat ${stats.unanswered > 0 ? 'clickable' : ''}`}
                    onClick={() => stats.unanswered > 0 && openFirstUnansweredQuestion(pillar)}
                    style={{ cursor: stats.unanswered > 0 ? 'pointer' : 'default' }}
                  >
                    <div className="risk-number" style={{ color: 'var(--text-secondary)' }}>{stats.unanswered}</div>
                    <div className="risk-label">Not Answered</div>
                  </div>
                </div>
                {!hasFindings && (
                  <div style={{ textAlign: 'center', color: 'var(--success)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                    ✓ No findings
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button 
            className="btn btn-primary"
            onClick={() => setActivePage('lens')}
          >
            More information
          </button>
        </div>
      </div>

      {aiMode && (
        <div className="section business-summary-section">
          <div className="business-summary-header">
            <h2>Business Summary</h2>
            <button
              className="btn btn-primary"
              onClick={() => handleGenerateSummary(!!businessSummary)}
              disabled={summaryLoading || !aiModel}
            >
              {summaryLoading ? 'Generating...' : businessSummary ? 'Regenerate' : 'Generate Summary'}
            </button>
          </div>
          <p className="ai-disclaimer">AI-generated for informational purposes only. Generative AI can make mistakes — please double-check the output.</p>
          <p className="ai-disclaimer">Generating also creates up to 20 best practice summaries on the Improvement Plan tab, prioritised by high risk findings first. These are cached — for example, if there are 25 items, the first run summarises 20, the second run summarises the remaining 5, and subsequent runs use the cache instantly. The first run may take up to 5 minutes. The business summary itself is also saved and loads automatically on return — click Regenerate to overwrite it with a fresh version.</p>
          {summaryLoading && (
            <div className="summary-loading">
              <div className="summary-spinner" />
              <p>Analysing findings and generating business summary...</p>
            </div>
          )}
          {summaryError && (
            <div className="summary-error">
              <p>Failed to generate summary: {summaryError}</p>
            </div>
          )}
          {businessSummary && !summaryLoading && (
            <div className="summary-content">
              <ReactMarkdown>{businessSummary}</ReactMarkdown>
              {businessSummaryMeta && (
                <div className="summary-meta">
                  Model: {businessSummaryMeta.modelId} · Tokens: {businessSummaryMeta.inputTokens} in / {businessSummaryMeta.outputTokens} out{businessSummaryMeta.fromCache ? ' · (cached)' : ''}
                </div>
              )}
            </div>
          )}
          {!businessSummary && !summaryLoading && !summaryError && (
            <p className="summary-placeholder">Click "Generate Summary" to create an AI-powered business summary of this review's findings and remediation actions.</p>
          )}
          {businessSummary && !summaryLoading && (
            <div className="qa-section">
              <h3>Ask a question</h3>
              <div className="qa-history">
                {qaHistory.map((item, i) => (
                  <div key={i} className={`qa-bubble qa-${item.type}`}>
                    {item.type === 'answer' ? <ReactMarkdown>{item.text}</ReactMarkdown> : <p>{item.text}</p>}
                    {item.meta && (
                      <span className="qa-meta">Tokens: {item.meta.inputTokens} in / {item.meta.outputTokens} out</span>
                    )}
                  </div>
                ))}
                {qaLoading && (
                  <div className="qa-bubble qa-answer qa-thinking">
                    <div className="summary-spinner" />
                    <span>Thinking...</span>
                  </div>
                )}
              </div>
              <form className="qa-form" onSubmit={handleAskQuestion}>
                <input
                  type="text"
                  className="qa-input"
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  placeholder="Ask a follow-up question about this review..."
                  disabled={qaLoading}
                  aria-label="Ask a follow-up question"
                />
                <button type="submit" className="btn btn-primary" disabled={qaLoading || !qaInput.trim()}>
                  Ask
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Overview;
