# VibeApp Plugin Prod-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the working VibeApp plugin to production-ready, user-downloadable quality: installable via marketplace, auto-engaging for vague non-tech asks, proven to build, robust validation, and CI-green.

**Architecture:** Add distribution metadata (marketplace.json, LICENSE) so the plugin installs; broaden the orchestrator trigger and add a completeness rule; add adversarial parser/validator tests and a real per-stack build smoke test; add GitHub Actions CI; then run a parallel sub-agent audit and a clueless-user E2E verification.

**Tech Stack:** Claude Code plugin, Node.js (built-in `node:test`, zero deps), GitHub Actions, YAML manifest.

---

## File Structure

```
.claude-plugin/marketplace.json   NEW — catalog for marketplace add
LICENSE                           NEW — MIT
.github/workflows/ci.yml          NEW — test + lint
scripts/smoke/build-stacks.mjs    NEW — real per-stack build smoke
scripts/test/yaml-edge.test.mjs   NEW — adversarial parser tests
scripts/test/rules-edge.test.mjs  NEW — adversarial validation tests
skills/vibeapp-build/SKILL.md      EDIT — broaden trigger + completeness rule
README.md                          EDIT — real install + non-tech quickstart
scripts/yaml.mjs                   EDIT only if edge tests find a real bug
scripts/lib/manifest-rules.mjs     EDIT only if edge tests find a real bug
```

---

## Task 1: Distribution metadata (marketplace + LICENSE)

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `LICENSE`

- [ ] **Step 1: Write marketplace.json**

```json
{
  "name": "vibeapp-marketplace",
  "owner": { "name": "ALICE Platform / AI Infra", "email": "minha@alice.io" },
  "plugins": [
    {
      "name": "vibeapp",
      "source": "./",
      "description": "Vibe-code platform-compatible internal apps for the VibeApp Portal. Skill-driven: ask to build an app and the golden-path pipeline takes over.",
      "version": "0.1.0"
    }
  ]
}
```

- [ ] **Step 2: Write LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 ALICE Platform / AI Infra

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Verify both parse / exist**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'));console.log('mp ok')" && test -f LICENSE && echo "license ok"`
Expected: `mp ok` then `license ok`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json LICENSE && git commit -m "feat: add marketplace catalog and MIT license"
```

---

## Task 2: Broaden orchestrator trigger + completeness rule

**Files:**
- Modify: `skills/vibeapp-build/SKILL.md`

- [ ] **Step 1: Broaden the description frontmatter**

Replace the `description:` line with:

```
description: Use when a non-technical user wants to build, create, make, set up, or get an internal web app, tool, website, dashboard, or internal service to run on the VibeApp platform — including vague asks like "make me a tool that…" or "I want an app for…". Runs the golden-path pipeline (intent interview, scaffolding, app.yaml authoring, guardrails, pre-push validation) so the result deploys to the VibeApp Portal without errors.
```

- [ ] **Step 2: Add the completeness rule under the Pipeline heading**

Insert immediately after the `# Build a VibeApp` intro line:

```md
## Completeness rule (non-negotiable)
The user may be non-technical and vague. Do NOT scaffold or write app.yaml until EVERY
intent item below has an answer. If the user doesn't volunteer one, ask a short
follow-up (one at a time) and offer a sensible default they can accept ("I'll assume no
file uploads — ok?"). A "complete app" means: app.yaml validates clean AND the scaffold
builds. Never hand back a half-configured app.
```

- [ ] **Step 3: Verify frontmatter still valid + rule present**

Run: `grep -q '^description:' skills/vibeapp-build/SKILL.md && grep -q 'Completeness rule' skills/vibeapp-build/SKILL.md && echo ok`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add skills/vibeapp-build/SKILL.md && git commit -m "feat: broaden build trigger and require complete intent before scaffold"
```

---

## Task 3: Adversarial YAML parser tests (TDD — characterize + fix if needed)

**Files:**
- Create: `scripts/test/yaml-edge.test.mjs`
- Modify (only if a test fails): `scripts/yaml.mjs`

- [ ] **Step 1: Write the edge tests**

```js
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
```

- [ ] **Step 2: Run the tests**

Run: `node --test scripts/test/yaml-edge.test.mjs`
Expected: identify any FAIL. Likely failures to fix in `scripts/yaml.mjs`:
- CRLF: trailing `\r` not stripped.
- value with colon: `line.indexOf(':')` splits at first colon — `https://...` rest = `//example.com/path` which is fine since we take everything after the FIRST colon; verify the key is `url` not `url`+scheme. (Key = before first colon = `url`; rest = `https://example.com/path` — OK. Confirm.)

- [ ] **Step 3: Fix scripts/yaml.mjs if any test failed**

