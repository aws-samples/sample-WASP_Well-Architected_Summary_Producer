/**
 * WASP API Client
 * Handles all communication with the Python backend.
 * All functions are async and throw WASPApiError on non-2xx responses.
 */

import { getToken, getConfig } from '../auth';

// Base URL for all API calls. In production, loaded from config.json (deployed by CDK).
// In local development, defaults to localhost:5001.
function getApiBaseUrl() {
    const config = getConfig();
    if (config && config.apiUrl) {
        return config.apiUrl.replace(/\/$/, '') + '/api';
    }
    return process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
}

// Custom error class that preserves the HTTP status code and any detail payload
// returned by the backend, making it easier for callers to handle specific error cases.
class WASPApiError extends Error {
    constructor(message, status, details) {
        super(message);
        this.name = 'WASPApiError';
        this.status = status;
        this.details = details;
    }
}

// Helper to build headers with auth token
function authHeaders(extra = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Parses the JSON response and throws WASPApiError for non-2xx status codes.
// Centralising this logic means every API function gets consistent error handling
// without duplicating the response.ok check everywhere.
async function handleResponse(response) {
    const data = await response.json();
    
    if (!response.ok) {
        throw new WASPApiError(
            data.error || 'API request failed',
            response.status,
            data.details
        );
    }
    
    return data;
}

// Polls an async job until completion or failure.
// Returns the job result on success, throws on failure or timeout.
async function pollJob(jobId, { interval = 3000, maxAttempts = 200 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        
        const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`, { headers: authHeaders() });
        
        if (response.status === 401) {
            throw new WASPApiError('Session expired. Please refresh the page and sign in again.', 401);
        }
        
        const data = await response.json();
        
        if (data.status === 'COMPLETED') {
            return data.result;
        }
        if (data.status === 'FAILED') {
            throw new WASPApiError(
                data.result?.error || 'Async operation failed',
                500,
                data.result?.type
            );
        }
        // Still PROCESSING — continue polling
    }
    throw new WASPApiError('Operation timed out', 504);
}

// Handles responses that may be synchronous (200) or async (202 with jobId).
// For 202 responses, polls until the job completes.
async function handleAsyncResponse(response) {
    const data = await response.json();
    
    if (!response.ok && response.status !== 202) {
        throw new WASPApiError(
            data.error || 'API request failed',
            response.status,
            data.details
        );
    }
    
    // Async operation — poll for result
    if (response.status === 202 && data.jobId) {
        return pollJob(data.jobId);
    }
    
    // Synchronous response
    return data;
}

// ============================================================================
// Authentication
// ============================================================================

// Verifies that the backend has valid AWS credentials configured.
// Returns { valid: true } on success, or throws WASPApiError if credentials
// are missing or expired. Called on app load to gate access to the rest of the UI.
export async function verifyCredentials() {
    const response = await fetch(`${getApiBaseUrl()}/auth/verify`, { headers: authHeaders() });
    return handleResponse(response);
}

// ============================================================================
// Workload Operations
// ============================================================================

// Fetches a paginated list of all Well-Architected workloads visible to the
// configured AWS credentials. Returns { workloads: [...] } with summary objects
// (name, owner, riskCounts, etc.) — not full workload details.
export async function listWorkloads() {
    const response = await fetch(`${getApiBaseUrl()}/workloads`, { headers: authHeaders() });
    return handleResponse(response);
}

// Fetches full details for a single workload by ID, including lenses,
// pillarReviewSummaries, and all metadata needed to render the review pages.
// Returns the workload object directly (not wrapped in a list).
export async function getWorkload(workloadId) {
    const response = await fetch(`${getApiBaseUrl()}/workloads/${workloadId}`, { headers: authHeaders() });
    return handleResponse(response);
}

// Fetches the lens review summary for a workload, including risk counts per pillar
// and the lens version string. Defaults to the standard Well-Architected lens.
// Returns { lensReview: { ... } } with pillarReviewSummaries and riskCounts.
export async function getLensReview(workloadId, lensAlias = 'wellarchitected') {
    const response = await fetch(
        `${getApiBaseUrl()}/workloads/${workloadId}/lens-review?lensAlias=${lensAlias}`,
        { headers: authHeaders() }
    );
    return handleResponse(response);
}

// Fetches all question answers for a workload, optionally filtered to a single pillar.
// Returns { answers: [...] } where each answer includes the question, selected choices,
// risk level, and notes. Used to build the improvement plan and findings views.
export async function listAnswers(workloadId, lensAlias = 'wellarchitected', pillarId = null) {
    let url = `${getApiBaseUrl()}/workloads/${workloadId}/answers?lensAlias=${lensAlias}`;
    if (pillarId) {
        url += `&pillarId=${pillarId}`;
    }
    const response = await fetch(url, { headers: authHeaders() });
    return handleResponse(response);
}

// Fetches improvement recommendations for a workload, optionally filtered to a pillar.
// Returns { improvements: [...] } where each item includes the question, risk level,
// improvement plan text, and helpful resource links from the Well-Architected Tool best practices library.
export async function listImprovements(workloadId, lensAlias = 'wellarchitected', pillarId = null) {
    let url = `${getApiBaseUrl()}/workloads/${workloadId}/improvements?lensAlias=${lensAlias}`;
    if (pillarId) {
        url += `&pillarId=${pillarId}`;
    }
    const response = await fetch(url, { headers: authHeaders() });
    return handleResponse(response);
}

// Creates a named milestone snapshot of the workload's current review state.
// Milestones are immutable snapshots in the Well-Architected Tool — useful for tracking progress
// over time or before/after a remediation sprint.
// Returns { milestone: { milestoneNumber, milestoneName, ... } }.
export async function createMilestone(workloadId, milestoneName) {
    const response = await fetch(`${getApiBaseUrl()}/workloads/${workloadId}/milestones`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ milestoneName })
    });
    return handleResponse(response);
}

// ============================================================================
// Prioritization Data (DynamoDB)
// ============================================================================

// Fetches the saved prioritization data for a workload from DynamoDB.
// Returns { prioritization: { ... } } with user-assigned priorities and notes,
// or { prioritization: null } if no prioritization has been saved yet (404 → null).
export async function getPrioritization(workloadId) {
    const response = await fetch(`${getApiBaseUrl()}/prioritizations/${workloadId}`, { headers: authHeaders() });
    
    // 404 is expected for workloads that haven't been prioritised yet — treat as empty.
    if (response.status === 404) {
        return { prioritization: null };
    }
    
    return handleResponse(response);
}

// Saves (upserts) prioritization data for a workload to DynamoDB.
// Uses PUT so it creates or replaces the existing record.
// The data object should contain the full prioritization state to persist.
export async function savePrioritization(workloadId, data) {
    const response = await fetch(`${getApiBaseUrl()}/prioritizations/${workloadId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response);
}

// Updates a single question answer in the Well-Architected Tool via the backend.
// replaceMode=true replaces all selected choices; false merges with existing selections.
// isApplicable=false with a reason marks the question as not applicable to this workload.
// Returns the updated answer object.
export async function updateAnswer(workloadId, questionId, selectedChoices, lensAlias = 'wellarchitected', notes = '', isApplicable = true, reason = null, replaceMode = false) {
    const response = await fetch(`${getApiBaseUrl()}/workloads/${workloadId}/answers/${questionId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
            lensAlias,
            selectedChoices,
            notes,
            isApplicable,
            reason,
            replaceMode
        })
    });
    return handleResponse(response);
}

export { WASPApiError };

// ============================================================================
// Bedrock Models
// ============================================================================

// Fetches available Bedrock on-demand foundation models from the user's account.
// Returns { models: [...] } with modelId, modelName, providerName, etc.
export async function listBedrockModels() {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/models`, { headers: authHeaders() });
    return handleResponse(response);
}

// Generates a business summary of the Well-Architected review using a Bedrock model.
// Returns { summary, modelId, inputTokens, outputTokens, aiSummaries }.
export async function generateBusinessSummary(modelId, workloadContext, findingsSummary, storageKey, regenerate = false) {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/generate-summary`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ modelId, workloadContext, findingsSummary, storageKey, regenerate })
    });
    return handleAsyncResponse(response);
}

// Retrieves cached AI summaries and business summary for a workload/lens from DynamoDB.
// Returns { aiSummaries: { url: summaryText, ... }, businessSummary?: { summary, modelId, ... } }.
export async function getAiSummaries(storageKey) {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/ai-summaries/${encodeURIComponent(storageKey)}`, { headers: authHeaders() });
    return handleResponse(response);
}

// Asks a follow-up question about the business summary using a Bedrock model.
// Returns { answer, modelId, inputTokens, outputTokens }.
export async function askSummaryQuestion(modelId, question, businessSummary, workloadContext, findingsSummary) {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/ask`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ modelId, question, businessSummary, workloadContext, findingsSummary })
    });
    return handleResponse(response);
}


// Asks AI to recommend Eisenhower matrix positions for all findings.
// Returns { positions: [{ questionId, x, y, reason }], modelId, inputTokens, outputTokens }.
export async function recommendPositions(modelId, businessSummary, findings) {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/recommend-positions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ modelId, businessSummary, findings })
    });
    return handleAsyncResponse(response);
}

// Asks a follow-up question about the AI-recommended positions.
// Returns { answer, modelId, inputTokens, outputTokens }.
export async function askPositionsQuestion(modelId, question, businessSummary, positionReasons) {
    const response = await fetch(`${getApiBaseUrl()}/bedrock/ask-positions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ modelId, question, businessSummary, positionReasons })
    });
    return handleResponse(response);
}
