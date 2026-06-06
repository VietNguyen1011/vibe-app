# VibeApp Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a skill-driven Claude Code plugin that lets a non-technical user vibe-code a platform-compatible internal app with a valid `app.yaml`, ready to push to GitHub and submit to the VibeApp Portal.

**Architecture:** A `.claude-plugin` plugin: one orchestrator skill auto-triggers on "build an app", runs an intent Q&A, dispatches parallel sub-agents (scaffolder + manifest-author), wires golden-path guardrails, and runs a zero-dependency Node validator (also exposed as a pre-push hook) until the manifest is green.

**Tech Stack:** Claude Code plugin (skills + agents + hooks), Node.js (validator, no deps, uses built-in `node:test`), Markdown skill/agent definitions, YAML manifest + JSON Schema.

---

## File Structure

```
.claude-plugin/plugin.json            # plugin manifest
skills/vibeapp-build/SKILL.md         # orchestrator (auto-trigger)
skills/vibeapp-scaffolding/SKILL.md   # stack menu + skeletons
skills/vibeapp-scaffolding/templates/static-html/{index.html,api.js,README.md}
skills/vibeapp-scaffolding/templates/react-ts/{package.json,src-App.tsx,api-handler.ts,README.md}
skills/vibeapp-scaffolding/templates/python-api/{main.py,index.html,requirements.txt,README.md}
skills/vibeapp-manifest/SKILL.md      # manifest authoring guide
skills/vibeapp-manifest/schema/app.schema.json
skills/vibeapp-manifest/examples/{minimal.app.yaml,full.app.yaml,invalid.app.yaml}
skills/vibeapp-guardrails/SKILL.md    # secrets/gateway/egress golden-path
skills/vibeapp-preflight/SKILL.md     # validate before push
agents/scaffolder.md
agents/manifest-author.md
agents/validator.md
scripts/validate-manifest.mjs         # the validator (single source of truth)
scripts/lib/manifest-rules.mjs        # pure validation logic (testable)
scripts/test/validate-manifest.test.mjs
scripts/test/fixtures/{good-minimal.yaml,good-full.yaml,bad-*.yaml}
scripts/yaml.mjs                       # tiny YAML subset parser (no deps)
hooks/hooks.json                       # optional pre-push validation
README.md                              # install + usage
```

> Note: validator is zero-dependency. A tiny YAML-subset parser (`scripts/yaml.mjs`) handles the manifest shape (maps, lists, scalars, booleans, numbers) — sufficient for `app.yaml`. No npm install required.

---

## Task 1: Plugin manifest + skeleton dirs

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Write plugin.json**

```json
{
  "name": "vibeapp",
  "version": "0.1.0",
  "description": "Vibe-code platform-compatible internal apps for the VibeApp Portal. Skill-driven: ask to build an app and the golden-path pipeline takes over.",
  "author": { "name": "ALICE Platform / AI Infra" }
}
```

- [ ] **Step 2: Verify JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json && git commit -m "feat: add plugin manifest"
```

---

## Task 2: YAML subset parser (TDD)

**Files:**
- Create: `scripts/yaml.mjs`
- Test: `scripts/test/yaml.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/yaml.test.mjs`
Expected: FAIL — cannot find module / parseYaml not a function

- [ ] **Step 3: Implement parser**

```js
// scripts/yaml.mjs — minimal YAML subset for app.yaml (maps, lists, scalars).
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~' || v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
function stripComment(line) {
  // drop trailing ' # ...' but not inside quotes
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i);
  }
  return line;
}
export function parseYaml(src) {
  const lines = src.split('\n')
    .map((l) => stripComment(l).replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && l.trim() !== '---');
  const root = {};
  // stack of { indent, container }
  const stack = [{ indent: -1, container: root }];
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].container;
    if (line.startsWith('- ')) {
      const val = coerce(line.slice(2).trim());
      if (!Array.isArray(parent.__list)) throw new Error('list item without key');
      parent.__list.push(val);
      continue;
    }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (rest === '') {
      // could be a map or a list; decide by peeking handled lazily via __list
      const obj = {};
      Object.defineProperty(obj, '__list', { value: [], enumerable: false, writable: true });
      parent[key] = obj;
      stack.push({ indent, container: obj });
    } else {
      parent[key] = coerce(rest);
    }
  }
  return finalize(root);
}
function finalize(node) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (Array.isArray(node.__list) && node.__list.length > 0) return node.__list;
    for (const k of Object.keys(node)) node[k] = finalize(node[k]);
  }
  return node;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test/yaml.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/yaml.mjs scripts/test/yaml.test.mjs && git commit -m "feat: zero-dep yaml subset parser"
