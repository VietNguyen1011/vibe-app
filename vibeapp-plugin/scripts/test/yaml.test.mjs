import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../yaml.mjs';

test('parses nested maps, lists, scalars, bool, number', () => {
  const src = [
    'apiVersion: vibeapp/v1',
    'spec:',
    '  stack: react-ts',
    '  resources:',
    '    database: true',
    '    queue: false',
    '  ai:',
    '    budget:',
    '      monthlyUsd: 200',
    '    models:',
    '      - anthropic.claude-sonnet-4-6',
    '      - anthropic.claude-haiku-4-5',
  ].join('\n');
  const obj = parseYaml(src);
  assert.equal(obj.apiVersion, 'vibeapp/v1');
  assert.equal(obj.spec.stack, 'react-ts');
  assert.equal(obj.spec.resources.database, true);
  assert.equal(obj.spec.resources.queue, false);
  assert.equal(obj.spec.ai.budget.monthlyUsd, 200);
  assert.deepEqual(obj.spec.ai.models, ['anthropic.claude-sonnet-4-6', 'anthropic.claude-haiku-4-5']);
});

test('strips quotes and inline comments on scalars', () => {
  const obj = parseYaml('description: "hello world"\nname: foo  # a comment');
  assert.equal(obj.description, 'hello world');
  assert.equal(obj.name, 'foo');
});