If CRLF fails, change the line-cleaning map in `parseYaml` from:
```js
    .map((l) => stripComment(l).replace(/\s+$/, ''))
```
to (strip `\r` first):
```js
    .map((l) => stripComment(l.replace(/\r$/, '')).replace(/\s+$/, ''))
```
(Only apply the minimal change needed for the failing test. Re-run after each change.)

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test scripts/test/yaml-edge.test.mjs`
Expected: PASS all

- [ ] **Step 5: Commit**

```bash
git add scripts/test/yaml-edge.test.mjs scripts/yaml.mjs && git commit -m "test: adversarial yaml parser cases (+fixes)"
```

---

## Task 4: Adversarial validation-rules tests

**Files:**
- Create: `scripts/test/rules-edge.test.mjs`
- Modify (only if a test fails): `scripts/lib/manifest-rules.mjs`

- [ ] **Step 1: Write the edge tests**

```js
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
```

- [ ] **Step 2: Run the tests**

Run: `node --test scripts/test/rules-edge.test.mjs`
Expected: identify any FAIL. The current rules handle all these (string budget fails `typeof !== 'number'`; scalar egress fails `!Array.isArray`; extra keys are not inspected). If all pass, no code change needed.

- [ ] **Step 3: Fix manifest-rules.mjs only if a test failed**

Apply the minimal change to satisfy the failing assertion, re-running after each edit. (Expected: none needed.)

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test scripts/test/rules-edge.test.mjs`
Expected: PASS all

- [ ] **Step 5: Commit**

```bash
git add scripts/test/rules-edge.test.mjs scripts/lib/manifest-rules.mjs && git commit -m "test: adversarial validation rule cases"
```

---

## Task 5: Real per-stack build smoke test

**Files:**
- Create: `scripts/smoke/build-stacks.mjs`

- [ ] **Step 1: Write the smoke runner**

```js
#!/usr/bin/env node
// scripts/smoke/build-stacks.mjs — scaffold each stack into a temp dir and build it.
// Network/npm/python unavailable => SKIPPED (not FAILED), so CI stays deterministic.
import { mkdtempSync, cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (s) => path.join(root, 'skills/vibeapp-scaffolding/templates', s);
let failed = false;
const log = (s) => console.log(s);

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe' });
}
function has(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

// --- static-html: structural sanity ---
{
  const d = mkdtempSync(path.join(tmpdir(), 'vibe-static-'));
  cpSync(T('static-html'), d, { recursive: true });
  const html = readFileSync(path.join(d, 'index.html'), 'utf8');
  if (existsSync(path.join(d, 'api.js')) && /<html/i.test(html) && /fetch\(/.test(html)) log('static-html: PASS');
  else { log('static-html: FAIL'); failed = true; }
  rmSync(d, { recursive: true, force: true });
}

// --- python-api: py_compile ---
{
  if (!has('python3')) { log('python-api: SKIPPED (no python3)'); }
  else {
    const d = mkdtempSync(path.join(tmpdir(), 'vibe-py-'));
    cpSync(T('python-api'), d, { recursive: true });
    try { sh('python3', ['-m', 'py_compile', 'main.py'], d); log('python-api: PASS'); }
    catch (e) { log('python-api: FAIL\n' + (e.stderr || e.message)); failed = true; }
    rmSync(d, { recursive: true, force: true });
  }
}

// --- react-ts: scaffold (apply rename map) + npm build ---
{
  if (!has('npm')) { log('react-ts: SKIPPED (no npm)'); }
  else {
    const d = mkdtempSync(path.join(tmpdir(), 'vibe-rt-'));
    const src = path.join(d, 'src');
    mkdirSync(src, { recursive: true });
    for (const f of ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'README.md']) {
      cpSync(path.join(T('react-ts'), f), path.join(d, f));
    }
    cpSync(path.join(T('react-ts'), 'src-App.tsx'), path.join(src, 'App.tsx'));
    cpSync(path.join(T('react-ts'), 'src-main.tsx'), path.join(src, 'main.tsx'));
    cpSync(path.join(T('react-ts'), 'api-handler.ts'), path.join(src, 'api.ts'));
    try {
      sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], d);
      sh('npm', ['run', 'build'], d);
      log('react-ts: PASS');
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || '').toString();
      if (/ENOTFOUND|ETIMEDOUT|network|getaddrinfo|EAI_AGAIN|registry/i.test(msg)) log('react-ts: SKIPPED (no network for npm install)');
      else { log('react-ts: FAIL\n' + msg.slice(0, 1200)); failed = true; }
    }
    rmSync(d, { recursive: true, force: true });
  }
}

if (failed) { console.error('\nSMOKE: FAILURES present'); process.exit(1); }
console.log('\nSMOKE: ok (passes + skips, no failures)');
```

- [ ] **Step 2: Run the smoke test**