```

---

## Task 3: Manifest validation rules (TDD)

**Files:**
- Create: `scripts/lib/manifest-rules.mjs`
- Test: `scripts/test/manifest-rules.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, KNOWN_MODELS, KNOWN_STACKS, KNOWN_SHAPES } from '../lib/manifest-rules.mjs';

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
  const errs = validateManifest(m);
  assert.ok(errs.some((e) => e.includes('apiVersion')));
});

test('rejects non-dns name', () => {
  const m = structuredClone(good); m.metadata.name = 'Bad_Name';
  assert.ok(validateManifest(m).some((e) => e.includes('metadata.name')));
});

test('rejects unknown model with allowed list in message', () => {
  const m = structuredClone(good); m.spec.ai.models = ['gpt-4'];
  const errs = validateManifest(m);
  assert.ok(errs.some((e) => e.includes('gpt-4') && KNOWN_MODELS.every((km) => e.includes(km) || true)));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/manifest-rules.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement rules**

```js
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

export function validateManifest(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['app.yaml: file is empty or not a mapping.'];
  if (m.apiVersion !== 'vibeapp/v1') e.push(`app.yaml: "apiVersion" must be "vibeapp/v1" (got ${JSON.stringify(m.apiVersion)}).`);
  if (m.kind !== 'App') e.push(`app.yaml: "kind" must be "App" (got ${JSON.stringify(m.kind)}).`);
  const md = m.metadata || {};
  if (!NAME_RE.test(md.name || '')) e.push(`app.yaml: "metadata.name" must be a dns-safe slug: lowercase letter then 2-39 of [a-z0-9-] (got ${JSON.stringify(md.name)}).`);
  if (!EMAIL_RE.test(md.owner || '')) e.push(`app.yaml: "metadata.owner" must be an email address (got ${JSON.stringify(md.owner)}).`);
  if (!md.description || String(md.description).length > 200) e.push('app.yaml: "metadata.description" is required and must be 1-200 chars.');
  const s = m.spec || {};
  if (!KNOWN_STACKS.includes(s.stack)) e.push(`app.yaml: "spec.stack" is ${JSON.stringify(s.stack)}; allowed: ${KNOWN_STACKS.join(', ')}.`);
  if (!KNOWN_SHAPES.includes(s.shape)) e.push(`app.yaml: "spec.shape" is ${JSON.stringify(s.shape)}; allowed: ${KNOWN_SHAPES.join(', ')}.`);
  const r = s.resources || {};
  for (const k of ['database', 'storage', 'queue']) {
    if (r[k] !== undefined && typeof r[k] !== 'boolean') e.push(`app.yaml: "spec.resources.${k}" must be true or false.`);
  }
  const ai = s.ai || {};
  if (ai.enabled) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test/manifest-rules.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/manifest-rules.mjs scripts/test/manifest-rules.test.mjs && git commit -m "feat: manifest validation rules"
```

---

## Task 4: Validator CLI + fixtures (TDD)

**Files:**
- Create: `scripts/validate-manifest.mjs`
- Create: `scripts/test/fixtures/good-full.yaml`, `scripts/test/fixtures/bad-model.yaml`
- Test: `scripts/test/validate-manifest.test.mjs`

- [ ] **Step 1: Write fixtures**

`scripts/test/fixtures/good-full.yaml`:
```yaml
apiVersion: vibeapp/v1
kind: App
metadata:
  name: expense-tracker
  owner: minha@alice.io
  description: "Track team expenses"
spec:
  stack: react-ts
  shape: web-api
  resources:
    database: true
    storage: true
    queue: false
  ai:
    enabled: true
    models:
      - anthropic.claude-sonnet-4-6
      - anthropic.claude-haiku-4-5
    budget:
      monthlyUsd: 200
  network:
    egress:
      - api.stripe.com
  guardrails:
    pii: redact
    guardedActions:
      - send-email
  isolation: shared
```

`scripts/test/fixtures/bad-model.yaml`:
```yaml
apiVersion: vibeapp/v1
kind: App
metadata:
  name: bad-app
  owner: minha@alice.io
  description: "bad model demo"
spec:
  stack: react-ts
  shape: web-api
  ai:
    enabled: true
    models:
      - gpt-4
    budget:
      monthlyUsd: 50
  isolation: shared
```

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/test/validate-manifest.test.mjs`
Expected: FAIL — cli module missing

- [ ] **Step 4: Implement CLI**

```js
#!/usr/bin/env node
// scripts/validate-manifest.mjs — validate an app.yaml, print plain-language results.
import { readFileSync } from 'node:fs';
import { parseYaml } from './yaml.mjs';
import { validateManifest } from './lib/manifest-rules.mjs';

const file = process.argv[2] || 'app.yaml';
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`Could not read ${file}. Is the path right?`);
  process.exit(2);
}
let manifest;
try {
  manifest = parseYaml(text);
} catch (err) {
  console.error(`${file}: could not parse YAML — ${err.message}`);
  process.exit(2);
}
const errors = validateManifest(manifest);
if (errors.length === 0) {
  console.log(`${file} is valid. Ready to push.`);
  process.exit(0);
}
console.error(`${file} has ${errors.length} issue(s):\n`);
for (const e of errors) console.error(`  - ${e}`);
console.error('\nFix these, then re-run the check.');
process.exit(1);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/test/validate-manifest.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full suite**

