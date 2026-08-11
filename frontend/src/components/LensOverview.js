import React from 'react';
import { navigateToFinding } from '../utils/navigation';
import './LensOverview.css';

function LensOverview({ workload, findings = [], setActivePage }) {
  const lensAlias = workload.lensAlias || 'wellarchitected';
  const lensVersion = workload.lensVersion || 'AWS Well-Architected Framework';
  const pillarSummaries = workload.pillarReviewSummaries || [];
  
  // Maps well-known lens aliases to human-readable names for display in the table header.
  // The AWS API returns aliases like 'wellarchitected' or full ARNs for custom/partner lenses.
  const lensDisplayNames = {
    'wellarchitected': 'AWS Well-Architected',
    'serverless': 'Serverless',
    'softwareasaservice': 'SaaS',
  };

  // Resolves a lens alias or ARN to a display name.
  // For known aliases, returns the mapped name. For ARN-style aliases (custom/partner lenses),
  // extracts the slug after 'lens/' and title-cases it. Falls back to the raw alias.
  const getLensDisplayName = (alias) => {
    if (lensDisplayNames[alias]) return lensDisplayNames[alias];
    const arnMatch = alias.match(/lens\/(.+)$/);
    if (arnMatch) {
      return arnMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return alias;
  };
  const lensDisplayName = getLensDisplayName(lensAlias);
  
  // Map pillar IDs to display names
  const pillarNameMap = {
    'security': 'Security',
    'reliability': 'Reliability',
    'operationalExcellence': 'Operational Excellence',
    'performance': 'Performance Efficiency',
    'costOptimization': 'Cost Optimization',
    'sustainability': 'Sustainability'
  };
  
  // Running totals across all pillars — used for the "X/Y questions answered" summary box.
  let totalAnswered = 0;
  let totalQuestions = 0;
  
  // Build per-pillar stats from the pillar review summaries returned by the API.
  // Each pillar summary contains riskCounts broken down by risk level.
  const pillarStats = pillarSummaries.map(pillar => {
    const pillarId = pillar.pillarId;
    const riskCounts = pillar.riskCounts || {};
    
    // Answered = any question that received a response, regardless of outcome.
    // UNANSWERED questions haven't been touched yet in the Well-Architected Tool console.
    // Total = Answered + UNANSWERED (all questions in the pillar).
    const highRisk = riskCounts.HIGH || 0;
    const mediumRisk = riskCounts.MEDIUM || 0;
    const noRisk = riskCounts.NONE || 0;
    const notApplicable = riskCounts.NOT_APPLICABLE || 0;
    const unanswered = riskCounts.UNANSWERED || 0;
    
    const answered = highRisk + mediumRisk + noRisk + notApplicable;
    const total = answered + unanswered;
    
    totalAnswered += answered;
    totalQuestions += total;
    
    return {
      name: pillarNameMap[pillarId] || pillarId,
      questionsAnswered: `${answered}/${total}`,
      highRisk,
      mediumRisk,
      noRisk,
      notApplicable
    };
  });
  
  // Calculate unanswered questions
  const unansweredCount = totalQuestions - totalAnswered;

  // Navigates to the improvement plan page and scrolls to the first finding
  // that matches the given pillar and risk level. Used when a user clicks a
  // risk count cell in the summary table — takes them straight to the relevant finding.
  const navigateToFirstFinding = (pillarName, riskLevel) => {
    // Find first finding matching this pillar and risk level
    const finding = findings.find(f => 
      f.pillar === pillarName && 
      f.risk.toUpperCase() === riskLevel.toUpperCase()
    );
    
    if (finding) {
      navigateToFinding(finding.questionId, setActivePage);
    }
  };

  return (
    <div className="lens-overview-page">
      <div className="section">
        <h2>Lens overview</h2>
        
        <div className="lens-stat-box">
          <div className="lens-stat-label">Questions answered</div>
          <div className="lens-stat-value">{totalAnswered}/{totalQuestions}</div>
        </div>

        <div className="lens-info-box">
          <div className="lens-info-label">Version</div>
          <div className="lens-info-text">{lensVersion}</div>
        </div>

        <div className="lens-section">
          <h3>Summary</h3>
          <table className="lens-summary-table">
            <thead>
              <tr>
                <th>Lens</th>
                <th>Pillar</th>
                <th>Questions answered</th>
                <th className="risk-col high-risk-col">High risk</th>
                <th className="risk-col medium-risk-col">Medium risk</th>
                <th className="risk-col no-risk-col">No identified risk</th>
                <th className="risk-col not-applicable-col">Not applicable</th>
              </tr>
            </thead>
            <tbody>
              {pillarStats.length > 0 ? (
                pillarStats.map((pillar, index) => (
                  <tr key={pillar.name}>
                    {index === 0 && (
                      <td rowSpan={pillarStats.length} className="lens-name-cell">
                        {lensDisplayName}
                      </td>
                    )}
                    <td>{pillar.name}</td>
                    <td className="center">{pillar.questionsAnswered}</td>
                    <td className={`center risk-cell ${pillar.highRisk > 0 ? 'has-high-risk clickable' : ''}`}
                        onClick={() => pillar.highRisk > 0 && navigateToFirstFinding(pillar.name, 'HIGH')}
                        style={{ cursor: pillar.highRisk > 0 ? 'pointer' : 'default' }}>
                      {pillar.highRisk}
                    </td>
                    <td className={`center risk-cell ${pillar.mediumRisk > 0 ? 'has-medium-risk clickable' : ''}`}
                        onClick={() => pillar.mediumRisk > 0 && navigateToFirstFinding(pillar.name, 'MEDIUM')}
                        style={{ cursor: pillar.mediumRisk > 0 ? 'pointer' : 'default' }}>
                      {pillar.mediumRisk}
                    </td>
                    <td className="center">{pillar.noRisk}</td>
                    <td className="center">{pillar.notApplicable}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="center">No pillar data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {unansweredCount > 0 && (
          <div className="lens-notes-box">
            <h3>Lens notes</h3>
            <div className="lens-notes-text">
              {unansweredCount} questions remain unanswered. Complete the review for comprehensive findings.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LensOverview;
