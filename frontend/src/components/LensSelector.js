import React from 'react';
import './WorkloadSelector.css';

function LensSelector({ workload, onSelectLens, onBack }) {
  const lenses = (workload.lenses || []).slice().sort((a, b) => {
    if (a === 'wellarchitected') return -1;
    if (b === 'wellarchitected') return 1;
    return 0;
  });

  // Maps well-known lens aliases and ARNs to human-readable display names.
  // Covers all official AWS lenses; custom/partner lenses fall through to the ARN parser below.
  const lensDisplayNames = {
    'wellarchitected': 'AWS Well-Architected Framework',
    'serverless': 'Serverless Lens',
    'softwareasaservice': 'SaaS Lens',
    'arn:aws:wellarchitected::aws:lens/genai': 'Generative AI Lens',
    'arn:aws:wellarchitected::aws:lens/machinelearning': 'Machine Learning Lens',
    'arn:aws:wellarchitected::aws:lens/data-analytics': 'Data Analytics Lens',
    'arn:aws:wellarchitected::aws:lens/financial-services': 'Financial Services Lens',
    'arn:aws:wellarchitected::aws:lens/healthcare': 'Healthcare Lens',
    'arn:aws:wellarchitected::aws:lens/iot': 'IoT Lens',
    'arn:aws:wellarchitected::aws:lens/games': 'Games Lens',
    'arn:aws:wellarchitected::aws:lens/hybrid-networking': 'Hybrid Networking Lens',
    'arn:aws:wellarchitected::aws:lens/management-and-governance': 'Management & Governance Lens',
    'arn:aws:wellarchitected::aws:lens/migration': 'Migration Lens',
    'arn:aws:wellarchitected::aws:lens/streaming-media': 'Streaming Media Lens',
    'arn:aws:wellarchitected::aws:lens/container-build': 'Container Build Lens',
  };

  // Resolves a lens alias or ARN to a display name.
  // For known aliases, returns the mapped name. For unknown ARNs (e.g. custom lenses),
  // extracts the slug after 'lens/' and title-cases each word, appending ' Lens'.
  const getDisplayName = (alias) => {
    if (lensDisplayNames[alias]) return lensDisplayNames[alias];
    // Extract readable name from ARN: arn:aws:wellarchitected::aws:lens/name → Name Lens
    const arnMatch = alias.match(/lens\/(.+)$/);
    if (arnMatch) {
      return arnMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Lens';
    }
    return alias;
  };

  return (
    <div className="workload-selector">
      <h2>Select a Lens</h2>
      <p style={{ marginBottom: '1rem', color: '#687078' }}>
        Workload <strong>{workload.workloadName}</strong> has {lenses.length} lenses. Select one to review.
      </p>
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: '1rem' }}>
        ← Change Workload
      </button>
      <div className="workload-grid">
        {lenses.map((lensAlias) => (
          <div
            key={lensAlias}
            className="workload-card"
            onClick={() => onSelectLens(lensAlias)}
          >
            <h3>{getDisplayName(lensAlias)}</h3>
            <div className="workload-meta">
              <span>Alias: {lensAlias}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LensSelector;
