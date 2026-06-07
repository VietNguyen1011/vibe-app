# Vibe-App Platform — README

## How to run

### Option C — Guardrails & Cost Middleware

A FastAPI proxy that sits between vibe-coded apps and the LLM backend. Enforces model allowlist → PII scan → budget check → audit log on every call.

```bash
cd optionC
pip install fastapi uvicorn httpx pydantic anthropic python-dotenv pyyaml pytest pytest-asyncio

# Run tests (no API key, no AWS needed — LLM calls are mocked)
pytest tests/ -v

# Run the proxy locally (mock LLM)
LLM_BACKEND=mock uvicorn server.main:app --port 8080 --reload

# Run the demo toy app (separate terminal)
GUARDRAILS_URL=http://localhost:8080 uvicorn toy_app.main:app --port 8081 --reload
```

Quick smoke-test:

```bash
# Good call — passes all guardrails
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"Write a tagline."}]}' | jq

# Blocked — model not on allowlist → 403
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"Hello"}]}' | jq

# Blocked — PII in prompt → 422
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"My SSN is 123-45-6789"}]}' | jq
```

See [optionC/README.md](optionC/README.md) for real-LLM and AWS-backend instructions.

---

### Option D — "Submit a vibe-coded app" Portal

A FastAPI backend + React/Vite frontend. Employee submits a GitHub repo URL → backend validates + generates IAM policy / deployment config / secrets bootstrap → admin approves → status flips `provisioning → live`.

```bash
# Backend (needs uv, or plain pip — see optionD/README.md)
cd optionD/backend
uv sync && uv run uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd optionD/frontend
npm install && npm run dev    # http://localhost:5173

# Or everything in Docker
cd optionD && docker compose up --build   # http://localhost:8080
```

Sign in as **Maya Chen** (employee) to submit; sign in as **Priya Nair** (admin) to approve.

Tests:

```bash
cd optionD/backend  && uv run pytest --cov=app   # 66 tests, 100% coverage
cd optionD/frontend && npm run coverage           # 33 tests, ~98% coverage
```

See [optionD/README.md](optionD/README.md) for the full walkthrough and screenshots.

---

### VibeApp Plugin — Claude Code plugin

Skill-driven plugin that lets any employee type "build me an expense tracker" and get a platform-compatible app scaffold + `app.yaml` manifest without touching infrastructure.

```bash
# Install
claude plugin marketplace add /path/to/vibeapp-plugin
claude plugin install vibeapp

# Validate a manifest manually
node vibeapp-plugin/scripts/validate-manifest.mjs app.yaml

# Plugin tests
node --test 'vibeapp-plugin/scripts/test/**/*.test.mjs'
```

See [vibeapp-plugin/README.md](vibeapp-plugin/README.md) for full install and usage.

---

## What I would do next given another full day

**Option C:**

- Sliding-window budget (rolling 24 h, not midnight-UTC reset) stored in DynamoDB with TTL.
- Output PII scanning — the proxy currently only scans requests; a model can hallucinate PII into responses.
- Token pre-estimation before the call so the budget check can reject obviously oversize prompts.
- Streaming support — pass `stream=True` chunks through and accumulate token counts from the final `message_delta` event.
- App registry in AWS AppConfig so platform team can update limits without a redeploy.
- AWS X-Ray integration to link the middleware span to the upstream app and downstream Bedrock call in one trace.

**Option D:**

- Real provisioner handshake — write artifacts to S3 / open a PR against the infra repo and emit an event the DevOps provisioner consumes (making the DESIGN.md ownership boundary executable).
- Full-source secret grep in the repo scanner (`os.environ`, `process.env`) and private-repo support per org.
- Swap in-memory store for DynamoDB/Postgres behind the same repository interface; make submit idempotent on `(repo, commit)`.
- Wire Option C's guardrails endpoint so the admin cost panel shows actual per-app/per-user token spend, not just a projection.
- Real OIDC token validation, signed sessions, CSRF, audit log of every approve/retire action.

**Plugin:**

- Publish to the Claude Code marketplace so install is a single URL.
- Add a `vibeapp-submit` skill that pushes to GitHub and calls the Option D API in one step — closing the loop from "vibe-coded" to "submitted."
- Expand stack templates beyond `static-html / react-ts / python-api`.

---

## AI tools used

### Claude Code

Used as the primary co-engineer for all three deliverables. Responsibilities: reading the assignment, scaffolding project structure, writing module interfaces, generating test suites, porting prototype logic to production-shaped services.

**Where it helped most:**

- Repetition within an established pattern — once the `ABC + local impl + AWS stub` structure was decided, Claude Code was fast at generating consistent variations across modules.
- Test fixture scaffolding — the `autouse` singleton-reset pattern in `conftest.py` and the TanStack Query mock harness in the frontend took minutes instead of hours.
- Diagnosing subtle bugs quickly: the SQLite `:memory:` isolation issue (each `connect()` creates a separate DB) and the PII offset drift when scanning concatenated message text.

**Where I directed or overrode:**

- **Proxy over SDK wrapper (Option C).** Claude Code's first draft wrapped the Anthropic SDK as a Python class. I redirected to a FastAPI HTTP proxy — a language-agnostic layer that vibe-coded apps in any stack can call without installing a Python dependency.

- **PII scanning per-message, not on concatenated text (Option C).** Initial implementation concatenated all messages, scanned the blob, then tried to map entity offsets back to individual messages. Offsets shifted because concatenation changed positions. I caught this and directed it to scan and redact each message independently.

- **Artifact generation on the backend, not in the browser (Option D).** The prototype (and the obvious port) computed artifacts in React. The artifacts *are* the product — a provisioner calls an API, not a browser. I moved generation, validation, and cost projection to FastAPI and made the frontend a pure renderer.

- **Least-privilege as a tested invariant (Option D).** Rather than trusting the generated IAM JSON visually, I added an adversarial test (app name `../* OR s3:::*`) so the security property is enforced by the test suite, not assumed.

- **Identity from the session, not the request body (Option D).** When SSO was added, the easy path was to keep trusting `ownerEmail` from the form. I overrode that so owner = authenticated user and gated admin actions by role.

- **`# PRODUCTION:` comments on AWS stubs (Option C).** The first version raised `NotImplementedError`. I asked for inline comments showing the exact boto3 call that would replace each stub, so the code teaches the production path rather than just marking it absent.

### Cursor

Used for a focused frontend session — the Claude Design visual system (typography, tokens, theming), high-contrast mode, and accessibility attributes. Cursor's inline diff view is faster than Claude Code for CSS iteration where the feedback loop is "look at it in the browser."

**Where I overrode it:** Cursor suggested extracting every color into a CSS variable. I kept derived values (e.g., `color-mix()` on a token) inline rather than naming every intermediate — naming things that don't have stable identity adds noise, not clarity.
