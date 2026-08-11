import React from 'react';
import { navigateToFinding } from '../utils/navigation';
import './PillarDetails.css';

function PillarDetails({ findings = [], pillarSummaries = [], setActivePage }) {
  // Build a lookup from pillarId to total question count by summing all risk buckets.
  // This gives us the denominator for "X out of Y questions show no risk" messaging.
  // We use pillarSummaries (from the lens review) rather than findings because findings
  // only contains questions that have risks — answered-with-no-risk questions are not in findings.
  const pillarTotalMap = {};
  pillarSummaries.forEach(p => {
    const counts = p.riskCounts || {};
    const total = (counts.HIGH || 0) + (counts.MEDIUM || 0) + (counts.NONE || 0) +
                  (counts.NOT_APPLICABLE || 0) + (counts.UNANSWERED || 0);
    pillarTotalMap[p.pillarId] = total;
  });

  // Maps display names to the pillarId strings used by the AWS Well-Architected Tool API.
  // Needed to cross-reference pillarTotalMap (keyed by API pillarId) with
  // the pillars array below (keyed by display name).
  const pillarIdMap = {
    'Operational Excellence': 'operationalExcellence',
    'Security': 'security',
    'Reliability': 'reliability',
    'Performance Efficiency': 'performance',
    'Cost Optimization': 'costOptimization',
    'Sustainability': 'sustainability'
  };

  // Full pillar definitions with display metadata.
  // The filter removes pillars not present in this workload's review (pillarTotalMap won't have them).
  // The map enriches each pillar with its total question count for use in the "best practices" slide.
  const pillars = [
    { name: 'Operational Excellence', color: '#FF9900', icon: '⚙️' },
    { name: 'Security', color: '#E91E8C', icon: '🔒' },
    { name: 'Reliability', color: '#0073BB', icon: '🛡️' },
    { name: 'Performance Efficiency', color: '#16A085', icon: '⚡' },
    { name: 'Cost Optimization', color: '#7D3C98', icon: '💰' },
    { name: 'Sustainability', color: '#5D6D7E', icon: '🌱' }
  ].filter(p => pillarTotalMap[pillarIdMap[p.name]] !== undefined)
   .map(p => ({ ...p, totalQuestions: pillarTotalMap[pillarIdMap[p.name]] || 0 }));

  return (
    <div className="pillar-details-page">
      <h2>Pillar-by-Pillar Analysis</h2>
      
      {pillars.map(pillar => {
        // Separate findings for this pillar into risk buckets.
        // Handles both uppercase ('HIGH') and lowercase ('high') from different API versions.
        const pillarFindings = findings.filter(f => f.pillar === pillar.name);
        const highRisk = pillarFindings.filter(f => 
          f.risk === 'HIGH' || f.risk === 'high'
        );
        const mediumRisk = pillarFindings.filter(f => 
          f.risk === 'MEDIUM' || f.risk === 'medium'
        );

        // questionsWithRisk = number of questions that have at least one finding (high or medium).
        // questionsNoRisk = total questions minus those with findings, i.e. questions where
        // the customer is already following best practices or marked not applicable.
        const questionsWithRisk = pillarFindings.length;
        const questionsNoRisk = pillar.totalQuestions - questionsWithRisk;

        return (
          <div key={pillar.name} className="pillar-section">
            {/* Title Slide */}
            <div className="pillar-title-slide" style={{ background: pillar.color }}>
              <div className="pillar-title-content">
                <h2>{pillar.name}</h2>
                <div className="pillar-icon">{pillar.icon}</div>
              </div>
            </div>

            {/* Improvement Opportunities Slide */}
            <div className="pillar-slide">
              <div className="pillar-slide-header" style={{ background: pillar.color }}>
                <h3>{pillar.name}</h3>
              </div>
              <div className="pillar-slide-content">
                <div className="slide-title-with-icon">
                  <h2>Improvement opportunities</h2>
                  <div className="slide-icon warning-icon">!</div>
                </div>
                
                {(highRisk.length > 0 || mediumRisk.length > 0) ? (
                  // Render high-risk findings first (more urgent), then medium.
                  // Each item is a clickable link that navigates to the full finding detail.
                  <ul className="findings-summary-list">
                    {highRisk.map((finding, index) => (
                      <li key={`high-${index}`} className="high-risk-item">
                        <a 
                          href={`#finding-${finding.questionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigateToFinding(finding.questionId, setActivePage);
                          }}
                        >
                          {finding.questionTitle}
                        </a>
                      </li>
                    ))}
                    {mediumRisk.map((finding, index) => (
                      <li key={`medium-${index}`} className="medium-risk-item">
                        <a 
                          href={`#finding-${finding.questionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigateToFinding(finding.questionId, setActivePage);
                          }}
                        >
                          {finding.questionTitle}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-findings">No improvement opportunities identified for this pillar.</p>
                )}
              </div>
            </div>

            {/* Best Practices in Place Slide */}
            <div className="pillar-slide">
              <div className="pillar-slide-header" style={{ background: pillar.color }}>
                <h3>{pillar.name}</h3>
              </div>
              <div className="pillar-slide-content">
                <div className="slide-title-with-icon">
                  <h2>Best practices in place</h2>
                  <div className="slide-icon success-icon">✓</div>
                </div>
                
                {questionsNoRisk > 0 ? (
                  <ul className="findings-summary-list">
                    <li className="success-item">
                      {questionsNoRisk} out of {pillar.totalQuestions} questions show no identified risks
                    </li>
                    <li className="success-item">
                      Customer is following Well-Architected best practices in these areas
                    </li>
                  </ul>
                ) : (
                  <p className="placeholder-text">All questions have identified risks - focus on improvement opportunities</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default PillarDetails;
