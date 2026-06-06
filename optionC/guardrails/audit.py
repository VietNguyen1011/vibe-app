import json
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional


@dataclass
class AuditEntry:
    app_id: str
    action: Literal["ALLOW", "BLOCK"]
    model_requested: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    block_reason: Optional[str] = None       # MODEL_NOT_ALLOWED | BUDGET_EXCEEDED | PII_DETECTED
    model_used: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    cost_usd: Optional[float] = None
    pii_detected: bool = False
    pii_types: list[str] = field(default_factory=list)
    pii_redacted: bool = False
    latency_ms: Optional[int] = None


class AuditLogger(ABC):
    @abstractmethod
    def log(self, entry: AuditEntry) -> None: ...

    @abstractmethod
    def recent(self, n: int = 50) -> list[AuditEntry]: ...


class JsonlAuditLogger(AuditLogger):
    def __init__(self, path: str = "audit.jsonl"):
        self.path = Path(path)

    def log(self, entry: AuditEntry) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

    def recent(self, n: int = 50) -> list[AuditEntry]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").strip().splitlines()
        return [AuditEntry(**json.loads(line)) for line in lines[-n:]]


class InMemoryAuditLogger(AuditLogger):
    """No-op file I/O — used in tests."""

    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []

    def log(self, entry: AuditEntry) -> None:
        self._entries.append(entry)

    def recent(self, n: int = 50) -> list[AuditEntry]:
        return self._entries[-n:]


class CloudWatchAuditLogger(AuditLogger):
    """Production stub — logs structured JSON to CloudWatch Logs."""

    def __init__(self, log_group: str = "/vibeapps/audit") -> None:
        self.log_group = log_group

    def log(self, entry: AuditEntry) -> None:
        # PRODUCTION:
        # import time, boto3
        # client = boto3.client('logs')
        # client.put_log_events(
        #     logGroupName=self.log_group,
        #     logStreamName=entry.app_id,
        #     logEvents=[{"timestamp": int(time.time() * 1000),
        #                 "message": json.dumps(asdict(entry))}],
        # )
        raise NotImplementedError("CloudWatch backend not configured")

    def recent(self, n: int = 50) -> list[AuditEntry]:
        raise NotImplementedError("CloudWatch backend not configured")


def create_logger(path: str = "audit.jsonl") -> AuditLogger:
    backend = os.getenv("AUDIT_BACKEND", "jsonl")
    if backend == "cloudwatch":
        return CloudWatchAuditLogger()
    if backend == "memory":
        return InMemoryAuditLogger()
    return JsonlAuditLogger(path)
