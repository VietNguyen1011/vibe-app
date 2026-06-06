# VibeApp Plugin — Design

**Date:** 2026-06-05
**Owner:** minha@alice.io
**Status:** Approved (brainstorming)

## Purpose

A Claude Code plugin that lets a **non-technical user** vibe-code an internal app
that is **platform-compatible by construction** and ready to `git push` + submit to
the VibeApp Portal — with **zero infrastructure decisions** and a manifest
(`app.yaml`) that passes the platform's synchronous validator on the first try.

The plugin is **skill-driven, not command-driven**. The user never types
`/vibeapp-*`. They install the plugin, then say "build me an X app"; an orchestrator
skill auto-triggers, asks a few intent-confirmation questions, dispatches sub-agents
to scaffold + author the manifest, injects platform golden-path practices, validates
locally, and hands back a push-ready repo.

Scope is **Claude-Code-side only**: skills, sub-agent definitions, manifest schema,
a runnable local validator, an optional pre-push hook, and stack templates. The
Portal / control-plane (validate→scan→build→provision→deploy) is **out of scope** —
the plugin only guarantees the artifact it produces is platform-correct.

## Non-Goals (YAGNI)

- No backend, no Portal, no AWS provisioning.
- No slash commands for the primary flow (non-tech users don't type commands). An
  optional escape-hatch command may exist but is not load-bearing.
- No support for heavyweight stacks (Java, C++, Go). Beginner-friendly only.
- The plugin does not enforce platform security — it produces a *correct artifact*.
  Hard security guardrails live at the gateway/control-plane (per architecture §4).

## Architecture

Claude Code plugin layout:

```
vibeapp-plugin/
  .claude-plugin/plugin.json        # name, version, description
  skills/
    vibeapp-build/SKILL.md          # ORCHESTRATOR — auto-triggers on "build an app"
    vibeapp-scaffolding/SKILL.md    # stack menu + project skeleton  (+ templates/)
    vibeapp-manifest/SKILL.md       # author/edit app.yaml           (+ schema/, examples/)
    vibeapp-guardrails/SKILL.md     # secrets / gateway / egress golden-path
    vibeapp-preflight/SKILL.md      # validate app.yaml + build-compat before push
  agents/
    scaffolder.md                   # sub-agent: generate UI + API for chosen stack
    manifest-author.md              # sub-agent: draft app.yaml from intent answers
    validator.md                    # sub-agent: run validator, explain failures plainly
  hooks/hooks.json                  # optional pre-push validation (hard local guardrail)
  scripts/validate-manifest.mjs     # runnable validator (Node, zero deps)
```

### Components (each one purpose, clear boundary)

- **vibeapp-build (orchestrator skill).** Entry point. Auto-triggers when a user asks
  to build/create an app. Runs the pipeline: intent Q&A → dispatch sub-agents →
  guardrails → preflight → push guidance. Holds no domain logic itself; delegates.
- **vibeapp-scaffolding (skill) + templates/.** Offers a small beginner-friendly stack
  menu and the file skeleton for each. Templates: `static-html` (HTML/CSS/JS),
  `react-ts` (Vite + React + TS), `python-api` (FastAPI). Each template = static UI +
  API entrypoint + README, buildpack-detectable.
- **vibeapp-manifest (skill) + schema/ + examples/.** Knows the `app.yaml` schema and
  how to translate intent answers into manifest fields. Owns `app.schema.json`.
- **vibeapp-guardrails (skill).** Injects golden-path code patterns: read secrets from
  env (populated by the scoped role at runtime, never hardcoded), call LLMs via the AI
  Gateway endpoint (never Bedrock directly), make outbound HTTP only to declared egress
  hosts, route guarded actions through MCP mediation.
- **vibeapp-preflight (skill).** Runs the validator and the build-compat checklist;
  reports pass/fail in plain language; loops until green.
- **agents/*.** Sub-agent definitions the orchestrator dispatches. `scaffolder` +
  `manifest-author` run in **parallel** (independent); a **barrier** then runs
  `guardrails` wiring, then `validator`.
- **scripts/validate-manifest.mjs.** Zero-dependency Node validator: shape + semantic
  rules. Single source of truth, callable from the preflight skill, the validator
  sub-agent, and the hook.
- **hooks/hooks.json (optional, approach C).** Pre-push hook that runs the validator so
  a drifted agent still can't push an invalid manifest.

## Manifest: `app.yaml` (intent-based)

The user declares **intent**, never infrastructure. The platform maps intent → AWS
resources. The user never picks Lambda/Fargate, IAM, networking, or DB engine.

```yaml
apiVersion: vibeapp/v1
kind: App
metadata:
  name: expense-tracker            # dns-safe slug, 3-40 chars [a-z0-9-]
  owner: minha@alice.io            # SSO identity
  description: "Track team expenses"
spec:
  stack: react-ts                  # one of the template ids -> drives buildpack
  shape: web-api                   # web-api | agent | streaming | batch
                                   #   -> platform picks Lambda (default) or Fargate
  resources:                       # INTENT booleans, not infra
    database: true                 #   -> dedicated Aurora DB + scoped DB role
    storage: true                  #   -> S3 prefix s3://bucket/{app}/*
    queue: false                   #   -> per-app SQS queue
  ai:
    enabled: true
    models:                        # model allowlist (enforced HARD at gateway)
      - anthropic.claude-sonnet-4-6
      - anthropic.claude-haiku-4-5
    budget:
      monthlyUsd: 200              # per-app budget -> threshold alert + kill switch
  network:
    egress:                        # external API allowlist (removes exfil path, §4)
      - api.stripe.com
  guardrails:
    pii: redact                    # gateway PII scan/redact (none | redact | block)
    guardedActions:                # human-in-loop via MCP mediation
      - send-email
      - delete-record
  isolation: shared                # shared | dedicated-db | dedicated-account
                                   #   -> the isolation "dial" (§2, §7)
```

### Field semantics & validation rules

| Field | Type | Rule |
|-------|------|------|
| `apiVersion` | enum | must equal `vibeapp/v1` |
| `kind` | enum | must equal `App` |
| `metadata.name` | string | `^[a-z][a-z0-9-]{2,39}$`, dns-safe |
| `metadata.owner` | string | email-shaped |
| `metadata.description` | string | 1-200 chars |
| `spec.stack` | enum | one of known template ids |
| `spec.shape` | enum | `web-api` \| `agent` \| `streaming` \| `batch` |
| `spec.resources.{database,storage,queue}` | bool | optional, default false |
| `spec.ai.enabled` | bool | if false, `models`/`budget` ignored |
| `spec.ai.models[]` | enum[] | each ∈ known Bedrock model allowlist; non-empty if ai.enabled |
| `spec.ai.budget.monthlyUsd` | number | > 0 if ai.enabled |
| `spec.network.egress[]` | string[] | each a valid hostname (no scheme, no path) |
| `spec.guardrails.pii` | enum | `none` \| `redact` \| `block` |
| `spec.guardrails.guardedActions[]` | string[] | free-form action ids |
| `spec.isolation` | enum | `shared` \| `dedicated-db` \| `dedicated-account` |

Validator emits **plain-language** errors (matches the Portal's paste-ready-fix
ethos), e.g. `app.yaml: "spec.ai.models" lists "gpt-4" which isn't an allowed model.
Allowed: anthropic.claude-sonnet-4-6, anthropic.claude-haiku-4-5, ...`

## Data Flow (build pipeline)

1. User: "build me an expense tracker" → **vibeapp-build** auto-triggers.
2. **Intent Q&A** (few confirm questions): What does it do? Store data? Upload files?
   Call external services (which)? Need AI (which models)? Sensitive actions
   (send/delete)? Long-running/agentic? → answers drive the manifest.
3. Orchestrator **dispatches parallel sub-agents**:
   - `scaffolder` → UI + API skeleton for chosen stack
   - `manifest-author` → `app.yaml` from intent answers
4. **Barrier**, then `guardrails` wiring injected into generated code.
5. **preflight**: `validator` (sub-agent and/or hook) runs → plain-language pass/fail;
   loop until green.
6. Output: push-ready repo + guidance ("git push, then point the Portal at the repo").

## Error Handling

- Invalid manifest → validator returns structured, plain-language failures; preflight
  loops back to manifest-author to fix; never produces a known-bad artifact.
- Unknown stack/model/shape → enum validation rejects with the allowed list.
- Sub-agent failure → orchestrator surfaces which stage failed; the pipeline is
  re-entrant (re-run a single stage without redoing the rest).

## Testing Strategy

1. **Validator unit tests** — run `validate-manifest.mjs` against good + bad fixtures;
   assert correct pass/fail and message content.
2. **Static lint** — `plugin.json` parses; every `SKILL.md` has valid frontmatter
   (`name`, `description`); every `agents/*.md` has valid frontmatter.
3. **End-to-end via sub-agent** — spawn a sub-agent role-playing a non-tech user
   ("build an expense tracker"); verify the pipeline produces a scaffold + `app.yaml`.
4. **Round-trip** — run the validator on the generated `app.yaml`; must be green.

**Definition of done / ready-for-users:** all four test groups pass, and a fresh
"build an app" run yields a push-ready repo whose `app.yaml` validates clean.
