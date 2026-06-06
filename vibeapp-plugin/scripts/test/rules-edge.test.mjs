import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../lib/manifest-rules.mjs';

test('non-object root returns a single friendly error', () => {
  assert.deepEqual(validateManifest(null), ['app.yaml: file is empty or not a mapping.']);
  assert.deepEqual(validateManifest('a string'), ['app.yaml: file is empty or not a mapping.']);
});

test('missing spec and metadata produces multiple errors, no crash', () => {
  const errs = validateManifest({ apiVersion: 'vibeapp/v1', kind: 'App' });
  assert.ok(errs.length >= 3);
  assert.ok(errs.some((e) => e.includes('metadata.name')));
  assert.ok(errs.some((e) => e.includes('spec.stack')));
});

test('budget as string is rejected', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', ai: { enabled: true, models: ['amazon.nova-lite'], budget: { monthlyUsd: '50' } }, isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('budget')));
});

test('egress as scalar (not list) is rejected', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', network: { egress: 'api.stripe.com' }, isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('egress')));
});

test('unknown extra keys are ignored (no error)', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', isolation: 'shared', somethingExtra: true } };
  assert.deepEqual(validateManifest(m), []);
});

test('resources as array is rejected, not silently passed', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', resources: ['database'], isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('resources')));
});

test('metadata as array is rejected with a mapping error', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App', metadata: ['x'],
    spec: { stack: 'react-ts', shape: 'web-api', isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('metadata') && e.includes('mapping')));
});

test('ai as array is rejected with a mapping error', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', ai: ['enabled'], isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('spec.ai') && e.includes('mapping')));
});

test('description as a number is rejected', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 12345 },
    spec: { stack: 'react-ts', shape: 'web-api', isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('description')));
});

test('ai.enabled non-boolean is rejected', () => {
  const m = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', ai: { enabled: 'no' }, isolation: 'shared' } };
  assert.ok(validateManifest(m).some((e) => e.includes('ai.enabled')));
});

test('each enum reject path fires', () => {
  const base = { apiVersion: 'vibeapp/v1', kind: 'App',
    metadata: { name: 'good-app', owner: 'a@b.co', description: 'x' },
    spec: { stack: 'react-ts', shape: 'web-api', isolation: 'shared' } };
  const stack = structuredClone(base); stack.spec.stack = 'rust';
  const shape = structuredClone(base); shape.spec.shape = 'cron';
  const iso = structuredClone(base); iso.spec.isolation = 'vpc';
  const pii = structuredClone(base); pii.spec.guardrails = { pii: 'mask' };
  assert.ok(validateManifest(stack).some((e) => e.includes('spec.stack')));
  assert.ok(validateManifest(shape).some((e) => e.includes('spec.shape')));
  assert.ok(validateManifest(iso).some((e) => e.includes('spec.isolation')));
  assert.ok(validateManifest(pii).some((e) => e.includes('pii')));
});
