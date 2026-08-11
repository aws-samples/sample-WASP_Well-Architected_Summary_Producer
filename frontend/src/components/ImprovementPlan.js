import React from 'react';
import './ImprovementPlan.css';
import { navigateToPrioritiseFinding } from '../utils/navigation';

// Lenses that use the wa.aws.amazon.com step-anchor URL scheme rather than
// the docs.aws.amazon.com page-per-question scheme.
// Pattern: https://wa.aws.amazon.com/<lens>/<version>/<prefix>.question.<ID>.en.html#step<N>
const STEP_URL_LENSES = new Set(['softwareasaservice', 'serverless']);

// Maps a lens alias to the short prefix used in wa.aws.amazon.com URLs.
// e.g. softwareasaservice → saas, serverless → serv
const LENS_URL_PREFIX = { softwareasaservice: 'saas', serverless: 'serv' };

// Maps a lens alias (or ARN) to the slug used in docs.aws.amazon.com URLs.
// Pattern: https://docs.aws.amazon.com/wellarchitected/latest/<slug>/<questionId>.html
const LENS_DOCS_SLUG = {
  wellarchitected: 'framework',
  serverless: 'serverless-applications-lens',
  softwareasaservice: 'saas-lens',
  'arn:aws:wellarchitected::aws:lens/genai': 'generative-ai-lens',
  'arn:aws:wellarchitected::aws:lens/machinelearning': 'machine-learning-lens',
  'arn:aws:wellarchitected::aws:lens/data-analytics': 'data-analytics-lens',
  'arn:aws:wellarchitected::aws:lens/financial-services': 'financial-services-industry-lens',
  'arn:aws:wellarchitected::aws:lens/iot': 'iot-lens',
  'arn:aws:wellarchitected::aws:lens/games': 'games-industry-lens',
  'arn:aws:wellarchitected::aws:lens/container-build': 'container-build-lens',
  'arn:aws:wellarchitected::aws:lens/hybrid-networking': 'hybrid-networking-lens',
};

