// scripts/lib/manifest-rules.mjs — pure validation, returns string[] of plain-language errors.
export const KNOWN_STACKS = ['static-html', 'react-ts', 'python-api'];
export const KNOWN_SHAPES = ['web-api', 'agent', 'streaming', 'batch'];
export const KNOWN_MODELS = [
  'anthropic.claude-opus-4-8',
  'anthropic.claude-sonnet-4-6',
  'anthropic.claude-haiku-4-5',
  'amazon.nova-lite',
];
export const PII_MODES = ['none', 'redact', 'block'];
export const ISOLATION = ['shared', 'dedicated-db', 'dedicated-account'];
const NAME_RE = /^[a-z][a-z0-9-]{2,39}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateManifest(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['app.yaml: file is empty or not a mapping.'];
  if (m.apiVersion !== 'vibeapp/v1') e.push(`app.yaml: "apiVersion" must be "vibeapp/v1" (got ${JSON.stringify(m.apiVersion)}).`);
  if (m.kind !== 'App') e.push(`app.yaml: "kind" must be "App" (got ${JSON.stringify(m.kind)}).`);
  if (m.metadata !== undefined && !isMap(m.metadata)) e.push('app.yaml: "metadata" must be a mapping (name/owner/description).');
  const md = isMap(m.metadata) ? m.metadata : {};
  if (!NAME_RE.test(md.name || '')) e.push(`app.yaml: "metadata.name" must be a dns-safe slug: lowercase letter then 2-39 of [a-z0-9-] (got ${JSON.stringify(md.name)}).`);
  if (!EMAIL_RE.test(md.owner || '')) e.push(`app.yaml: "metadata.owner" must be an email address (got ${JSON.stringify(md.owner)}).`);
  if (typeof md.description !== 'string' || md.description.length < 1 || md.description.length > 200) e.push('app.yaml: "metadata.description" is required and must be a string of 1-200 chars.');
  if (m.spec !== undefined && !isMap(m.spec)) e.push('app.yaml: "spec" must be a mapping.');
  const s = isMap(m.spec) ? m.spec : {};
  if (!KNOWN_STACKS.includes(s.stack)) e.push(`app.yaml: "spec.stack" is ${JSON.stringify(s.stack)}; allowed: ${KNOWN_STACKS.join(', ')}.`);
  if (!KNOWN_SHAPES.includes(s.shape)) e.push(`app.yaml: "spec.shape" is ${JSON.stringify(s.shape)}; allowed: ${KNOWN_SHAPES.join(', ')}.`);
  if (s.resources !== undefined && !isMap(s.resources)) e.push('app.yaml: "spec.resources" must be a mapping of database/storage/queue booleans.');
  const r = isMap(s.resources) ? s.resources : {};
  for (const k of ['database', 'storage', 'queue']) {
    if (r[k] !== undefined && typeof r[k] !== 'boolean') e.push(`app.yaml: "spec.resources.${k}" must be true or false.`);
  }
  if (s.ai !== undefined && !isMap(s.ai)) e.push('app.yaml: "spec.ai" must be a mapping (enabled/models/budget).');
  const ai = isMap(s.ai) ? s.ai : {};
  if (ai.enabled !== undefined && typeof ai.enabled !== 'boolean') e.push('app.yaml: "spec.ai.enabled" must be true or false.');
  if (ai.enabled === true) {
    if (!Array.isArray(ai.models) || ai.models.length === 0) {
      e.push('app.yaml: "spec.ai.models" must list at least one model when ai is enabled.');
    } else {
      for (const mdl of ai.models) {
        if (!KNOWN_MODELS.includes(mdl)) e.push(`app.yaml: "spec.ai.models" lists ${JSON.stringify(mdl)} which isn't an allowed model. Allowed: ${KNOWN_MODELS.join(', ')}.`);
      }
    }
    const budget = (ai.budget || {}).monthlyUsd;
    if (typeof budget !== 'number' || budget <= 0) e.push('app.yaml: "spec.ai.budget.monthlyUsd" must be a number greater than 0 when ai is enabled.');
  }
  const egress = (s.network || {}).egress;
  if (egress !== undefined) {
    if (!Array.isArray(egress)) e.push('app.yaml: "spec.network.egress" must be a list of hostnames.');
    else for (const h of egress) {
      if (typeof h !== 'string' || !HOST_RE.test(h)) e.push(`app.yaml: "spec.network.egress" entry ${JSON.stringify(h)} must be a bare hostname (no https://, no path), e.g. api.stripe.com.`);
    }
  }
  const g = s.guardrails || {};
  if (g.pii !== undefined && !PII_MODES.includes(g.pii)) e.push(`app.yaml: "spec.guardrails.pii" is ${JSON.stringify(g.pii)}; allowed: ${PII_MODES.join(', ')}.`);
  if (g.guardedActions !== undefined && !Array.isArray(g.guardedActions)) e.push('app.yaml: "spec.guardrails.guardedActions" must be a list.');
  if (s.isolation !== undefined && !ISOLATION.includes(s.isolation)) e.push(`app.yaml: "spec.isolation" is ${JSON.stringify(s.isolation)}; allowed: ${ISOLATION.join(', ')}.`);
  return e;
}
