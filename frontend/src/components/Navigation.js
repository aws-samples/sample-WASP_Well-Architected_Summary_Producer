import React from 'react';
import './Navigation.css';

function Navigation({ currentPage, onNavigate }) {
  const pages = [
    { id: 'overview', label: 'Overview' },
    { id: 'framework', label: 'Framework' },
    { id: 'lens', label: 'Lens Overview' },
    { id: 'improvement', label: 'Improvement Plan' },
    { id: 'pillars', label: 'Pillar Details' },
    { id: 'findings', label: 'Prioritise Findings' },
    { id: 'plan', label: 'Implementation Plan' },
    { id: 'resources', label: 'Resources' }
  ];

  // mainPages are the four core workflow pages that get a 'primary-tab' CSS class,
  // visually distinguishing them as the main user journey (overview → improvement → findings → plan).
  // The other pages (framework, lens, pillars, resources) are supporting/reference pages.
  const mainPages = ['overview', 'improvement', 'findings', 'plan'];

  return (
    <nav className="main-nav">
      {pages.map(page => (
        <button
          key={page.id}
          className={`nav-btn ${currentPage === page.id ? 'active' : ''} ${mainPages.includes(page.id) ? 'primary-tab' : ''}`}
          onClick={() => onNavigate(page.id)}
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}

export default Navigation;