function ImprovementPlan({ findings = [], setActivePage, aiSummaries = {} }) {
  const [riskFilter, setRiskFilter] = React.useState('both');
  
  const highRiskCount = findings.filter(f => f.risk === 'HIGH' || f.risk === 'high').length;
  const mediumRiskCount = findings.filter(f => f.risk === 'MEDIUM' || f.risk === 'medium').length;

  const allPillars = [
    'Security', 'Reliability', 'Operational Excellence',
    'Performance Efficiency', 'Cost Optimization', 'Sustainability'
  ];

  const pillarStats = allPillars.map(pillar => {
    const pf = findings.filter(f => f.pillar === pillar);
    return {
      name: pillar,
      highRisk: pf.filter(f => f.risk === 'HIGH' || f.risk === 'high').length,
      mediumRisk: pf.filter(f => f.risk === 'MEDIUM' || f.risk === 'medium').length,
      findings: pf
    };
  }).filter(p => p.highRisk > 0 || p.mediumRisk > 0);

  const findingsByPillarAndRisk = {};
  allPillars.forEach(pillar => {
    const pf = findings.filter(f => f.pillar === pillar);
    const highRisk = pf.filter(f => f.risk === 'HIGH' || f.risk === 'high');
    const mediumRisk = pf.filter(f => f.risk === 'MEDIUM' || f.risk === 'medium');
    if (highRisk.length > 0 || mediumRisk.length > 0) {
      findingsByPillarAndRisk[pillar] = { highRisk, mediumRisk };
    }
  });

  // Lens URL mappings

  // Normalises a question ID for use in wa.aws.amazon.com URLs.
  // Input format: "<pillar>_q<N>" → output: "<PILLAR>_<N>"
  // e.g. "security_q3" → "SECURITY_3"
  const formatQuestionIdForUrl = (questionId) => {
    const match = questionId.match(/^(.+)_q(\d+)$/i);
    if (match) return `${match[1].toUpperCase()}_${match[2]}`;
    return questionId.toUpperCase();
  };

  // Builds a step-anchor URL for lenses that use the wa.aws.amazon.com scheme.
  // Pattern: https://wa.aws.amazon.com/<lens>/<version>/<prefix>.question.<ID>.en.html#step<N>
  // The version is extracted from the finding's improvementPlanUrl when available,
  // otherwise falls back to finding.lensVersion or "latest".
  const getStepUrl = (finding, stepIndex) => {
    const lens = finding.lensAlias || 'wellarchitected';
    let version = finding.lensVersion || 'latest';
    if (finding.improvementPlanUrl) {
      const m = finding.improvementPlanUrl.match(/wa\.aws\.amazon\.com\/[^/]+\/([^/]+)\//);
      if (m) version = m[1];
    }
    const prefix = LENS_URL_PREFIX[lens] || lens;
    const fmtId = formatQuestionIdForUrl(finding.questionId);
    return `https://wa.aws.amazon.com/${lens}/${version}/${prefix}.question.${fmtId}.en.html#step${stepIndex + 1}`;
  };

  // Resolves the canonical documentation URL for a finding's question.
  // Priority order:
  //   1. finding.improvementPlanUrl — used as-is unless it points to the generic
  //      framework welcome page (which means the API returned a placeholder).
  //   2. STEP_URL_LENSES (saas, serverless) — wa.aws.amazon.com question page.
  //   3. LENS_DOCS_SLUG map — docs.aws.amazon.com/<slug>/<paddedId>.html
  //      Question IDs are zero-padded to two digits (e.g. "sec_q3" → "sec_q03").
  //   4. ARN-based lenses not in the map — derive slug from the ARN suffix.
  //   5. Returns null if no URL can be determined.
  const getQuestionUrl = (finding) => {
    if (finding.improvementPlanUrl && !finding.improvementPlanUrl.includes('wellarchitected/latest/framework/welcome')) {
      return finding.improvementPlanUrl;
    }
    const lens = finding.lensAlias || 'wellarchitected';
    if (STEP_URL_LENSES.has(lens)) {
      const version = finding.lensVersion || 'latest';
      const prefix = LENS_URL_PREFIX[lens] || lens;
      const fmtId = formatQuestionIdForUrl(finding.questionId);
      return `https://wa.aws.amazon.com/${lens}/${version}/${prefix}.question.${fmtId}.en.html`;
    }
    const slug = LENS_DOCS_SLUG[lens];
    if (slug) {
      const paddedId = finding.questionId.replace(/(\D)(\d)$/, '$10$2');
      return `https://docs.aws.amazon.com/wellarchitected/latest/${slug}/${paddedId}.html`;
    }
    const arnMatch = lens.match(/lens\/(.+)$/);
    if (arnMatch) {
      const derivedSlug = arnMatch[1] + '-lens';
      const paddedId = finding.questionId.replace(/(\D)(\d)$/, '$10$2');
      return `https://docs.aws.amazon.com/wellarchitected/latest/${derivedSlug}/${paddedId}.html`;
    }
    return null;
  };

  // Resolves the URL for an individual best-practice choice within a finding.
  // For STEP_URL_LENSES: uses the choice's global index in finding.allChoices to
  // build a step-anchor URL so each practice links to its specific step.
  // For other lenses: prefers the choice's own improvementPlan/helpfulResource URL,
  // then falls back to a choice-ID page, then the question URL.
  const getPracticeUrl = (practice, finding, stepIndex) => {
    const lens = finding.lensAlias || 'wellarchitected';
    if (STEP_URL_LENSES.has(lens)) {
      const allChoices = finding.allChoices || [];
      const globalIndex = allChoices.findIndex(c => c.choiceId === practice.choiceId);
      const step = globalIndex !== -1 ? globalIndex : stepIndex;
      return getStepUrl(finding, step);
    }
    if (practice.improvementPlan && practice.improvementPlan.Url) {
      return practice.improvementPlan.Url;
    }
    if (practice.helpfulResource && practice.helpfulResource.Url) {
      return practice.helpfulResource.Url;
    }
    if (practice.choiceId) {
      const slug = LENS_DOCS_SLUG[lens] || 'framework';
      return `https://docs.aws.amazon.com/wellarchitected/latest/${slug}/${practice.choiceId}.html`;
    }
    return getQuestionUrl(finding);
  };

  const renderBestPractices = (finding) => {
    if (!finding.bestPractices || finding.bestPractices.length === 0) return null;
    return (
      <ul className="best-practices-list">
        {finding.bestPractices.map((practice, idx) => {
          const practiceUrl = getPracticeUrl(practice, finding, idx);
          const practiceTitle = practice.title || practice.choiceId || 'Best practice';
          // Look up AI summary using the same URL resolution as the business summary
          const resolvedUrl = getPracticeUrl(practice, finding, idx) || '';
          const summary = resolvedUrl ? aiSummaries[resolvedUrl] : null;
          return (
            <li key={idx}>
              {practiceUrl ? (
                <a href={practiceUrl} target="_blank" rel="noopener noreferrer">{practiceTitle}</a>
              ) : (
                <span>{practiceTitle}</span>
              )}
              {summary && (
                <div className="ai-practice-summary">
                  <span className="ai-practice-summary-label">Summary:</span> {summary}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderFinding = (finding) => {
    const docUrl = getQuestionUrl(finding);
    return (
      <div key={finding.questionId} className="finding-item" id={`finding-${finding.questionId}`}>
        <div className="finding-question">
          {docUrl ? (
            <a href={docUrl} target="_blank" rel="noopener noreferrer" className="finding-link">
              {finding.questionTitle}
            </a>
          ) : (
            <span className="finding-link">{finding.questionTitle}</span>
          )}
          <button className="view-plot-btn" onClick={() => navigateToPrioritiseFinding(finding.questionId, setActivePage)}>
            📊 View in Plot
          </button>
        </div>
        {renderBestPractices(finding)}
      </div>
    );
  };

  return (
    <div className="improvement-plan-page">
      <h2>Improvement plan</h2>
      
      <div className="risk-summary-boxes">
        <div className="risk-box high-risk-box">
          <div className="risk-box-label">High risk</div>
          <div className="risk-box-value">{highRiskCount}</div>
        </div>
        <div className="risk-box medium-risk-box">
          <div className="risk-box-label">Medium risk</div>
          <div className="risk-box-value">{mediumRiskCount}</div>
        </div>
      </div>

      <div className="risk-filter-section">
        <label>Show: </label>
        <button className={`filter-btn ${riskFilter === 'both' ? 'active' : ''}`} onClick={() => setRiskFilter('both')}>Both</button>
        <button className={`filter-btn ${riskFilter === 'high' ? 'active' : ''}`} onClick={() => setRiskFilter('high')}>High Risk Only</button>
        <button className={`filter-btn ${riskFilter === 'medium' ? 'active' : ''}`} onClick={() => setRiskFilter('medium')}>Medium Risk Only</button>
      </div>

      <div className="improvement-summary-section">
        <h3>Improvement item summary</h3>
        <table className="improvement-summary-table">
          <thead>
            <tr><th>Pillar</th><th className="risk-col">High risk</th><th className="risk-col">Medium risk</th></tr>
          </thead>
          <tbody>
            {pillarStats.map(pillar => (
              <tr key={pillar.name}>
                <td>{pillar.name}</td>
                <td className={`center ${pillar.highRisk > 0 ? 'has-risk' : ''}`}>{pillar.highRisk}</td>
                <td className={`center ${pillar.mediumRisk > 0 ? 'has-risk' : ''}`}>{pillar.mediumRisk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(findingsByPillarAndRisk).map(pillar => {
        const { highRisk, mediumRisk } = findingsByPillarAndRisk[pillar];
        const showHigh = (riskFilter === 'both' || riskFilter === 'high') && highRisk.length > 0;
        const showMedium = (riskFilter === 'both' || riskFilter === 'medium') && mediumRisk.length > 0;
        if (!showHigh && !showMedium) return null;
        
        return (
          <div key={pillar} className="pillar-findings-section">
            {showHigh && (
              <>
                <h3 className="risk-section-header">High risk</h3>
                <div className="pillar-header">{pillar}</div>
                {highRisk.map((finding) => renderFinding(finding))}
              </>
            )}
            {showMedium && (
              <>
                <h3 className="risk-section-header">Medium risk</h3>
                <div className="pillar-header">{pillar}</div>
                {mediumRisk.map((finding) => renderFinding(finding))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ImprovementPlan;
