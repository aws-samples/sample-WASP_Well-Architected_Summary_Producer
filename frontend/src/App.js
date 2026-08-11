import { useState, useEffect, useRef } from 'react';
import './App.css';
import WorkloadSelector from './components/WorkloadSelector';
import Navigation from './components/Navigation';
import Overview from './components/Overview';
import Framework from './components/Framework';
import LensOverview from './components/LensOverview';
import ImprovementPlan from './components/ImprovementPlan';
import PillarDetails from './components/PillarDetails';
import FindingsPlot from './components/FindingsPlot';
import ImplementationPlan from './components/ImplementationPlan';
import Resources from './components/Resources';
import LensSelector from './components/LensSelector';
import { verifyCredentials, getPrioritization, getLensReview, listImprovements, listAnswers, listBedrockModels, getAiSummaries } from './api/wasp-api';
import { getStagingPosition } from './utils/stagingLayout';

function App() {
  const [loading, setLoading] = useState(true);
  const [selectedWorkload, setSelectedWorkload] = useState(null);
  const [selectedLens, setSelectedLens] = useState(null);
  const [lensData, setLensData] = useState(null);
  const [loadingLens, setLoadingLens] = useState(false);
  const [currentPage, setCurrentPage] = useState('overview');
  const [error, setError] = useState(null);
  const [plotPositions, setPlotPositions] = useState({});
  const [riskFilter, setRiskFilter] = useState({ high: true, medium: true });
  const [completedItems, setCompletedItems] = useState({});
  const [aiMode, setAiMode] = useState(false);
  const [aiModel, setAiModel] = useState('');
  const [bedrockModels, setBedrockModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [aiSummaries, setAiSummaries] = useState({});
  const [businessSummary, setBusinessSummary] = useState('');
  const [businessSummaryMeta, setBusinessSummaryMeta] = useState(null);
  const [qaHistory, setQaHistory] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const handleAiToggle = async () => {
    const newMode = !aiMode;
    setAiMode(newMode);
    if (newMode) {
      setLoadingModels(true);
      setModelsError(null);
      try {
        const data = await listBedrockModels();
        setBedrockModels(data.models || []);
        if (data.models?.length > 0) {
          setAiModel(data.models[0].modelId);
        }
      } catch (err) {
        console.error('Failed to load Bedrock models:', err);
        setModelsError(err.details || err.message || 'Failed to load models');
      } finally {
        setLoadingModels(false);
      }
    }
  };

  const checkAuth = async () => {
    try {
      await verifyCredentials();
      setLoading(false);
    } catch (err) {
      setError('AWS credentials not configured. Please configure your AWS credentials.');
      setLoading(false);
    }
  };

  const handleNavigate = async (page) => {
    // Note: Both FindingsPlot and ImplementationPlan have their own auto-save logic
    // that triggers on unmount, so we don't need to save here
    setCurrentPage(page);
  };

  // Custom lens aliases can be full ARNs (e.g. "arn:aws:wellarchitected::123:lens/abc"),
  // which contain characters DynamoDB rejects in key values. Strip everything except
  // alphanumerics, hyphens, and underscores so the composite key is always safe.
  const sanitizeLensKey = (alias) => (alias || '').replace(/[^a-zA-Z0-9-_]/g, '_');

  // When workload is selected, auto-select lens if only one.
  // selectedLens is intentionally excluded from deps: we only want this to fire
  // when the workload changes, not every time the lens changes (which would cause
  // an infinite loop when handleSelectLens sets selectedLens).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedWorkload && !selectedLens) {
      const lenses = selectedWorkload.lenses || [];
      if (lenses.length === 1) {
        handleSelectLens(lenses[0]);
      } else if (lenses.length === 0) {
        // Default to wellarchitected if no lenses listed
        handleSelectLens('wellarchitected');
      }
      // If multiple lenses, user must pick — LensSelector will show
    }
  }, [selectedWorkload]);

  // handleSelectLens orchestrates the full lens load:
  //   1. Resets all local state so stale data from a previous lens can't bleed through
  //   2. Fires four API calls in parallel (lens review, improvements, answers, saved positions)
  //      to minimise perceived load time — each is independent so there's no reason to sequence them
  //   3. Builds a findings list by joining improvements (what's wrong) with answers (what's selected)
  //      so each finding knows which best practices are still unimplemented
  //   4. Assigns default staging positions for every finding, then overlays any saved positions
  //      from DynamoDB — skipping stale completed positions (see comment below)
  const handleSelectLens = async (lensAlias) => {
    // Reset state for the new lens selection
    setSelectedLens(lensAlias);
    setLoadingLens(true);
    setPlotPositions({});
    setCompletedItems({});
    setAiSummaries({});
    setBusinessSummary('');
    setBusinessSummaryMeta(null);
    setQaHistory([]);
    setSummaryLoading(false);
    setSummaryError(null);
    
    try {
      const storageKey = `${selectedWorkload.workloadId}-${sanitizeLensKey(lensAlias)}`;
      
      const [lensReview, improvementsData, answersData, saved, cachedAi] = await Promise.all([
        getLensReview(selectedWorkload.workloadId, lensAlias),
        listImprovements(selectedWorkload.workloadId, lensAlias),
        listAnswers(selectedWorkload.workloadId, lensAlias),
        getPrioritization(storageKey),
        getAiSummaries(storageKey).catch(() => ({})),
      ]);
      
      const pillarMap = {
        'security': 'Security',
        'reliability': 'Reliability',
        'operationalExcellence': 'Operational Excellence',
        'performance': 'Performance Efficiency',
        'costOptimization': 'Cost Optimization',
        'sustainability': 'Sustainability'
      };
      
      const answersMap = {};
      answersData.answers.forEach(answer => {
        answersMap[answer.questionId] = answer;
      });
      
      const findings = improvementsData.improvements.map(improvement => {
        const answer = answersMap[improvement.questionId];
        
        const unselectedChoices = answer?.choices?.filter(choice => {
          if (choice.selected) return false;
          const title = (choice.title || '').toLowerCase();
          if (title.includes('none of') || title.includes('not applicable') ||
              choice.choiceId === 'no_choice' || choice.choiceId === 'none') return false;
          return true;
        }) || [];
        
        const allActionableChoices = answer?.choices?.filter(choice => {
          const title = (choice.title || '').toLowerCase();
          if (title.includes('none of') || title.includes('not applicable') ||
              choice.choiceId === 'no_choice' || choice.choiceId === 'none') return false;
          return true;
        }) || [];
        
        return {
          questionId: improvement.questionId,
          questionTitle: improvement.questionTitle,
          pillar: pillarMap[improvement.pillarId] || improvement.pillarId,
          risk: improvement.risk.toLowerCase(),
          improvementPlanUrl: improvement.improvementPlanUrl,
          bestPractices: unselectedChoices,
          allChoices: allActionableChoices,
          lensAlias: improvement.lensAlias || lensAlias,
          lensVersion: lensReview.lensVersion
        };
      });
      
      setLensData({
        lensAlias,
        lensVersion: lensReview.lensVersion,
        lensName: lensReview.lensName || lensAlias,
        pillarReviewSummaries: lensReview.pillarReviewSummaries || [],
        questionsAnswered: lensReview.pillarReviewSummaries?.reduce((sum, pillar) => 
          sum + (pillar.questionsAnswered || 0), 0) || 0,
        findings
      });
      
      const filtered = findings.filter(f => f.risk === 'high' || f.risk === 'medium');
      const positions = {};
      filtered.forEach((finding, index) => {
        positions[finding.questionId] = getStagingPosition(index);
      });
      
      // Load saved state from DB (fetched in parallel above)
      const savedPositions = saved?.prioritization?.plotPositions || {};
      const savedCompleted = saved?.prioritization?.completedItems || {};
      const savedRiskFilter = saved?.prioritization?.riskFilter;
      
      // Overlay saved positions — skip stale completed positions.
      // A position is "stale completed" when it sits in the completed zone (y > 600 or
      // pos.completed === true) but has no matching completedItems entry, or the entry
      // has wasReset=true. This happens when a user resets a question after a milestone:
      // the position record still says completed but the item was intentionally un-completed.
      // Applying it would silently re-complete the item on next load, so we drop it.
      Object.entries(savedPositions).forEach(([key, pos]) => {
        if (!positions[key]) return;
        const y = typeof pos.y === 'string' ? parseFloat(pos.y) : pos.y;
        const isCompletedPos = (pos.completed === true || y > 600);
        const itemKey = `${storageKey}-${key}`;
        const hasCompletedEntry = savedCompleted[itemKey] && !savedCompleted[itemKey].wasReset;
        if (isCompletedPos && !hasCompletedEntry) return;
        positions[key] = {
          x: typeof pos.x === 'string' ? parseFloat(pos.x) : pos.x,
          y,
          staged: pos.staged,
          completed: pos.completed || false
        };
      });
      
      setPlotPositions(positions);
      if (savedRiskFilter) setRiskFilter(savedRiskFilter);
      setCompletedItems(savedCompleted);
      
      // Load cached AI summaries and business summary (fetched in parallel above)
      if (cachedAi.aiSummaries && Object.keys(cachedAi.aiSummaries).length > 0) {
        setAiSummaries(cachedAi.aiSummaries);
      }
      if (cachedAi.businessSummary) {
        setBusinessSummary(cachedAi.businessSummary.summary || '');
        setBusinessSummaryMeta({
          inputTokens: cachedAi.businessSummary.inputTokens || 0,
          outputTokens: cachedAi.businessSummary.outputTokens || 0,
          modelId: cachedAi.businessSummary.modelId || '',
          fromCache: true,
        });
      }
      
      
    } catch (err) {
      console.error('Error loading lens data:', err);
      setError('Failed to load lens data: ' + err.message);
    } finally {
      setLoadingLens(false);
    }
  };

  // Reset state when workload changes
  const prevWorkloadIdRef = useRef(null);
  useEffect(() => {
    if (selectedWorkload && selectedWorkload.workloadId !== prevWorkloadIdRef.current) {
      const isDifferentWorkload = prevWorkloadIdRef.current !== null;
      prevWorkloadIdRef.current = selectedWorkload.workloadId;
      
      if (isDifferentWorkload) {
        setSelectedLens(null);
        setLensData(null);
        setPlotPositions({});
        setRiskFilter({ high: true, medium: true });
        setCompletedItems({});
        setAiSummaries({});
        setBusinessSummary('');
        setBusinessSummaryMeta(null);
        setQaHistory([]);
        setSummaryLoading(false);
        setSummaryError(null);
        setCurrentPage('overview');
      }
    }
  }, [selectedWorkload]);

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading">Checking AWS credentials...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container">
        <div className="error-container">
          <h2>⚠️ Configuration Required</h2>
          <p>{error}</p>
          <div className="help-text">
            <p>To use WASP, you need to configure AWS credentials with access to:</p>
            <ul>
              <li>AWS Well-Architected Tool (wellarchitected:*)</li>
              <li>DynamoDB (dynamodb:*)</li>
            </ul>
            <p>Set your credentials using environment variables or AWS CLI configuration.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1>Well-Architected Summary Producer (WASP) 🐝</h1>
        </div>
        <div className="subtitle-row">
          <p className="subtitle">Interactive Findings Analysis & Implementation Planning</p>
          <div className="ai-mode-toggle">
            <span className="ai-mode-label">AI Mode</span>
            <button
              className={`toggle-switch ${aiMode ? 'active' : ''}`}
              onClick={handleAiToggle}
              aria-pressed={aiMode}
              aria-label="Toggle AI Mode"
            >
              <span className="toggle-knob" />
            </button>
            {aiMode && (
              <select
                className="model-selector"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                disabled={loadingModels}
                aria-label="Select Bedrock model"
              >
                {loadingModels ? (
                  <option>Loading models...</option>
                ) : modelsError ? (
                  <option>Error: {modelsError}</option>
                ) : bedrockModels.length === 0 ? (
                  <option>No models available</option>
                ) : (
                  bedrockModels.map(m => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.providerName} — {m.modelName}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>
      </header>

      {!selectedWorkload ? (
        <WorkloadSelector onSelectWorkload={setSelectedWorkload} />
      ) : selectedWorkload.lenses && selectedWorkload.lenses.length > 1 && !selectedLens ? (
        <LensSelector 
          workload={selectedWorkload} 
          onSelectLens={handleSelectLens}
          onBack={() => setSelectedWorkload(null)}
        />
      ) : loadingLens ? (
        <div className="loading">Loading lens data...</div>
      ) : lensData ? (
        <div className="workload-view">
          <div className="workload-header">
            <h2>{selectedWorkload.workloadName}{selectedWorkload.lenses && selectedWorkload.lenses.length > 1 ? ` — ${lensData.lensName}` : ''}</h2>
            <div>
              {selectedWorkload.lenses && selectedWorkload.lenses.length > 1 && (
                <button 
                  className="btn-secondary"
                  onClick={() => { setSelectedLens(null); setLensData(null); setAiSummaries({}); setBusinessSummary(''); setBusinessSummaryMeta(null); setQaHistory([]); setCurrentPage('overview'); }}
                  style={{ marginRight: '0.5rem' }}
                >
                  ← Change Lens
                </button>
              )}
              <button 
                className="btn-secondary"
                onClick={() => { setSelectedWorkload(null); setSelectedLens(null); setLensData(null); }}
              >
                ← Change Workload
              </button>
            </div>
          </div>
          
          <Navigation currentPage={currentPage} onNavigate={handleNavigate} />
          
          {currentPage === 'overview' && <Overview key={selectedLens} workload={{...selectedWorkload, ...lensData, storageKey: `${selectedWorkload.workloadId}-${sanitizeLensKey(selectedLens)}`}} findings={lensData.findings || []} setActivePage={setCurrentPage} aiMode={aiMode} aiModel={aiModel} aiSummaries={aiSummaries} setAiSummaries={setAiSummaries} businessSummary={businessSummary} setBusinessSummary={setBusinessSummary} businessSummaryMeta={businessSummaryMeta} setBusinessSummaryMeta={setBusinessSummaryMeta} qaHistory={qaHistory} setQaHistory={setQaHistory} summaryLoading={summaryLoading} setSummaryLoading={setSummaryLoading} summaryError={summaryError} setSummaryError={setSummaryError} />}
          {currentPage === 'framework' && <Framework />}
          {currentPage === 'lens' && <LensOverview workload={{...selectedWorkload, ...lensData}} findings={lensData.findings || []} setActivePage={setCurrentPage} />}
          {currentPage === 'improvement' && <ImprovementPlan key={selectedLens} workload={{...selectedWorkload, ...lensData}} findings={lensData.findings || []} setActivePage={setCurrentPage} aiSummaries={aiSummaries} />}
          {currentPage === 'pillars' && <PillarDetails findings={lensData.findings || []} pillarSummaries={lensData.pillarReviewSummaries || []} setActivePage={setCurrentPage} />}
          {currentPage === 'findings' && <FindingsPlot workload={{...selectedWorkload, storageKey: `${selectedWorkload.workloadId}-${sanitizeLensKey(selectedLens)}`}} findings={lensData.findings || []} setActivePage={setCurrentPage} plotPositions={plotPositions} setPlotPositions={setPlotPositions} riskFilter={riskFilter} setRiskFilter={setRiskFilter} completedItems={completedItems} setCompletedItems={setCompletedItems} aiMode={aiMode} aiModel={aiModel} aiSummaries={aiSummaries} businessSummary={businessSummary} />}
          {currentPage === 'plan' && <ImplementationPlan workload={{...selectedWorkload, storageKey: `${selectedWorkload.workloadId}-${sanitizeLensKey(selectedLens)}`}} findings={lensData.findings || []} setActivePage={setCurrentPage} plotPositions={plotPositions} setPlotPositions={setPlotPositions} completedItems={completedItems} setCompletedItems={setCompletedItems} reloadLens={() => handleSelectLens(selectedLens)} />}
          {currentPage === 'resources' && <Resources />}
        </div>
      ) : (
        <div className="loading">Loading...</div>
      )}
    </div>
  );
}

export default App;