Run: `node scripts/smoke/build-stacks.mjs`
Expected: `static-html: PASS`; `python-api: PASS` or SKIPPED; `react-ts: PASS` or `SKIPPED (no network…)`; final line `SMOKE: ok`. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke/build-stacks.mjs && git commit -m "test: real per-stack build smoke (skips when toolchain absent)"
```

---

## Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Unit + edge tests
        run: node --test 'scripts/test/**/*.test.mjs'
      - name: Build smoke test
        run: node scripts/smoke/build-stacks.mjs
      - name: Lint plugin metadata + frontmatter
        run: |
          node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))"
          node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"
          node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))"
          for f in skills/*/SKILL.md agents/*.md; do grep -q '^name:' "$f" || { echo "FRONTMATTER MISSING: $f"; exit 1; }; done
          echo lint-ok
```

- [ ] **Step 2: Validate YAML parses (local check)**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/jobs:/.test(s)||!/node --test/.test(s)) throw new Error('bad'); console.log('ci yaml ok')"`
Expected: `ci yaml ok`

- [ ] **Step 3: Run the exact CI commands locally**

Run:
```bash
node --test 'scripts/test/**/*.test.mjs' && node scripts/smoke/build-stacks.mjs && echo "ci-local ok"
```
Expected: tests pass, smoke ok, `ci-local ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: run tests + smoke + lint on push"
```

---

## Task 7: README — real install + non-tech quickstart

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Install section**

Replace the `## Install (local)` section body with:

````md
## Install

From the directory that contains this plugin (the one with `.claude-plugin/`):

```bash
claude plugin marketplace add /path/to/vibeapp-plugin
claude plugin install vibeapp
```

(Or add the published marketplace URL once hosted.)

## Quickstart (no setup, non-technical)

After installing, you don't run any commands. Just tell Claude Code what you want:

> build me a team expense tracker

Claude Code loads the VibeApp skills automatically, asks you a few plain-language
questions to fill in the details, scaffolds the app, writes `app.yaml`, validates it,
and tells you when to `git push`. You never touch infrastructure.
````

- [ ] **Step 2: Verify the new content is present**

Run: `grep -q 'claude plugin marketplace add' README.md && grep -q 'Quickstart' README.md && echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: real install flow and non-technical quickstart"
```

---

## Task 8: Parallel sub-agent audit + clueless-user E2E verification

**Files:** none (verification + any fixes the audit surfaces)

- [ ] **Step 1: Dispatch parallel auditor sub-agents** (one message, independent)

Dispatch four read-only auditors over the repo; each returns findings only:
1. **Distribution auditor** — does `marketplace.json` + `plugin.json` + structure match what `claude plugin install` expects? Any missing/contradictory field, version mismatch, wrong `source`?
2. **Skill-trigger auditor** — would `vibeapp-build` reliably auto-trigger for vague non-tech asks and refuse to scaffold before the checklist is complete? Any gap in the description/rule?
3. **Robustness auditor** — read `yaml.mjs` + `manifest-rules.mjs`; find inputs that crash or mis-validate that the tests don't cover.
4. **Docs/consistency auditor** — cross-check README, SKILL.md path refs, agent paths, model allowlist consistency across files.

- [ ] **Step 2: Triage + fix real findings**

For each finding: if real, fix the file and re-run `node --test 'scripts/test/**/*.test.mjs'` + `node scripts/smoke/build-stacks.mjs`. If false/by-design, note why. Add a regression test for any real bug before fixing.

- [ ] **Step 3: Clueless-user E2E verification sub-agent**

Dispatch a sub-agent that role-plays a non-technical user who installed the plugin and says only: "i want an app for my team". It must follow the skills, conduct the interview (filling defaults), scaffold into a temp dir, and author `app.yaml`. Then it runs `node <plugin>/scripts/validate-manifest.mjs <tmp>/app.yaml` and reports: did it produce a complete, build-ready app + valid manifest from minimal input? List any place it got stuck.

- [ ] **Step 4: Marketplace-resolution sanity check**

Run:
```bash
node -e "const m=JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); const p=m.plugins.find(x=>x.name==='vibeapp'); if(!p||p.source!=='./') throw new Error('vibeapp plugin entry missing/incorrect'); const pj=JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); if(pj.name!==p.name) throw new Error('name mismatch'); console.log('marketplace resolves vibeapp ->', p.version)"
```
Expected: `marketplace resolves vibeapp -> 0.1.0`

- [ ] **Step 5: Final full verification battery**

Run:
```bash
node --test 'scripts/test/**/*.test.mjs'
node scripts/smoke/build-stacks.mjs
node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/full.app.yaml
node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/invalid.app.yaml; echo "invalid exit=$?"
```
Expected: all tests pass; smoke ok; full valid; invalid exit=1.

- [ ] **Step 6: Prod-ready verdict**

Confirm all six success criteria from the spec are met and evidenced. Report PROD-READY or list remaining blockers.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A && git commit -m "fix: address prod-readiness audit findings" || echo "nothing to commit"
```
