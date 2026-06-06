import os

# Must be set before any server imports so singletons initialise with test config
os.environ["APP_REGISTRY_PATH"] = "tests/fixtures/app_registry_test.yaml"
os.environ["LLM_BACKEND"] = "mock"
os.environ["PII_BACKEND"] = "regex"
os.environ["AUDIT_BACKEND"] = "memory"

import pytest
from fastapi.testclient import TestClient

from guardrails.audit import InMemoryAuditLogger
from guardrails.budget import BudgetTracker, SqliteBudgetRepository
from guardrails.pii import RegexPiiScanner
from server.config import AppRegistry
import server.main as server_module
from server.main import app


@pytest.fixture(autouse=True)
def reset_singletons():
    """Inject isolated in-memory singletons before every test."""
    server_module._registry = AppRegistry("tests/fixtures/app_registry_test.yaml")
    server_module._allowlist = None
    server_module._budget_tracker = BudgetTracker(SqliteBudgetRepository(":memory:"))
    server_module._pii_scanner = RegexPiiScanner()
    server_module._audit_logger = InMemoryAuditLogger()
    yield
    # Teardown: clear so next test starts fresh
    server_module._registry = None
    server_module._allowlist = None
    server_module._budget_tracker = None
    server_module._pii_scanner = None
    server_module._audit_logger = None


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def audit_logger() -> InMemoryAuditLogger:
    return server_module._audit_logger  # type: ignore[return-value]


@pytest.fixture
def budget_tracker() -> BudgetTracker:
    return server_module._budget_tracker  # type: ignore[return-value]
