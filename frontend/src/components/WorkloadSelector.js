import React, { useState, useEffect } from 'react';
import { listWorkloads, getWorkload } from '../api/wasp-api';
import './WorkloadSelector.css';

function WorkloadSelector({ onSelectWorkload }) {
  // workloads: list of workload summaries fetched from the API
  const [workloads, setWorkloads] = useState([]);
  // loading: true while the initial workload list is being fetched
  const [loading, setLoading] = useState(true);
  // loadingWorkload: true while fetching full details for a selected workload
  const [loadingWorkload, setLoadingWorkload] = useState(false);
  // error: holds an error message string if any API call fails
  const [error, setError] = useState(null);

  // Fetch the workload list on mount. No dependencies — runs once when the selector mounts.
  useEffect(() => {
    loadWorkloads();
  }, []);

  // Fetches the list of workloads from the backend API and stores them in state.
  // Called on mount and also wired to the "Retry" button on error.
  const loadWorkloads = async () => {
    try {
      const data = await listWorkloads();
      const sorted = (data.workloads || []).sort((a, b) => 
        new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      setWorkloads(sorted);
    } catch (err) {
      setError('Failed to load workloads: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetches full workload details (including lenses, pillar summaries, etc.) for the
  // selected workload summary. The list API only returns summary data, so we need a
  // second call to get everything the rest of the app needs. Calls onSelectWorkload
  // with the full details object to hand off to the parent.
  const handleSelectWorkload = async (workloadSummary) => {
    setLoadingWorkload(true);
    setError(null);
    
    try {
      const workloadDetails = await getWorkload(workloadSummary.workloadId);
      onSelectWorkload(workloadDetails);
    } catch (err) {
      setError('Failed to load workload details: ' + err.message);
    } finally {
      setLoadingWorkload(false);
    }
  };

  if (loading) {
    return <div className="workload-selector loading">Loading workloads...</div>;
  }

  if (loadingWorkload) {
    return <div className="workload-selector loading">Loading workload details...</div>;
  }

  if (error) {
    return (
      <div className="workload-selector error">
        <p>{error}</p>
        <button onClick={loadWorkloads}>Retry</button>
      </div>
    );
  }

  if (workloads.length === 0) {
    return (
      <div className="workload-selector empty">
        <h3>No Workloads Found</h3>
        <p>No Well-Architected workloads found in your AWS account.</p>
        <p>Create a workload in the AWS Well-Architected Tool to get started.</p>
      </div>
    );
  }

  return (
    <div className="workload-selector">
      <h2>Select a Workload</h2>
      <div className="workload-grid">
        {workloads.map((workload) => (
          <div
            key={workload.workloadId}
            className="workload-card"
            onClick={() => handleSelectWorkload(workload)}
          >
            <h3>{workload.workloadName}</h3>
            <div className="workload-meta">
              <span>Owner: {workload.owner}</span>
              <span>Updated: {new Date(workload.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="risk-summary">
              {workload.riskCounts && (
                <>
                  <span className="risk-high">
                    High: {workload.riskCounts.HIGH || 0}
                  </span>
                  <span className="risk-medium">
                    Medium: {workload.riskCounts.MEDIUM || 0}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkloadSelector;
