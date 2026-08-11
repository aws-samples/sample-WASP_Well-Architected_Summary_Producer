// Navigation utilities for cross-linking between pages

// Navigates to the Improvement Plan page and scrolls to a specific finding by ID.
// Used when a user clicks a finding link from Overview, PillarDetails, or LensOverview
// so they land directly on the relevant finding rather than the top of the page.
export const navigateToFinding = (findingId, setActivePage) => {
  setActivePage('improvement');
  
  // The 100ms delay is intentional: React needs one render cycle to mount the
  // Improvement Plan page before the target element exists in the DOM.
  // Without this delay, getElementById returns null and the scroll is a no-op.
  setTimeout(() => {
    const findingElement = document.getElementById(`finding-${findingId}`);
    if (findingElement) {
      findingElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief yellow highlight to draw the user's eye to the target finding.
      // The colour is removed after 2 seconds so it doesn't persist as a permanent style.
      findingElement.style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        findingElement.style.backgroundColor = '';
      }, 2000);
    }
  }, 100);
};

// Navigates to the Prioritise Findings page and scrolls to a specific finding in the key.
// Similar to navigateToFinding but targets the findings priority list rather than
// the improvement plan — used when cross-linking from the improvement plan to prioritisation.
export const navigateToPrioritiseFinding = (findingId, setActivePage) => {
  setActivePage('findings');
  
  // Same 100ms render-cycle delay as navigateToFinding — the findings page must
  // mount before we can query for the data-finding-id attribute.
  setTimeout(() => {
    const keyItem = document.querySelector(`[data-finding-id="${findingId}"]`);
    if (keyItem) {
      keyItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Same transient highlight pattern — yellow flash fades after 2 seconds.
      keyItem.style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        keyItem.style.backgroundColor = '';
      }, 2000);
    }
  }, 100);
};
