import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'validate-manifest.mjs');
function run(fixture) {
  try {
    const out = execFileSync('node', [cli, path.join(here, 'fixtures', fixture)], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
}

test('good manifest exits 0', () => {
  const { code, out } = run('good-full.yaml');
  assert.equal(code, 0);
  assert.match(out, /valid/i);
});

test('bad model exits non-zero with plain-language error', () => {
  const { code, out } = run('bad-model.yaml');
  assert.notEqual(code, 0);
  assert.match(out, /gpt-4/);
  assert.match(out, /allowed/i);
});
