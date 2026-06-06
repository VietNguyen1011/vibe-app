import os
import time
import uuid
from dataclasses import asdict
from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException

from guardrails.allowlist import ModelAllowlist, ModelNotAllowedError
from guardrails.audit import AuditEntry, AuditLogger, JsonlAuditLogger, InMemoryAuditLogger
from guardrails.budget import BudgetTracker, BudgetExceededError, SqliteBudgetRepository
from guardrails.pii import PiiScanner, PiiBlockedError, RegexPiiScanner, create_scanner
from server.config import AppRegistry, AppNotFoundError
from server.models import ChatRequest, ChatResponse, BudgetStatus, TokenUsage


# ── Singletons (overridable in tests via direct attribute assignment) ───────
_registry: Optional[AppRegistry] = None
_allowlist: Optional[ModelAllowlist] = None
_budget_tracker: Optional[BudgetTracker] = None
_pii_scanner: Optional[PiiScanner] = None
_audit_logger: Optional[AuditLogger] = None


def get_registry() -> AppRegistry:
    global _registry
    if _registry is None:
        _registry = AppRegistry(os.getenv("APP_REGISTRY_PATH", "app_registry.yaml"))
    return _registry


def get_allowlist() -> ModelAllowlist:
    global _allowlist
    if _allowlist is None:
        _allowlist = ModelAllowlist()
    return _allowlist


def get_budget_tracker() -> BudgetTracker:
    global _budget_tracker
    if _budget_tracker is None:
        _budget_tracker = BudgetTracker(
            SqliteBudgetRepository(os.getenv("BUDGET_DB_PATH", "budget.db"))
        )
    return _budget_tracker


def get_pii_scanner() -> PiiScanner:
    global _pii_scanner
    if _pii_scanner is None:
        _pii_scanner = create_scanner()
    return _pii_scanner


def get_audit_logger() -> AuditLogger:
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = JsonlAuditLogger(os.getenv("AUDIT_LOG_PATH", "audit.jsonl"))
    return _audit_logger


app = FastAPI(title="VibeApp Guardrails Middleware", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "backend": os.getenv("LLM_BACKEND", "anthropic")}


async def _call_llm(request: ChatRequest) -> ChatResponse:
    """Forward to LLM backend. Swap via LLM_BACKEND env var: mock | anthropic | bedrock | ollama."""
    backend = os.getenv("LLM_BACKEND", "anthropic")

    if backend == "mock":
        return ChatResponse(
            id=f"mock-{uuid.uuid4().hex[:8]}",
            model=request.model,
            content=[{"type": "text", "text": "Mock LLM response."}],
            usage=TokenUsage(input_tokens=50, output_tokens=30),
        )

    if backend == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        kwargs: dict = {
            "model": request.model,
            "max_tokens": request.max_tokens,
            "messages": [m.model_dump() for m in request.messages],
        }
        if request.system:
            kwargs["system"] = request.system
        resp = client.messages.create(**kwargs)
        return ChatResponse(
            id=resp.id,
            model=resp.model,
            content=[{"type": b.type, "text": b.text} for b in resp.content],
            usage=TokenUsage(input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens),
            stop_reason=resp.stop_reason,
        )

    if backend == "ollama":
        import httpx as _httpx
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        messages = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.extend({"role": m.role, "content": m.content} for m in request.messages)
        async with _httpx.AsyncClient() as http:
            resp = await http.post(
                f"{base_url}/v1/chat/completions",
                json={"model": request.model, "messages": messages, "stream": False},
                timeout=120.0,
            )
            resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        usage = data.get("usage", {})
        return ChatResponse(
            id=data.get("id", f"ollama-{uuid.uuid4().hex[:8]}"),
            model=data.get("model", request.model),
            content=[{"type": "text", "text": choice["message"]["content"]}],
            usage=TokenUsage(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
            ),
            stop_reason=choice.get("finish_reason", "stop"),
        )

    if backend == "bedrock":
        # PRODUCTION: boto3.client('bedrock-runtime').converse(...)
        raise NotImplementedError("Bedrock backend not configured")

    raise ValueError(f"Unknown LLM_BACKEND: {backend}")


