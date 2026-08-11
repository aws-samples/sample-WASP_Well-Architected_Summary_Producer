import React from 'react';
import './Framework.css';

function Framework() {
  // The six AWS Well-Architected Framework pillars, each with a CSS class name for
  // colour-coding and a description sourced from the official AWS WAF documentation.
  // Defined here as static data rather than fetched from the API because the pillar
  // definitions are stable and don't vary per workload.
  const pillars = [
    {
      name: 'Operational Excellence',
      className: 'operational-excellence',
      description: 'How your organization supports your business objectives, your ability to run workloads effectively, gain insight into their operations, and to continuously improve supporting processes and procedures to deliver business value.'
    },
    {
      name: 'Security',
      className: 'security',
      description: 'How to take advantage of cloud technologies to protect data, systems, and assets in a way that can improve your security posture.'
    },
    {
      name: 'Performance Efficiency',
      className: 'performance',
      description: 'Efficient use of computing resources to meet requirements, and how to maintain efficiency as demand changes and technologies evolve.'
    },
    {
      name: 'Reliability',
      className: 'reliability',
      description: 'The ability of a workload to perform its intended function correctly and consistently when it\'s expected to. This includes the ability to operate and test the workload through its total lifecycle.'
    },
    {
      name: 'Cost Optimization',
      className: 'cost',
      description: 'Build and operate cost-aware workloads that achieve business outcomes while minimizing costs and allowing your organization to maximize its return on investment.'
    },
    {
      name: 'Sustainability',
      className: 'sustainability',
      description: 'Understanding the impacts of the services used, quantifying impacts through the entire workload lifecycle, and applying design principles and best practices to reduce these impacts.'
    }
  ];

  return (
    <div className="framework-page">
      <div className="section">
        <h2>Pillars of Well-Architected</h2>
        <div className="pillars-overview">
          {pillars.map(pillar => (
            <div key={pillar.name} className={`pillar-card-detailed ${pillar.className}`}>
              <div className="pillar-header">
                <h3>{pillar.name}</h3>
              </div>
              <div className="pillar-description">
                <p>{pillar.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Introductory section — explains what WAF is for users unfamiliar with the programme */}
      <div className="section">
        <h2>What is AWS Well-Architected?</h2>
        <div className="info-card">
          <p><strong>AWS Well-Architected</strong> is a mechanism to help you build secure, high-performing, resilient, and efficient infrastructure for a variety of applications and workloads. Well-Architected gives customers access to the knowledge developed over thousands of architectural reviews with customers to ensure they are aware of best practices and reducing architectural risk.</p>
        </div>
      </div>

      {/* Value proposition section — the Learn/Measure/Improve loop is the core WAF narrative */}
      <div className="section">
        <h2>Why Does Well-Architected Exist?</h2>
        <div className="info-card">
          <p>With Well-Architected, we have built a mechanism where customers can:</p>
          <ul>
            <li><strong>Learn</strong> the strategies & best practices for architecting in the cloud</li>
            <li><strong>Measure</strong> their architecture against best practices</li>
            <li><strong>Improve</strong> their architecture by addressing any issues</li>
          </ul>
        </div>
      </div>

      {/* Legal disclaimer required when sharing WAF review outputs with customers */}
      <div className="section disclaimer-section">
        <h2>Disclaimer</h2>
        <div className="disclaimer">
          <p>All information, guidance and materials (collectively, "Information") provided to you in connection with the Program are for informational purposes only. You are solely responsible for making your own independent assessment of the Information and your use of AWS's products or services. Neither this document nor any other Information provided to you creates any warranties (express or implied), representations, contractual commitments, conditions or assurances from AWS, its affiliates, suppliers or licensors. Neither this document nor any other Information provided to you are part of, nor do they modify, any agreements between you and AWS.</p>
        </div>
      </div>
    </div>
  );
}

export default Framework;
