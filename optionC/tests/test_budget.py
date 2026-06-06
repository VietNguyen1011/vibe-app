import pytest
from datetime import date
from guardrails.budget import (
    BudgetConfig,
    BudgetExceededError,
    BudgetTracker,
    SqliteBudgetRepository,
    calculate_cost,
)


@pytest.fixture
def repo():
    return SqliteBudgetRepository(":memory:")


@pytest.fixture
def tracker(repo):
    return BudgetTracker(repo)


@pytest.fixture
def token_config():
    return BudgetConfig(daily_token_limit=1000, daily_cost_limit_usd=100.0)


@pytest.fixture
def cost_config():
    return BudgetConfig(daily_token_limit=10_000_000, daily_cost_limit_usd=0.001)


def test_under_budget_allowed(tracker, token_config):
    tracker.check("my-app", token_config)  # must not raise


def test_token_limit_exceeded(tracker, repo, token_config):
    repo.add_usage("my-app", date.today(), tokens_in=600, tokens_out=500, cost_usd=0.0)
    with pytest.raises(BudgetExceededError) as exc_info:
        tracker.check("my-app", token_config)
    assert exc_info.value.reason == "DAILY_TOKEN_LIMIT"
    assert exc_info.value.unit == "tokens"


def test_cost_limit_exceeded(tracker, repo, cost_config):
    repo.add_usage("my-app", date.today(), tokens_in=0, tokens_out=0, cost_usd=0.005)
    with pytest.raises(BudgetExceededError) as exc_info:
        tracker.check("my-app", cost_config)
    assert exc_info.value.reason == "DAILY_COST_LIMIT"
    assert exc_info.value.unit == "USD"


def test_budget_accumulates_across_calls(tracker):
    config = BudgetConfig(daily_token_limit=100, daily_cost_limit_usd=100.0)
    # Two calls × 40 tokens = 80 total — still under limit
    tracker.record("my-app", "claude-3-5-haiku-20241022", 20, 20)
    tracker.record("my-app", "claude-3-5-haiku-20241022", 20, 20)
    tracker.check("my-app", config)  # should pass

    # Third call pushes total to 120 > 100
    tracker.record("my-app", "claude-3-5-haiku-20241022", 20, 20)
    with pytest.raises(BudgetExceededError):
        tracker.check("my-app", config)


def test_record_returns_correct_cost(tracker):
    # Haiku: $0.80 / 1M input tokens
    cost = tracker.record("my-app", "claude-3-5-haiku-20241022", tokens_in=1_000_000, tokens_out=0)
    assert abs(cost - 0.80) < 0.001


def test_get_usage_reflects_records(tracker):
    tracker.record("my-app", "claude-3-5-haiku-20241022", 100, 50)
    usage = tracker.get_usage("my-app")
    assert usage.tokens_in == 100
    assert usage.tokens_out == 50
    assert usage.total_tokens == 150


def test_calculate_cost_known_model():
    cost = calculate_cost("claude-3-5-sonnet-20241022", tokens_in=1_000_000, tokens_out=1_000_000)
    assert abs(cost - 18.0) < 0.001  # $3.00 + $15.00


def test_different_apps_have_independent_budgets(tracker):
    config = BudgetConfig(daily_token_limit=100, daily_cost_limit_usd=100.0)
    tracker.record("app-a", "claude-3-5-haiku-20241022", 90, 90)
    tracker.check("app-b", config)  # app-b is unaffected — must not raise
