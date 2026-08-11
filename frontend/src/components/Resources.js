import React from 'react';
import './Resources.css';

function Resources() {
  // AWS customer enablement services displayed in the hub-and-spoke diagram.
  // Each entry represents a service category that surrounds the central "Your AWS Journey" hub.
  // Ordered to spread evenly around the hub in the CSS grid layout.
  const services = [
    {
      icon: '📚',
      title: 'AWS Training & Certification',
      description: 'Build AWS Cloud skills with free digital training, classroom courses, and certification programs'
    },
    {
      icon: '🎯',
      title: 'AWS Professional Services',
      description: 'Work with AWS experts to accelerate cloud adoption and achieve business outcomes'
    },
    {
      icon: '🤝',
      title: 'AWS Partner Network',
      description: 'Connect with AWS Partners for consulting, implementation, and managed services'
    },
    {
      icon: '💬',
      title: 'AWS Support',
      description: 'Get technical support, guidance, and best practices from AWS Support engineers'
    },
    {
      icon: '🔧',
      title: 'AWS Managed Services',
      description: 'Operate your AWS infrastructure efficiently with AWS Managed Services'
    },
    {
      icon: '📖',
      title: 'AWS Documentation',
      description: 'Access comprehensive guides, API references, and tutorials for all AWS services'
    }
  ];

  // Curated link categories displayed in the "Additional Resources" grid.
  // Each category groups related external AWS documentation and tool links.
  // Links open in a new tab (target="_blank") with noopener for security.
  const resources = [
    {
      title: 'Well-Architected Framework',
      links: [
        { name: 'Framework Overview', url: 'https://aws.amazon.com/architecture/well-architected/' },
        { name: 'Whitepapers', url: 'https://aws.amazon.com/whitepapers/' },
        { name: 'Well-Architected Tool', url: 'https://console.aws.amazon.com/wellarchitected/' },
        { name: 'Lenses', url: 'https://docs.aws.amazon.com/wellarchitected/latest/userguide/lenses.html' }
      ]
    },
    {
      title: 'Architecture Resources',
      links: [
        { name: 'Architecture Center', url: 'https://aws.amazon.com/architecture/' },
        { name: 'Reference Architectures', url: 'https://aws.amazon.com/architecture/reference-architecture-diagrams/' },
        { name: 'This Is My Architecture', url: 'https://aws.amazon.com/architecture/this-is-my-architecture/' },
        { name: 'AWS Solutions Library', url: 'https://aws.amazon.com/solutions/' }
      ]
    },
    {
      title: 'Training & Learning',
      links: [
        { name: 'AWS Skill Builder', url: 'https://skillbuilder.aws/' },
        { name: 'AWS Training', url: 'https://aws.amazon.com/training/' },
        { name: 'AWS Certification', url: 'https://aws.amazon.com/certification/' },
        { name: 'AWS Workshops', url: 'https://workshops.aws/' }
      ]
    },
    {
      title: 'Support & Services',
      links: [
        { name: 'AWS Support Plans', url: 'https://aws.amazon.com/premiumsupport/' },
        { name: 'AWS Professional Services', url: 'https://aws.amazon.com/professional-services/' },
        { name: 'AWS Managed Services', url: 'https://aws.amazon.com/managed-services/' },
        { name: 'AWS Partner Network', url: 'https://aws.amazon.com/partners/' }
      ]
    }
  ];

  return (
    <div className="resources-page">
      <div className="section">
        <h2>AWS Customer Enablement Ecosystem</h2>
        <p className="help-text">
          AWS provides a comprehensive ecosystem of services and resources to help you succeed in the cloud.
        </p>

        {/*
          Hub-and-spoke layout: a central "Your AWS Journey" circle surrounded by
          service nodes. The hub sits in its own flex child (.ecosystem-hub) so it
          can be absolutely or grid-positioned at the centre, while .ecosystem-services
          wraps the spokes in a CSS grid that distributes them evenly around it.
          service-N classes let CSS position each node at a specific clock position.
        */}
        <div className="enablement-ecosystem">
          <div className="ecosystem-hub">
            <div className="hub-circle">
              <div className="hub-icon">☁️</div>
              <div className="hub-title">Your AWS Journey</div>
            </div>
          </div>

          <div className="ecosystem-services">
            {services.map((service, index) => (
              <div key={index} className={`service-node service-${index + 1}`}>
                <div className="service-icon">{service.icon}</div>
                <div className="service-title">{service.title}</div>
                <div className="service-description">{service.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Additional Resources</h2>
        <div className="resources-grid">
          {resources.map((category, index) => (
            <div key={index} className="resource-card">
              <h3>{category.title}</h3>
              <ul>
                {category.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="section disclaimer-section">
        <h2>Disclaimer</h2>
        <div className="disclaimer">
          <p>
            This tool provides a summary of AWS Well-Architected Review findings to help prioritize 
            improvement efforts. The recommendations are based on AWS best practices and should be 
            evaluated in the context of your specific workload requirements, business objectives, 
            and organizational constraints.
          </p>
          <p>
            Always consult with AWS Solutions Architects, AWS Professional Services, or AWS Partners 
            for detailed guidance on implementing these recommendations in your environment.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Resources;