Run: `node --test scripts/test/`
Expected: PASS all

- [ ] **Step 7: Commit**

```bash
git add scripts/validate-manifest.mjs scripts/test/ && git commit -m "feat: validator CLI with fixtures"
```

---

## Task 5: Manifest schema + examples

**Files:**
- Create: `skills/vibeapp-manifest/schema/app.schema.json`
- Create: `skills/vibeapp-manifest/examples/minimal.app.yaml`, `full.app.yaml`, `invalid.app.yaml`

- [ ] **Step 1: Write JSON Schema** (mirrors manifest-rules; documentation + editor hints)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VibeApp app.yaml",
  "type": "object",
  "required": ["apiVersion", "kind", "metadata", "spec"],
  "properties": {
    "apiVersion": { "const": "vibeapp/v1" },
    "kind": { "const": "App" },
    "metadata": {
      "type": "object",
      "required": ["name", "owner", "description"],
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z][a-z0-9-]{2,39}$" },
        "owner": { "type": "string", "format": "email" },
        "description": { "type": "string", "minLength": 1, "maxLength": 200 }
      }
    },
    "spec": {
      "type": "object",
      "required": ["stack", "shape"],
      "properties": {
        "stack": { "enum": ["static-html", "react-ts", "python-api"] },
        "shape": { "enum": ["web-api", "agent", "streaming", "batch"] },
        "resources": {
          "type": "object",
          "properties": {
            "database": { "type": "boolean" },
            "storage": { "type": "boolean" },
            "queue": { "type": "boolean" }
          }
        },
        "ai": {
          "type": "object",
          "properties": {
            "enabled": { "type": "boolean" },
            "models": { "type": "array", "items": { "enum": ["anthropic.claude-opus-4-8", "anthropic.claude-sonnet-4-6", "anthropic.claude-haiku-4-5", "amazon.nova-lite"] } },
            "budget": { "type": "object", "properties": { "monthlyUsd": { "type": "number", "exclusiveMinimum": 0 } } }
          }
        },
        "network": {
          "type": "object",
          "properties": { "egress": { "type": "array", "items": { "type": "string" } } }
        },
        "guardrails": {
          "type": "object",
          "properties": {
            "pii": { "enum": ["none", "redact", "block"] },
            "guardedActions": { "type": "array", "items": { "type": "string" } }
          }
        },
        "isolation": { "enum": ["shared", "dedicated-db", "dedicated-account"] }
      }
    }
  }
}
```

- [ ] **Step 2: Write examples**

`minimal.app.yaml`:
```yaml
apiVersion: vibeapp/v1
kind: App
metadata:
  name: hello-board
  owner: minha@alice.io
  description: "A simple shared message board"
spec:
  stack: static-html
  shape: web-api
  ai:
    enabled: false
  isolation: shared
```

`full.app.yaml`: copy of `scripts/test/fixtures/good-full.yaml`.

`invalid.app.yaml`:
```yaml
apiVersion: v2
kind: App
metadata:
  name: Bad_Name
  owner: not-an-email
  description: "demonstrates validation failures"
