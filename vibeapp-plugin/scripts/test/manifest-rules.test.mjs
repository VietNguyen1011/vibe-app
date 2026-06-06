import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, KNOWN_MODELS } from '../lib/manifest-rules.mjs';

const good = {
  apiVersion: 'vibeapp/v1', kind: 'App',
  metadata: { name: 'expense-tracker', owner: 'minha@alice.io', description: 'Track team expenses' },
  spec: {
    stack: 'react-ts', shape: 'web-api',
    resources: { database: true, storage: true, queue: false },
    ai: { enabled: true, models: ['anthropic.claude-sonnet-4-6'], budget: { monthlyUsd: 200 } },
    network: { egress: ['api.stripe.com'] },
    guardrails: { pii: 'redact', guardedActions: ['send-email'] },
    isolation: 'shared',
  },
};

test('valid manifest produces no errors', () => {
  assert.deepEqual(validateManifest(good), []);
});

test('rejects bad apiVersion', () => {
  const m = structuredClone(good); m.apiVersion = 'v2';
  assert.ok(validateManifest(m).some((e) => e.includes('apiVersion')));
});

test('rejects non-dns name', () => {
  const m = structuredClone(good); m.metadata.name = 'Bad_Name';
  assert.ok(validateManifest(m).some((e) => e.includes('metadata.name')));
});

test('rejects unknown model with allowed list in message', () => {
  const m = structuredClone(good); m.spec.ai.models = ['gpt-4'];
  const errs = validateManifest(m);
  assert.ok(errs.some((e) => e.includes('gpt-4') && KNOWN_MODELS.every((km) => e.includes(km))));
});

test('rejects ai.enabled with empty models', () => {
  const m = structuredClone(good); m.spec.ai.models = [];
  assert.ok(validateManifest(m).some((e) => e.includes('models')));
});

test('rejects budget <= 0', () => {
  const m = structuredClone(good); m.spec.ai.budget.monthlyUsd = 0;
  assert.ok(validateManifest(m).some((e) => e.includes('budget')));
});

test('rejects egress with scheme/path', () => {
  const m = structuredClone(good); m.spec.network.egress = ['https://api.stripe.com/v1'];
  assert.ok(validateManifest(m).some((e) => e.includes('egress')));
});

test('rejects unknown shape and isolation and pii', () => {
  const m = structuredClone(good);
  m.spec.shape = 'nope'; m.spec.isolation = 'nope'; m.spec.guardrails.pii = 'nope';
  const errs = validateManifest(m);
  assert.ok(errs.some((e) => e.includes('shape')));
  assert.ok(errs.some((e) => e.includes('isolation')));
  assert.ok(errs.some((e) => e.includes('pii')));
});

test('ai disabled ignores models/budget', () => {
  const m = structuredClone(good); m.spec.ai = { enabled: false };
  assert.deepEqual(validateManifest(m), []);
});