@app.post("/v1/{app_id}/messages", response_model=ChatResponse)
async def create_message(app_id: str, request: ChatRequest):
    t0 = time.monotonic()

    audit = AuditEntry(app_id=app_id, action="BLOCK", model_requested=request.model)

    try:
        app_config = get_registry().get(app_id)
    except AppNotFoundError:
        get_audit_logger().log(audit)
        raise HTTPException(status_code=404, detail={"error": "APP_NOT_FOUND", "app_id": app_id})

    try:
        # 1. Model allowlist
        get_allowlist().check(request.model, app_config.allowed_models)

        # 2. PII scan — each message independently so redact offsets stay valid
        pii_found = False
        pii_types: list[str] = []
        for i, msg in enumerate(request.messages):
            result = get_pii_scanner().scan(msg.content)
            if result.found:
                pii_found = True
                pii_types.extend(result.types)
                if app_config.pii_action == "redact":
                    request.messages[i].content = get_pii_scanner().redact(msg.content, result)
                    audit.pii_redacted = True

        if pii_found:
            audit.pii_detected = True
            audit.pii_types = list(set(pii_types))
            if app_config.pii_action == "block":
                raise PiiBlockedError(list(set(pii_types)))

        # 3. Budget pre-check
        get_budget_tracker().check(app_id, app_config.budget)

        # 4. LLM call
        response = await _call_llm(request)

        # 5. Record actual token usage
        cost = get_budget_tracker().record(
            app_id, request.model,
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        # 6. Audit success
        audit.action = "ALLOW"
        audit.model_used = response.model
        audit.tokens_in = response.usage.input_tokens
        audit.tokens_out = response.usage.output_tokens
        audit.cost_usd = cost
        audit.latency_ms = int((time.monotonic() - t0) * 1000)
        get_audit_logger().log(audit)

        return response

    except ModelNotAllowedError as e:
        audit.block_reason = "MODEL_NOT_ALLOWED"
        audit.latency_ms = int((time.monotonic() - t0) * 1000)
        get_audit_logger().log(audit)
        raise HTTPException(
            status_code=403,
            detail={"error": "MODEL_NOT_ALLOWED", "model": e.model, "allowed": e.allowed},
        )

    except PiiBlockedError as e:
        audit.block_reason = "PII_DETECTED"
        audit.latency_ms = int((time.monotonic() - t0) * 1000)
        get_audit_logger().log(audit)
        raise HTTPException(
            status_code=422,
            detail={"error": "PII_DETECTED", "pii_types": e.types},
        )

    except BudgetExceededError as e:
        audit.block_reason = "BUDGET_EXCEEDED"
        audit.latency_ms = int((time.monotonic() - t0) * 1000)
        get_audit_logger().log(audit)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "BUDGET_EXCEEDED",
                "reason": e.reason,
                "current": e.current,
                "limit": e.limit,
                "unit": e.unit,
            },
        )


@app.get("/admin/audit-log")
def get_audit_log(n: int = 50):
    return [asdict(e) for e in get_audit_logger().recent(n)]


@app.get("/admin/budget/{app_id}", response_model=BudgetStatus)
def get_budget_status(app_id: str):
    try:
        app_config = get_registry().get(app_id)
    except AppNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "APP_NOT_FOUND"})

    usage = get_budget_tracker().get_usage(app_id)
    token_limit = app_config.budget.daily_token_limit
    cost_limit = app_config.budget.daily_cost_limit_usd

    return BudgetStatus(
        app_id=app_id,
        date=date.today().isoformat(),
        tokens_in=usage.tokens_in,
        tokens_out=usage.tokens_out,
        total_tokens=usage.total_tokens,
        cost_usd=round(usage.cost_usd, 6),
        token_limit=token_limit,
        cost_limit_usd=cost_limit,
        token_pct=round(usage.total_tokens / token_limit * 100, 1),
        cost_pct=round(usage.cost_usd / cost_limit * 100, 1),
    )


@app.post("/admin/reset-budget/{app_id}")
def reset_budget(app_id: str):
    """Test/demo helper — clears today's usage for an app."""
    import sqlite3
    repo = get_budget_tracker().repo
    if hasattr(repo, "db_path"):
        with sqlite3.connect(repo.db_path) as conn:
            conn.execute(
                "DELETE FROM daily_usage WHERE app_id=? AND day=?",
                (app_id, date.today().isoformat()),
            )
    return {"ok": True, "app_id": app_id}
