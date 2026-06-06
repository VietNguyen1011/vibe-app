# VibeApp Plugin

Skill-driven Claude Code plugin: vibe-code a platform-compatible internal app, ready to push to GitHub and submit to the VibeApp Portal. No infrastructure decisions.

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

## Validate manually

```bash
node scripts/validate-manifest.mjs app.yaml
```

## What it generates

- A static UI + API skeleton in a beginner-friendly stack (`static-html` | `react-ts` | `python-api`)
- An `app.yaml` manifest (intent-based; see `skills/vibeapp-manifest/schema/app.schema.json`)
- Golden-path code: secrets from env, LLM via AI Gateway, egress allowlist, guarded actions

## Layout

```
.claude-plugin/plugin.json   plugin manifest
skills/vibeapp-build/        orchestrator (auto-triggers on "build an app")
skills/vibeapp-scaffolding/  stack menu + templates
skills/vibeapp-manifest/     app.yaml schema + examples
skills/vibeapp-guardrails/   secrets/gateway/egress golden path
skills/vibeapp-preflight/    pre-push validation
agents/                      scaffolder, manifest-author, validator sub-agents
scripts/                     zero-dependency validator + tests
hooks/hooks.json             optional pre-push validation
```

## Test

```bash
node --test 'scripts/test/**/*.test.mjs'
```
