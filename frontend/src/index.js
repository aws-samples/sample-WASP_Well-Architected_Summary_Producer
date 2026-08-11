import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initAuth } from './auth';

const root = ReactDOM.createRoot(document.getElementById('root'));

// Initialize authentication before rendering.
// In local dev (no config.json), this falls through and renders immediately.
// In production (CloudFront), redirects to Cognito Hosted UI if not authenticated.
initAuth().then((authenticated) => {
  if (authenticated || !window.location.hostname.includes('cloudfront')) {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
  // If not authenticated in production, initAuth already redirected to Cognito
}).catch(() => {
  // In local dev without config.json, render the app without auth
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
