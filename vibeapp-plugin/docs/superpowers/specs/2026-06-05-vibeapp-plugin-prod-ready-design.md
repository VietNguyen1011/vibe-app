# VibeApp Plugin — Production-Readiness Hardening

**Date:** 2026-06-05
**Owner:** minha@alice.io
**Status:** Approved (brainstorming)
**Builds on:** `2026-06-05-vibeapp-plugin-design.md`

## Purpose

Take the working VibeApp plugin to **production-ready, user-downloadable** quality.
A non-technical user must be able to: download/install the plugin, say "build me an
app" (even vaguely), be interviewed to fill any missing context, and receive a
**complete, buildable app** with a valid `app.yaml` — without ever understanding what
the plugin does internally.

Approach (approved): **parallel sub-agent audit → fix → re-verify**.

## Success Criteria (definition of prod-ready)

1. **Installable** — `claude plugin marketplace add <repo>` + `claude plugin install
   vibeapp` resolve against a real `marketplace.json`; LICENSE present; version set.
2. **Auto-engages** — the orchestrator skill triggers on vague non-technical phrasing
   ("make me a tool", "I want an app that…"), not only the literal word "build".
3. **Completeness guarantee** — the pipeline interviews for every checklist item before
   scaffolding, so a minimal-input user still gets a build-ready app + valid manifest.
4. **Proven to build** — a real smoke test scaffolds and builds each stack (react-ts
   `vite build`, python-api `py_compile`, static-html sanity). Network-dependent steps
   are documented as such.
5. **Robust validation** — validator + YAML parser handle adversarial input (tabs,
   CRLF, duplicate keys, deep nesting, empty/malformed, every enum) without crashing.
6. **CI green** — GitHub Actions runs `node --test` + structural lint on push.

## Workstreams

### WS1 — Distribution / marketplace
- Create `.claude-plugin/marketplace.json` cataloguing the `vibeapp` plugin (owner,
  name, source `./`, description).
- Add `LICENSE` (MIT).
- Update `README.md` with the real install flow and a one-line "non-tech" quickstart:
  install, then just ask Claude Code to build an app.

### WS2 — Non-technical download UX hardening
- Broaden the orchestrator skill `description` so it triggers on vague asks (make/create/
  want/need a tool/app/website/dashboard), keeping it scoped to internal-app building.
- Add an explicit rule to `vibeapp-build/SKILL.md`: **do not scaffold until every intent
  checklist item has an answer**; if the user is vague, ask follow-ups one at a time and
  offer sensible defaults. "Complete app" = manifest validates + scaffold builds.

### WS3 — Trust backbone (tests)
- Edge-case tests for `scripts/yaml.mjs`: tab-indent rejection or handling, CRLF line
  endings, duplicate keys (last wins, documented), deep nesting, empty doc, list of maps
  not supported (documented limit), comment-only lines.
- Edge-case tests for `manifest-rules.mjs`: every enum's reject path, missing
  `spec`/`metadata`, non-object root, extra unknown keys (allowed, ignored), budget as
  string, egress as scalar.
- `scripts/smoke/build-stacks.mjs` (or shell): scaffold each stack into a temp dir per
  the documented rename map and build it. react-ts → `npm install --no-audit --no-fund
  && npm run build`; python-api → `python3 -m py_compile main.py`; static-html → assert
  files + valid HTML root. Network/`npm` failure is reported as SKIPPED, not FAILED.

### WS4 — CI
- `.github/workflows/ci.yml`: on push/PR, Node 20, run `node --test
  'scripts/test/**/*.test.mjs'` and a lint step (plugin.json/marketplace.json parse,
  SKILL/agent frontmatter present).

### WS5 — Audit + verify (the approved A flow)
- Dispatch parallel auditor sub-agents over WS1-WS4 areas; collect findings.
- Fix all real findings.
- Final verification sub-agent: role-play a clueless non-technical user giving minimal
  info → must yield a build-ready app + valid `app.yaml`; plus a marketplace-resolution
  sanity check.

## Components / Files

```
.claude-plugin/marketplace.json   NEW — catalog for `claude plugin marketplace add`
LICENSE                           NEW — MIT
.github/workflows/ci.yml          NEW — test + lint on push
scripts/smoke/build-stacks.mjs    NEW — real per-stack build smoke test
scripts/test/yaml-edge.test.mjs   NEW — adversarial parser tests
scripts/test/rules-edge.test.mjs  NEW — adversarial validation tests
skills/vibeapp-build/SKILL.md      EDIT — broaden trigger + completeness rule
README.md                          EDIT — real install + non-tech quickstart
scripts/yaml.mjs                   EDIT (only if edge tests expose a real bug)
scripts/lib/manifest-rules.mjs     EDIT (only if edge tests expose a real bug)
```

## Error Handling

- YAML parser must never throw on malformed input in a way that crashes the validator
  CLI; the CLI already wraps parse in try/catch and exits 2 with a plain message. Edge
  tests assert this holds for the new adversarial inputs.
- Smoke test treats missing network / npm as SKIPPED with a clear note, never a false
  FAIL — keeps CI deterministic offline.

## Testing Strategy

1. `node --test 'scripts/test/**/*.test.mjs'` — all unit + edge tests pass.
2. `node scripts/smoke/build-stacks.mjs` — each stack builds or is explicitly SKIPPED.
3. Lint — `marketplace.json` + `plugin.json` parse; all frontmatter present.
4. CI dry-run locally (run the same commands the workflow runs).
5. Adversarial sub-agent E2E — minimal-input non-tech user → complete buildable app.

**Definition of done:** all six success criteria met and evidenced; final verification
sub-agent confirms a clueless-user run produces a build-ready app + valid manifest.
