/**
 * Cognito authentication module.
 * 
 * Handles OAuth2 authorization code flow with Cognito Hosted UI:
 * 1. Redirects to Cognito login if no tokens
 * 2. Exchanges authorization code for tokens
 * 3. Refreshes tokens before expiry
 * 4. Provides getToken() for API calls
 */

let config = null;
let tokens = null;

export async function loadConfig() {
  if (config) return config;
  const response = await fetch('/config.json');
  config = await response.json();
  return config;
}

export function getConfig() {
  return config;
}

export async function initAuth() {
  const cfg = await loadConfig();
  
  // Check for authorization code in URL (callback from Cognito)
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  
  if (code) {
    // Exchange code for tokens
    await exchangeCodeForTokens(code, cfg);
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }
  
  // Check for existing tokens in session storage
  const stored = sessionStorage.getItem('wasp_tokens');
  if (stored) {
    tokens = JSON.parse(stored);
    // Check if expired
    if (tokens.expiresAt && Date.now() < tokens.expiresAt) {
      return true;
    }
    // Try refresh
    if (tokens.refresh_token) {
      try {
        await refreshTokens(cfg);
        return true;
      } catch (e) {
        // Refresh failed — redirect to login
      }
    }
  }
  
  // No valid tokens — redirect to Cognito Hosted UI
  redirectToLogin(cfg);
  return false;
}

async function exchangeCodeForTokens(code, cfg) {
  const redirectUri = `${window.location.origin}/`;
  const tokenUrl = `https://${cfg.cognitoDomain}/oauth2/token`;
  
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.userPoolClientId,
    code,
    redirect_uri: redirectUri,
  });
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  
  if (!response.ok) {
    throw new Error('Token exchange failed');
  }
  
  const data = await response.json();
  tokens = {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  sessionStorage.setItem('wasp_tokens', JSON.stringify(tokens));
}

async function refreshTokens(cfg) {
  const tokenUrl = `https://${cfg.cognitoDomain}/oauth2/token`;
  
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.userPoolClientId,
    refresh_token: tokens.refresh_token,
  });
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  
  if (!response.ok) throw new Error('Token refresh failed');
  
  const data = await response.json();
  tokens = {
    ...tokens,
    id_token: data.id_token,
    access_token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  sessionStorage.setItem('wasp_tokens', JSON.stringify(tokens));
}

function redirectToLogin(cfg) {
  const redirectUri = `${window.location.origin}/`;
  const loginUrl = `https://${cfg.cognitoDomain}/login?client_id=${cfg.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location.href = loginUrl;
}

export function getToken() {
  // Try in-memory tokens first
  if (tokens && tokens.id_token) {
    if (tokens.expiresAt && Date.now() >= tokens.expiresAt) return null;
    return tokens.id_token;
  }
  // Fallback: read from session storage (handles race conditions on page load)
  const stored = sessionStorage.getItem('wasp_tokens');
  if (stored) {
    tokens = JSON.parse(stored);
    if (tokens.expiresAt && Date.now() >= tokens.expiresAt) return null;
    return tokens.id_token;
  }
  return null;
}

export function logout() {
  sessionStorage.removeItem('wasp_tokens');
  const cfg = getConfig();
  if (cfg) {
    const redirectUri = `${window.location.origin}/`;
    window.location.href = `https://${cfg.cognitoDomain}/logout?client_id=${cfg.userPoolClientId}&logout_uri=${encodeURIComponent(redirectUri)}`;
  }
}
