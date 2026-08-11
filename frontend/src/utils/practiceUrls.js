/**
 * Shared URL resolution logic for Well-Architected best practices.
 * Used by ImprovementPlan (for rendering links) and Overview (for AI enrichment).
 */

const STEP_URL_LENSES = new Set(['softwareasaservice', 'serverless']);
const LENS_URL_PREFIX = { softwareasaservice: 'saas', serverless: 'serv' };
const LENS_DOCS_SLUG = {
  wellarchitected: 'framework',
  serverless: 'serverless-applications-lens',
  softwareasaservice: 'saas-lens',
  'arn:aws:wellarchitected::aws:lens/genai': 'generative-ai-lens',
  'arn:aws:wellarchitected::aws:lens/machinelearning': 'machine-learning-lens',
  'arn:aws:wellarchitected::aws:lens/data-analytics': 'data-analytics-lens',
  'arn:aws:wellarchitected::aws:lens/financial-services': 'financial-services-industry-lens',
  'arn:aws:wellarchitected::aws:lens/iot': 'iot-lens',
  'arn:aws:wellarchitected::aws:lens/games': 'games-industry-lens',
  'arn:aws:wellarchitected::aws:lens/container-build': 'container-build-lens',
  'arn:aws:wellarchitected::aws:lens/hybrid-networking': 'hybrid-networking-lens',
};

const formatQuestionIdForUrl = (questionId) => {
  const match = questionId.match(/^(.+)_q(\d+)$/i);
  if (match) return `${match[1].toUpperCase()}_${match[2]}`;
  return questionId.toUpperCase();
};

const getStepUrl = (finding, stepIndex) => {
  const lens = finding.lensAlias || 'wellarchitected';
  let version = finding.lensVersion || 'latest';
  if (finding.improvementPlanUrl) {
    const m = finding.improvementPlanUrl.match(/wa\.aws\.amazon\.com\/[^/]+\/([^/]+)\//);
    if (m) version = m[1];
  }
  const prefix = LENS_URL_PREFIX[lens] || lens;
  const fmtId = formatQuestionIdForUrl(finding.questionId);
  return `https://wa.aws.amazon.com/${lens}/${version}/${prefix}.question.${fmtId}.en.html#step${stepIndex + 1}`;
};

export function getQuestionUrl(finding) {
  if (finding.improvementPlanUrl && !finding.improvementPlanUrl.includes('wellarchitected/latest/framework/welcome')) {
    return finding.improvementPlanUrl;
  }
  const lens = finding.lensAlias || 'wellarchitected';
  if (STEP_URL_LENSES.has(lens)) {
    const version = finding.lensVersion || 'latest';
    const prefix = LENS_URL_PREFIX[lens] || lens;
    const fmtId = formatQuestionIdForUrl(finding.questionId);
    return `https://wa.aws.amazon.com/${lens}/${version}/${prefix}.question.${fmtId}.en.html`;
  }
  const slug = LENS_DOCS_SLUG[lens];
  if (slug) {
    const paddedId = finding.questionId.replace(/(\D)(\d)$/, '$10$2');
    return `https://docs.aws.amazon.com/wellarchitected/latest/${slug}/${paddedId}.html`;
  }
  const arnMatch = lens.match(/lens\/(.+)$/);
  if (arnMatch) {
    const derivedSlug = arnMatch[1] + '-lens';
    const paddedId = finding.questionId.replace(/(\D)(\d)$/, '$10$2');
    return `https://docs.aws.amazon.com/wellarchitected/latest/${derivedSlug}/${paddedId}.html`;
  }
  return null;
}

export function getPracticeUrl(practice, finding, stepIndex) {
  const lens = finding.lensAlias || 'wellarchitected';
  if (STEP_URL_LENSES.has(lens)) {
    const allChoices = finding.allChoices || [];
    const globalIndex = allChoices.findIndex(c => c.choiceId === practice.choiceId);
    const step = globalIndex !== -1 ? globalIndex : stepIndex;
    return getStepUrl(finding, step);
  }
  if (practice.improvementPlan && practice.improvementPlan.Url) {
    return practice.improvementPlan.Url;
  }
  if (practice.helpfulResource && practice.helpfulResource.Url) {
    return practice.helpfulResource.Url;
  }
  if (practice.choiceId) {
    const slug = LENS_DOCS_SLUG[lens] || 'framework';
    return `https://docs.aws.amazon.com/wellarchitected/latest/${slug}/${practice.choiceId}.html`;
  }
  return getQuestionUrl(finding);
}
