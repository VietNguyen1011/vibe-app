import json
import pytest
from guardrails.audit import AuditEntry, JsonlAuditLogger, InMemoryAuditLogger


@pytest.fixture
def mem_logger():
    return InMemoryAuditLogger()


@pytest.fixture
def allow_entry():
    return AuditEntry(
        app_id="marketing-tool",
        action="ALLOW",
        model_requested="claude-3-5-haiku-20241022",
        model_used="claude-3-5-haiku-20241022",
        tokens_in=100,
        tokens_out=50,
        cost_usd=0.0002,
        latency_ms=800,
    )


@pytest.fixture
def block_entry():
    return AuditEntry(
        app_id="marketing-tool",
        action="BLOCK",
        model_requested="claude-3-5-sonnet-20241022",
        block_reason="MODEL_NOT_ALLOWED",
        latency_ms=2,
    )


def test_in_memory_logger_stores_entry(mem_logger, allow_entry):
    mem_logger.log(allow_entry)
    entries = mem_logger.recent()
    assert len(entries) == 1
    assert entries[0].action == "ALLOW"


def test_blocked_entry_has_reason(mem_logger, block_entry):
    mem_logger.log(block_entry)
    assert mem_logger.recent()[0].block_reason == "MODEL_NOT_ALLOWED"


def test_required_fields_present(allow_entry):
    assert allow_entry.timestamp
    assert allow_entry.trace_id
    assert allow_entry.app_id
    assert allow_entry.action in ("ALLOW", "BLOCK")
    assert allow_entry.model_requested


def test_trace_ids_are_unique():
    a = AuditEntry(app_id="x", action="ALLOW", model_requested="m")
    b = AuditEntry(app_id="x", action="ALLOW", model_requested="m")
    assert a.trace_id != b.trace_id


def test_jsonl_logger_writes_valid_json(tmp_path, allow_entry, block_entry):
    logger = JsonlAuditLogger(str(tmp_path / "audit.jsonl"))
    logger.log(allow_entry)
    logger.log(block_entry)

    lines = (tmp_path / "audit.jsonl").read_text().strip().splitlines()
    assert len(lines) == 2
    for line in lines:
        data = json.loads(line)
        assert "timestamp" in data
        assert "trace_id" in data
        assert "action" in data
        assert "app_id" in data


def test_jsonl_logger_recent_returns_all_entries(tmp_path, allow_entry, block_entry):
    logger = JsonlAuditLogger(str(tmp_path / "audit.jsonl"))
    logger.log(allow_entry)
    logger.log(block_entry)
    assert len(logger.recent(10)) == 2


def test_recent_limit_is_respected(mem_logger, allow_entry):
    for _ in range(10):
        mem_logger.log(allow_entry)
    assert len(mem_logger.recent(3)) == 3


def test_empty_logger_returns_empty_list(tmp_path):
    logger = JsonlAuditLogger(str(tmp_path / "missing.jsonl"))
    assert logger.recent() == []
