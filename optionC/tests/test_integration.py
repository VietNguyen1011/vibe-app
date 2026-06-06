"""
End-to-end integration tests using FastAPI TestClient.
LLM calls are mocked (LLM_BACKEND=mock set in conftest.py) — no real API keys needed.
Mock response: input_tokens=50, output_tokens=30 → total 80 tokens per call.
"""


# ── 1. Successful call goes through all guardrails ─────────────────────────
def test_successful_call_end_to_end(client, audit_logger, budget_tracker):
    resp = client.post("/v1/marketing-tool/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Write a tagline for our product."}],
    })
    assert resp.status_code == 200
    assert resp.json()["content"][0]["text"] == "Mock LLM response."

    usage = budget_tracker.get_usage("marketing-tool")
    assert usage.total_tokens == 80  # 50 in + 30 out

    entries = audit_logger.recent()
    assert len(entries) == 1
    assert entries[0].action == "ALLOW"
    assert entries[0].tokens_in == 50
    assert entries[0].tokens_out == 30


# ── 2. Misbehaving call — disallowed model is stopped ─────────────────────
def test_misbehaving_call_disallowed_model(client, audit_logger):
    """marketing-tool only allows haiku. Trying sonnet must be blocked."""
    resp = client.post("/v1/marketing-tool/messages", json={
        "model": "claude-3-5-sonnet-20241022",
        "messages": [{"role": "user", "content": "Do something expensive."}],
    })
    assert resp.status_code == 403
    detail = resp.json()["detail"]
    assert detail["error"] == "MODEL_NOT_ALLOWED"
    assert detail["model"] == "claude-3-5-sonnet-20241022"
    assert "claude-3-5-haiku-20241022" in detail["allowed"]

    entry = audit_logger.recent()[0]
    assert entry.action == "BLOCK"
    assert entry.block_reason == "MODEL_NOT_ALLOWED"


# ── 3. PII injection blocked (pii_action=block) ────────────────────────────
def test_pii_injection_blocked(client, audit_logger):
    resp = client.post("/v1/marketing-tool/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "My SSN is 123-45-6789, help me."}],
    })
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["error"] == "PII_DETECTED"
    assert "US_SSN" in detail["pii_types"]

    entry = audit_logger.recent()[0]
    assert entry.action == "BLOCK"
    assert entry.block_reason == "PII_DETECTED"
    assert entry.pii_detected is True


# ── 4. PII redacted and call continues (pii_action=redact) ────────────────
def test_pii_redacted_call_continues(client, audit_logger):
    """analyst-report uses pii_action=redact — email stripped, LLM call proceeds."""
    resp = client.post("/v1/analyst-report/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Email results to user@example.com"}],
    })
    assert resp.status_code == 200

    entry = audit_logger.recent()[0]
    assert entry.action == "ALLOW"
    assert entry.pii_detected is True
    assert entry.pii_redacted is True


# ── 5. Budget exhaustion blocks subsequent calls ───────────────────────────
def test_budget_exhaustion(client, audit_logger):
    """tight-budget-app has 70 token limit. Mock call = 80 tokens.
    First call: 0 < 70 → OK (records 80). Second call: 80 >= 70 → blocked."""
    resp1 = client.post("/v1/tight-budget-app/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Hello"}],
    })
    assert resp1.status_code == 200

    resp2 = client.post("/v1/tight-budget-app/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Hello again"}],
    })
    assert resp2.status_code == 429
    detail = resp2.json()["detail"]
    assert detail["error"] == "BUDGET_EXCEEDED"
    assert detail["reason"] == "DAILY_TOKEN_LIMIT"

    blocked = [e for e in audit_logger.recent() if e.action == "BLOCK"]
    assert blocked[0].block_reason == "BUDGET_EXCEEDED"


# ── 6. Unknown app returns 404 ─────────────────────────────────────────────
def test_unknown_app_returns_404(client):
    resp = client.post("/v1/nonexistent-app/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Hi"}],
    })
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "APP_NOT_FOUND"


# ── 7. Budget admin endpoint reflects usage ───────────────────────────────
def test_budget_admin_endpoint(client):
    client.post("/v1/marketing-tool/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Hi"}],
    })
    resp = client.get("/admin/budget/marketing-tool")
    assert resp.status_code == 200
    data = resp.json()
    assert data["app_id"] == "marketing-tool"
    assert data["total_tokens"] == 80
    assert data["token_limit"] == 100000
    assert data["token_pct"] == 0.1


# ── 8. Audit log admin endpoint returns entries ────────────────────────────
def test_audit_log_admin_endpoint(client):
    client.post("/v1/marketing-tool/messages", json={
        "model": "claude-3-5-haiku-20241022",
        "messages": [{"role": "user", "content": "Hi"}],
    })
    resp = client.get("/admin/audit-log")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["action"] == "ALLOW"
    assert "trace_id" in entries[0]
    assert "timestamp" in entries[0]
