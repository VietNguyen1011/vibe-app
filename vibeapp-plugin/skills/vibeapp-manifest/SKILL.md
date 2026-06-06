---
name: vibeapp-manifest
description: Use when creating or editing a VibeApp app.yaml manifest — translating a user's intent into manifest fields the platform validator accepts.
---
# VibeApp Manifest (app.yaml)

The user declares INTENT; the platform maps it to infrastructure. The user never picks Lambda/Fargate/IAM.

Schema and examples live next to this skill: `$CLAUDE_PLUGIN_ROOT/skills/vibeapp-manifest/schema/app.schema.json` and `.../examples/`. Validate with `node "$CLAUDE_PLUGIN_ROOT/scripts/validate-manifest.mjs" app.yaml`.

Intent -> field map:
- store data -> `spec.resources.database: true`
- upload/download files -> `spec.resources.storage: true`
- background/queue work, or a recurring/scheduled job (e.g. "weekly summary") -> `spec.resources.queue: true`
- calls website X -> add bare hostname to `spec.network.egress`
- uses AI -> `spec.ai.enabled: true`, `spec.ai.models` (allowlist only), `spec.ai.budget.monthlyUsd`
- send/delete/external mutation -> add to `spec.guardrails.guardedActions`

`spec.shape` (one of `web-api` | `agent` | `streaming` | `batch`) — picks the runtime:
- `web-api` — default; request/response HTTP API.
- `agent` — long-running multi-tool agent runs that exceed a normal request.
- `streaming` — SSE/websocket chat.
- `batch` — heavy scheduled/background processing jobs (paired with `queue: true`). For a light recurring task, `web-api` + `queue: true` is enough; use `batch` only for heavy compute.

- sensitive app -> `spec.isolation: dedicated-db|dedicated-account` (default `shared`)

Allowed models: anthropic.claude-opus-4-8, anthropic.claude-sonnet-4-6, anthropic.claude-haiku-4-5, amazon.nova-lite.