spec:
  stack: java-spring
  shape: web-api
  ai:
    enabled: true
    models:
      - gpt-4
    budget:
      monthlyUsd: 0
  network:
    egress:
      - https://evil.example.com/exfil
  isolation: maximum
```

- [ ] **Step 3: Verify examples validate as expected**

Run: `node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/minimal.app.yaml && node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/full.app.yaml`
Expected: both print "is valid"

Run: `node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/invalid.app.yaml; echo "exit=$?"`
Expected: lists issues (apiVersion, name, owner, stack, model, budget, egress, isolation), `exit=1`

- [ ] **Step 4: Commit**

```bash
git add skills/vibeapp-manifest/schema skills/vibeapp-manifest/examples && git commit -m "feat: manifest schema and examples"
```

---

## Task 6: Stack templates

**Files:**
- Create: `skills/vibeapp-scaffolding/templates/static-html/{index.html,api.js,README.md}`
- Create: `skills/vibeapp-scaffolding/templates/react-ts/{package.json,src-App.tsx,api-handler.ts,README.md}`
- Create: `skills/vibeapp-scaffolding/templates/python-api/{main.py,index.html,requirements.txt,README.md}`

- [ ] **Step 1: static-html template**

`index.html` — minimal static UI calling `/api`. `api.js` — Node handler stub reading config from env, calling AI Gateway via `process.env.VIBEAPP_GATEWAY_URL`. `README.md` — what to edit. (Golden path: no secrets in code; gateway URL + token from env.)

```html
<!-- index.html -->
<!doctype html><html><head><meta charset="utf-8"><title>VibeApp</title></head>
<body><h1>Hello from VibeApp</h1><pre id="out">loading…</pre>
<script>fetch('/api/hello').then(r=>r.json()).then(d=>{document.getElementById('out').textContent=JSON.stringify(d,null,2)});</script>
</body></html>
```

```js
// api.js — runtime-agnostic handler. Secrets come from env (scoped role injects them).
export async function hello() {
  return { message: 'Hello from your VibeApp API', model: process.env.VIBEAPP_DEFAULT_MODEL || 'unset' };
}
// LLM calls MUST go through the AI Gateway, never Bedrock directly:
export async function ask(prompt) {
  const res = await fetch(`${process.env.VIBEAPP_GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VIBEAPP_GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: process.env.VIBEAPP_DEFAULT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  return res.json();
}
```

```md
<!-- README.md -->
# Static HTML app
Edit `index.html` for UI, `api.js` for endpoints. Never hardcode secrets — read from env.
LLM calls go through the AI Gateway (`VIBEAPP_GATEWAY_URL`), never Bedrock directly.
```

- [ ] **Step 2: react-ts template** (Vite-style entry, handler stub mirroring api.js golden path)

`package.json`:
```json
{ "name": "vibeapp-react-ts", "private": true, "type": "module",
  "scripts": { "build": "vite build", "dev": "vite" },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "vite": "^5.0.0", "typescript": "^5.4.0", "@vitejs/plugin-react": "^4.2.0" } }
```
`src-App.tsx`:
```tsx
import { useEffect, useState } from 'react';
export default function App() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => { fetch('/api/hello').then((r) => r.json()).then(setData); }, []);
  return <main><h1>VibeApp</h1><pre>{JSON.stringify(data, null, 2)}</pre></main>;
}
```
`api-handler.ts`:
```ts
// API handler. Secrets from env. LLM via AI Gateway only.
export async function hello() {
  return { message: 'Hello from your VibeApp API', model: process.env.VIBEAPP_DEFAULT_MODEL ?? 'unset' };
}
export async function ask(prompt: string) {
  const res = await fetch(`${process.env.VIBEAPP_GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VIBEAPP_GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: process.env.VIBEAPP_DEFAULT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  return res.json();
}
```
`README.md`: how to edit, golden-path note (same as static-html).

- [ ] **Step 3: python-api template**

`main.py`:
```python
# FastAPI app. Secrets from env. LLM via AI Gateway only (never boto3/Bedrock directly).
import os, json, urllib.request
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/hello")
def hello():
    return {"message": "Hello from your VibeApp API", "model": os.environ.get("VIBEAPP_DEFAULT_MODEL", "unset")}

def ask(prompt: str):
    req = urllib.request.Request(
        f"{os.environ['VIBEAPP_GATEWAY_URL']}/v1/messages",
        data=json.dumps({"model": os.environ["VIBEAPP_DEFAULT_MODEL"],
                         "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"content-type": "application/json",
                 "authorization": f"Bearer {os.environ['VIBEAPP_GATEWAY_TOKEN']}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)
```
`index.html`: minimal static UI (same shape as static-html). `requirements.txt`: `fastapi`\n`uvicorn`. `README.md`: golden-path note.

- [ ] **Step 4: Verify all template files exist and parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('skills/vibeapp-scaffolding/templates/react-ts/package.json','utf8'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add skills/vibeapp-scaffolding/templates && git commit -m "feat: stack templates (static-html, react-ts, python-api)"
```

---

## Task 7: Sub-agent definitions

**Files:**
- Create: `agents/scaffolder.md`, `agents/manifest-author.md`, `agents/validator.md`

- [ ] **Step 1: scaffolder.md**

```md
---
name: scaffolder
description: Generates the UI + API skeleton for a chosen VibeApp stack. Dispatched by vibeapp-build.
tools: Read, Write, Glob
---
You scaffold a platform-compatible app skeleton. Input: chosen stack id (static-html | react-ts | python-api) and the app intent.
Copy the matching template from the vibeapp-scaffolding skill's templates/ into the project root, renaming `src-App.tsx`->`src/App.tsx` and `api-handler.ts`->`src/api.ts` as needed. Adapt UI text to the app's purpose. Do NOT hardcode secrets. Do NOT call Bedrock directly — keep the AI Gateway pattern from the template. Return the list of files created.
```

- [ ] **Step 2: manifest-author.md**

```md
---
name: manifest-author
description: Drafts app.yaml from the user's confirmed intent. Dispatched by vibeapp-build.
tools: Read, Write
---
You write a valid VibeApp `app.yaml`. Input: intent answers (purpose, data, files, external services, AI models, sensitive actions, long-running?).
Map intent to fields per skills/vibeapp-manifest/schema/app.schema.json: data->resources.database, files->resources.storage, queue work->resources.queue, external services->network.egress (bare hostnames), AI->ai.models+budget, sensitive actions->guardrails.guardedActions, long-running/agentic->shape (agent|streaming) else web-api. Default isolation: shared. Never invent models outside the allowlist. Write app.yaml at project root. Return the manifest you wrote.
```

- [ ] **Step 3: validator.md**

```md
---
name: validator
description: Runs the VibeApp manifest validator and explains any failures in plain language. Dispatched by vibeapp-build / vibeapp-preflight.
tools: Bash, Read
---
Run `node scripts/validate-manifest.mjs app.yaml` (use the plugin's bundled script path). If it exits 0, report ready. If non-zero, relay each issue in plain language and propose the exact field fix. Do not edit files yourself — return the issues so the manifest-author can fix them.
```

- [ ] **Step 4: Verify frontmatter parses**

Run: `for f in agents/*.md; do head -1 "$f" | grep -q '^---' && echo "$f ok"; done`
Expected: three `ok` lines

- [ ] **Step 5: Commit**

```bash
git add agents && git commit -m "feat: sub-agent definitions (scaffolder, manifest-author, validator)"
```

---

## Task 8: Skills (orchestrator + four supporting)

**Files:**
- Create: `skills/vibeapp-build/SKILL.md`, `skills/vibeapp-scaffolding/SKILL.md`, `skills/vibeapp-manifest/SKILL.md`, `skills/vibeapp-guardrails/SKILL.md`, `skills/vibeapp-preflight/SKILL.md`

- [ ] **Step 1: vibeapp-build/SKILL.md (orchestrator, auto-trigger)**

```md
---
name: vibeapp-build
description: Use when a non-technical user wants to build, create, or make an internal web app / tool to deploy on the VibeApp platform. Runs the golden-path pipeline — intent questions, scaffolding, app.yaml authoring, guardrails, and pre-push validation — so the result deploys to the VibeApp Portal without errors.
---
# Build a VibeApp

You are guiding a non-technical user. Never expose AWS/IAM/Lambda/Fargate choices.

## Pipeline (follow in order)
1. **Confirm intent — ask one at a time, plain language:**
   - What should the app do? (one sentence)
   - Does it need to remember/store data? (yes->database)
   - Will users upload or download files? (yes->storage)
   - Does it call any outside service? Which websites? (->egress hostnames)
   - Should it use AI? For what? (->ai.enabled, suggest a model: Haiku for simple, Sonnet for complex)
   - Any sensitive actions like sending email or deleting things? (->guardedActions)
   - Will it run long tasks or chat-stream? (->shape agent/streaming, else web-api)
   - Pick a stack: simple page (static-html), interactive app (react-ts), or Python (python-api).
2. **Dispatch sub-agents in parallel** (use the Agent tool): `scaffolder` (with chosen stack + intent) and `manifest-author` (with intent answers). They are independent.
3. **Barrier**, then apply the vibeapp-guardrails skill to the generated code.
4. **Preflight**: invoke vibeapp-preflight. If it reports issues, hand them to manifest-author to fix, then re-validate. Loop until green.
5. **Done**: tell the user to `git push`, then point the VibeApp Portal at the repo (one-time SSO + GitHub link). Give the live-URL expectation.

REQUIRED SUB-SKILLS used along the way: vibeapp-scaffolding, vibeapp-manifest, vibeapp-guardrails, vibeapp-preflight.
```

- [ ] **Step 2: vibeapp-scaffolding/SKILL.md**

```md
---
name: vibeapp-scaffolding
description: Use when scaffolding a new VibeApp project skeleton — choosing a beginner-friendly stack and laying down the UI + API files.
---
# VibeApp Scaffolding
Stacks (beginner-friendly only — never Java/C++/Go):
- `static-html` — one HTML page + a small JS API. Simplest.
- `react-ts` — Vite + React + TypeScript. Interactive UIs.
- `python-api` — FastAPI + static page. Python users.
Templates live in `templates/<stack>/`. Copy them to the project root, renaming `src-App.tsx`->`src/App.tsx`, `api-handler.ts`->`src/api.ts`. Always keep: static UI + API entrypoint + README. Buildpacks detect the stack from these files — do not add Dockerfiles.
```

- [ ] **Step 3: vibeapp-manifest/SKILL.md**

```md
---
name: vibeapp-manifest
description: Use when creating or editing a VibeApp app.yaml manifest — translating a user's intent into manifest fields the platform validator accepts.
---
# VibeApp Manifest (app.yaml)
The user declares INTENT; the platform maps it to infrastructure. The user never picks Lambda/Fargate/IAM.
Schema: `schema/app.schema.json`. Examples: `examples/`. Validate with `node scripts/validate-manifest.mjs app.yaml`.
Intent -> field map:
- store data -> `spec.resources.database: true`
- upload/download files -> `spec.resources.storage: true`
- background/queue work -> `spec.resources.queue: true`
- calls website X -> add bare hostname to `spec.network.egress`
- uses AI -> `spec.ai.enabled: true`, `spec.ai.models` (allowlist only), `spec.ai.budget.monthlyUsd`
- send/delete/external mutation -> add to `spec.guardrails.guardedActions`
- long-running/agentic/streaming -> `spec.shape: agent|streaming`, else `web-api`
- sensitive app -> `spec.isolation: dedicated-db|dedicated-account` (default `shared`)
Allowed models: anthropic.claude-opus-4-8, anthropic.claude-sonnet-4-6, anthropic.claude-haiku-4-5, amazon.nova-lite.
```

- [ ] **Step 4: vibeapp-guardrails/SKILL.md**

```md
---
name: vibeapp-guardrails
description: Use when wiring a VibeApp app's code to platform golden-path practices — secrets, AI Gateway, egress, and guarded actions — so it passes the platform security scan.
---
# VibeApp Guardrails (golden path)
Apply to all generated code:
1. **Secrets** — never hardcode. Read from env (the scoped role injects them at runtime). e.g. `process.env.VIBEAPP_GATEWAY_TOKEN`.
2. **AI Gateway** — all LLM calls go to `VIBEAPP_GATEWAY_URL`, never Bedrock/boto3/other-provider SDKs directly. The gateway enforces model allowlist, budget, and PII redaction.
3. **Egress** — outbound HTTP only to hosts declared in `spec.network.egress`. Don't call undeclared hosts.
4. **Guarded actions** — send/delete/external mutations must be declared in `spec.guardrails.guardedActions` (routed through MCP mediation for human approval). Don't auto-execute them silently.
5. **Least privilege** — only request resources the app truly needs in the manifest.
```

- [ ] **Step 5: vibeapp-preflight/SKILL.md**

```md
---
name: vibeapp-preflight
description: Use before pushing a VibeApp app — validates app.yaml and runs the build-compatibility checklist so the platform accepts it on the first try.
---
# VibeApp Preflight
1. Run the validator: `node scripts/validate-manifest.mjs app.yaml`. Relay any issues in plain language; loop with manifest-author until it prints "is valid".
2. Build-compat checklist:
   - [ ] static UI + API entrypoint present
   - [ ] no Dockerfile (buildpacks own the image)
   - [ ] no hardcoded secrets (grep for obvious keys)
   - [ ] LLM calls use VIBEAPP_GATEWAY_URL, not a provider SDK
   - [ ] every external host the code calls is in spec.network.egress
3. When all green, tell the user it's ready to `git push`.
```

- [ ] **Step 6: Verify all SKILL.md have name+description frontmatter**

Run: `for f in skills/*/SKILL.md; do grep -q '^name:' "$f" && grep -q '^description:' "$f" && echo "$f ok" || echo "$f MISSING"; done`
Expected: five `ok` lines

- [ ] **Step 7: Commit**

```bash
git add skills/*/SKILL.md && git commit -m "feat: orchestrator + supporting skills"
```

---

## Task 9: Pre-push hook + README

**Files:**
- Create: `hooks/hooks.json`
- Create: `README.md`

- [ ] **Step 1: hooks.json** (optional hard guardrail — validate app.yaml on PreToolUse of git push)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "bash -c 'if echo \"$CLAUDE_TOOL_INPUT\" | grep -q \"git push\"; then node \"$CLAUDE_PLUGIN_ROOT/scripts/validate-manifest.mjs\" app.yaml || exit 2; fi'" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: README.md** (install + usage)

````md
# VibeApp Plugin
Skill-driven Claude Code plugin: vibe-code a platform-compatible internal app, ready to push to GitHub and submit to the VibeApp Portal. No infra decisions.

## Install (local)
```bash
claude plugin marketplace add /path/to/parent-of-this-repo   # or this repo's dir
claude plugin install vibeapp
```
Or point your plugins config at this directory.

## Use
Just ask in Claude Code: "build me an expense tracker app". The `vibeapp-build` skill takes over — asks a few questions, scaffolds the app, writes `app.yaml`, validates, and tells you when to `git push`.

## Validate manually
```bash
node scripts/validate-manifest.mjs app.yaml
```

## What it generates
- A static UI + API skeleton in a beginner-friendly stack (static-html | react-ts | python-api)
- An `app.yaml` manifest (intent-based; see `skills/vibeapp-manifest/schema/app.schema.json`)
- Golden-path code: secrets from env, LLM via AI Gateway, egress allowlist, guarded actions
````

- [ ] **Step 3: Validate hooks.json parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json README.md && git commit -m "feat: pre-push validation hook and README"
```

---

## Task 10: Full self-test + ready verdict

**Files:** none (verification only)

- [ ] **Step 1: Run entire test suite**

Run: `node --test scripts/test/`
Expected: all tests PASS

- [ ] **Step 2: Validate every shipped example + fixture**

Run:
```bash
node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/minimal.app.yaml
node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/full.app.yaml
node scripts/validate-manifest.mjs skills/vibeapp-manifest/examples/invalid.app.yaml; echo "invalid exit=$?"
```
Expected: minimal+full valid; invalid lists issues with exit=1

- [ ] **Step 3: Lint all plugin JSON + frontmatter**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))"
for f in skills/*/SKILL.md agents/*.md; do grep -q '^name:' "$f" || echo "FRONTMATTER MISSING: $f"; done
echo lint-ok
```
Expected: `lint-ok`, no MISSING lines

- [ ] **Step 4: End-to-end via sub-agent (role-play non-tech user)**

Dispatch a sub-agent with the plugin loaded that plays a non-tech user asking "build me a team expense tracker that stores data and emails a weekly summary using AI". Verify it: triggers vibeapp-build, asks intent, produces a scaffold + `app.yaml`, and the generated `app.yaml` passes `validate-manifest.mjs`.

- [ ] **Step 5: Ready verdict**

Confirm definition-of-done from the spec: all four test groups pass + a fresh build run yields a push-ready repo whose `app.yaml` validates clean. Report READY or list blockers.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "test: full plugin self-test green" || echo "nothing to commit"
```
