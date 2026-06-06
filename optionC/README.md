# Guardrails & Cost Middleware — Deliverable 2, Option C

A FastAPI proxy that sits between vibe-coded apps and the LLM backend (Anthropic/Bedrock), enforcing per-app guardrails before any token is spent.

---

## What it does

Every call routed through this proxy runs a four-step pipeline:

1. **Model allowlist** — reject models not declared in the app's config (403)
2. **PII scan** — block or redact SSNs, emails, phone numbers before the prompt leaves the company (422 or silent redact)
3. **Budget pre-check** — reject calls that would push the app past its daily token or cost limit (429)
4. **Audit log** — every call, allowed or blocked, is written as structured JSON with trace ID, latency, token counts, and block reason

---

## How to run

### Requirements

```bash
cd vibeapp-middleware
pip install fastapi uvicorn httpx pydantic anthropic python-dotenv pyyaml pytest pytest-asyncio
```

Presidio (optional, richer NLP-based PII detection):
```bash
pip install presidio-analyzer presidio-anonymizer spacy
python -m spacy download en_core_web_lg
```

### Run the tests (no API key, no AWS needed)

```bash
pytest tests/ -v
```

38 tests cover every guardrail in isolation and end-to-end via FastAPI `TestClient`. LLM calls are mocked — the full pipeline runs without touching any external service.

### Run the server locally

```bash
# Copy and edit env
cp .env.example .env

# Start guardrails proxy (mock LLM)
LLM_BACKEND=mock uvicorn server.main:app --port 8080 --reload

# Start demo toy app (separate terminal)
GUARDRAILS_URL=http://localhost:8080 uvicorn toy_app.main:app --port 8081 --reload
```

### Try the guardrails manually

```bash
# Good call
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"Write a tagline."}]}' | jq

# Blocked — wrong model (marketing-tool only allows haiku)
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"Hello"}]}' | jq
# → 403 {"error":"MODEL_NOT_ALLOWED", ...}

# Blocked — PII in prompt
curl -s -X POST http://localhost:8080/v1/marketing-tool/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"My SSN is 123-45-6789"}]}' | jq
# → 422 {"error":"PII_DETECTED","pii_types":["US_SSN"]}

# Check audit trail
curl -s http://localhost:8080/admin/audit-log | jq

# Check budget usage
curl -s http://localhost:8080/admin/budget/marketing-tool | jq
```

### Use a real LLM backend

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-... LLM_BACKEND=anthropic uvicorn server.main:app --port 8080

# AWS Bedrock (region must have model access granted)
LLM_BACKEND=bedrock AWS_DEFAULT_REGION=us-east-1 uvicorn server.main:app --port 8080
```

### Swap to AWS backends

| What | How |
|---|---|
| PII detection | `PII_BACKEND=comprehend` — uses `detect_pii_entities()` |
| Budget storage | `BUDGET_BACKEND=dynamodb` — swap `SqliteBudgetRepository` for `DynamoDBBudgetRepository` |
| Audit log | `AUDIT_BACKEND=cloudwatch` — writes to `/vibeapps/{app_id}/audit` log group |

Each backend pair shares an ABC interface; the only change is the env var. Stub implementations with `# PRODUCTION:` comments mark exactly what boto3 calls replace the local code.

---

## What I would do next (given another full day)

**Sliding-window budget instead of daily reset.** The current daily counter resets at midnight UTC, which is easy to game (big batch job at 23:59 → 00:01). A rolling 24-hour window stored in DynamoDB with TTL attributes would be the right fix.

**Output scanning.** Right now the proxy only scans the *request*. A model can hallucinate PII into its *response* (e.g., invent a real person's SSN). Scanning `response.content` before returning it to the caller closes that gap.

**Token estimation before the call.** The budget pre-check today only looks at *past* usage. For large prompts, we could estimate tokens (via `anthropic.count_tokens` or a tiktoken approximation) and reject calls that would obviously overshoot even if the current balance looks fine.

**Streaming support.** The proxy today buffers the full response to count tokens. Real apps want streaming. The right approach is to pass through `stream=True` chunks and accumulate token counts from the final `message_delta` event, then record and check budget post-stream.

**App registry in AWS AppConfig.** The YAML file works for demo but requires a redeploy to change limits. AppConfig gives the platform team a UI to update allowlists and budgets without touching the service, with a rollback if a bad config breaks something.

**Structured tracing with X-Ray.** The `trace_id` in the audit log is self-generated. Integrating AWS X-Ray would link this middleware's span to the upstream app's request and the downstream Bedrock call in one trace, which is what the on-call team actually needs during an incident.

---

## AI tools used

**Claude Code** drove most of the implementation. I used it to scaffold the project structure, write the module interfaces, and generate the test suite. That acceleration is real — the four-layer pipeline, ABC interfaces, and 38 tests took about 90 minutes of wall-clock time.

**Where it helped most:**
- Writing boilerplate that follows a pattern I'd already decided (the `ABC + local impl + AWS stub` structure) — Claude Code is fast at repetition once the pattern is established.
- Generating pytest fixtures. The `autouse` singleton-reset pattern in `conftest.py` is exactly the kind of testing scaffolding that takes 20 minutes to get right manually and 2 minutes to get right with Claude Code.
- Catching the SQLite `:memory:` pitfall. Each `sqlite3.connect(":memory:")` creates a *separate* database, so the table created in `_init_db` was invisible to later queries. Claude Code diagnosed this immediately and proposed the persistent-connection fix.

**Where I directed or overrode:**

- **Interface design was mine.** Claude Code's first draft made `GuardrailsClient` a class you'd instantiate per-call. I redirected to a FastAPI proxy because a language-agnostic HTTP layer is a stronger production story — vibe-coded apps in any language can call it.

- **The `pii_action: redact` path needed a correction.** The initial implementation scanned the *concatenated* full text and tried to apply entity offsets back to individual messages. The offsets were off because the concatenation shifted positions. I caught this and directed Claude Code to scan and redact each message independently.

- **Tone of the AWS stubs.** The first version just raised `NotImplementedError`. I asked for inline `# PRODUCTION:` comments showing the exact boto3 call that would replace each stub, so the code teaches the production path rather than just marking it missing.

- **Budget limit in the test fixture.** The initial `daily_token_limit: 100` for `tight-budget-app` passed the budget check twice (0 < 100, then 80 < 100) because the check is pre-call. I caught the off-by-one logic and set the limit to 70 so the scenario actually demonstrates exhaustion.

The overall pattern: Claude Code is fast at structure and repetition; I'm responsible for the design decisions, the edge cases, and making sure the abstractions are honest about the production path rather than convenient for the demo.
