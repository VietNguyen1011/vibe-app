import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../yaml.mjs';

test('handles CRLF line endings', () => {
  const obj = parseYaml('a: 1\r\nb: two\r\n');
  assert.equal(obj.a, 1);
  assert.equal(obj.b, 'two');
});

test('comment-only and blank lines are ignored', () => {
  const obj = parseYaml('# header\n\n  # indented comment\nname: x\n');
  assert.equal(obj.name, 'x');
});

test('duplicate key: last value wins', () => {
  const obj = parseYaml('k: 1\nk: 2\n');
  assert.equal(obj.k, 2);
});

test('empty document yields empty object', () => {
  assert.deepEqual(parseYaml(''), {});
});

test('deep nesting parses', () => {
  const obj = parseYaml('a:\n  b:\n    c:\n      d: deep\n');
  assert.equal(obj.a.b.c.d, 'deep');
});

test('value with colon (url) is preserved', () => {
  const obj = parseYaml('url: https://example.com/path\n');
  assert.equal(obj.url, 'https://example.com/path');
});

test('quoted value keeps leading/trailing spaces', () => {
  const obj = parseYaml('s: "  spaced  "\n');
  assert.equal(obj.s, '  spaced  ');
});

test('block-style sequence (dash at key indent) attaches to its key, not the grandparent', () => {
  const src = [
    'spec:',
    '  ai:',
    '    enabled: true',
    '    models:',
    '    - m1',
    '    - m2',
    '    budget:',
    '      monthlyUsd: 50',
  ].join('\n');
  const obj = parseYaml(src);
  assert.equal(obj.spec.ai.enabled, true, 'enabled must survive');
  assert.deepEqual(obj.spec.ai.models, ['m1', 'm2'], 'models must be the list');
  assert.equal(obj.spec.ai.budget.monthlyUsd, 50, 'budget must survive');
});
