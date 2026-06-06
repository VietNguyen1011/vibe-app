import sqlite3
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass
class DailyUsage:
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.tokens_in + self.tokens_out


@dataclass
class BudgetConfig:
    daily_token_limit: int
    daily_cost_limit_usd: float


class BudgetExceededError(Exception):
    def __init__(self, reason: str, current: float, limit: float, unit: str):
        self.reason = reason
        self.current = current
        self.limit = limit
        self.unit = unit
        super().__init__(f"Budget exceeded: {reason} — {current}/{limit} {unit}")


class BudgetRepository(ABC):
    @abstractmethod
    def get_usage(self, app_id: str, day: date) -> DailyUsage: ...

    @abstractmethod
    def add_usage(self, app_id: str, day: date, tokens_in: int, tokens_out: int, cost_usd: float) -> None: ...


class SqliteBudgetRepository(BudgetRepository):
    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        # Keep one connection alive for :memory: — each new connect() is a separate empty DB
        self._conn: sqlite3.Connection | None = (
            sqlite3.connect(db_path, check_same_thread=False) if db_path == ":memory:" else None
        )
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        return sqlite3.connect(self.db_path, check_same_thread=False)

    def _init_db(self) -> None:
        conn = self._connect()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_usage (
                app_id TEXT NOT NULL,
                day    TEXT NOT NULL,
                tokens_in  INTEGER NOT NULL DEFAULT 0,
                tokens_out INTEGER NOT NULL DEFAULT 0,
                cost_usd   REAL    NOT NULL DEFAULT 0.0,
                PRIMARY KEY (app_id, day)
            )
        """)
        conn.commit()

    def get_usage(self, app_id: str, day: date) -> DailyUsage:
        conn = self._connect()
        row = conn.execute(
            "SELECT tokens_in, tokens_out, cost_usd FROM daily_usage WHERE app_id=? AND day=?",
            (app_id, day.isoformat()),
        ).fetchone()
        if self._conn is None:
            conn.close()
        return DailyUsage() if row is None else DailyUsage(row[0], row[1], row[2])

    def add_usage(self, app_id: str, day: date, tokens_in: int, tokens_out: int, cost_usd: float) -> None:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO daily_usage (app_id, day, tokens_in, tokens_out, cost_usd)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(app_id, day) DO UPDATE SET
                tokens_in  = tokens_in  + excluded.tokens_in,
                tokens_out = tokens_out + excluded.tokens_out,
                cost_usd   = cost_usd   + excluded.cost_usd
            """,
            (app_id, day.isoformat(), tokens_in, tokens_out, cost_usd),
        )
        conn.commit()
        if self._conn is None:
            conn.close()


class DynamoDBBudgetRepository(BudgetRepository):
    """Production stub — swap SqliteBudgetRepository for this in AWS."""

    def get_usage(self, app_id: str, day: date) -> DailyUsage:
        # PRODUCTION: boto3.resource('dynamodb').Table('vibeapp-budgets').get_item(
        #     Key={'app_id': app_id, 'day': day.isoformat()})
        raise NotImplementedError("DynamoDB backend not configured")

    def add_usage(self, app_id: str, day: date, tokens_in: int, tokens_out: int, cost_usd: float) -> None:
        # PRODUCTION: DynamoDB update_item with ADD expression + TTL attribute
        raise NotImplementedError("DynamoDB backend not configured")


# USD per 1M tokens: (input_price, output_price)
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-3-5-haiku-20241022":   (0.80,  4.00),
    "claude-3-5-sonnet-20241022":  (3.00, 15.00),
    "claude-3-7-sonnet-20250219":  (3.00, 15.00),
    "claude-opus-4-5":             (15.00, 75.00),
    # Self-hosted via Ollama — no API cost
    "qwen2.5-coder":               (0.0, 0.0),
    "qwen2.5-coder:7b":            (0.0, 0.0),
    "qwen2.5-coder:14b":           (0.0, 0.0),
    "qwen2.5-coder:32b":           (0.0, 0.0),
}


def calculate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    prices = _MODEL_PRICING.get(model, (3.00, 15.00))
    return (tokens_in * prices[0] + tokens_out * prices[1]) / 1_000_000


class BudgetTracker:
    def __init__(self, repo: BudgetRepository):
        self.repo = repo

    def check(self, app_id: str, config: BudgetConfig) -> None:
        usage = self.repo.get_usage(app_id, date.today())
        if usage.total_tokens >= config.daily_token_limit:
            raise BudgetExceededError(
                "DAILY_TOKEN_LIMIT", float(usage.total_tokens), float(config.daily_token_limit), "tokens"
            )
        if usage.cost_usd >= config.daily_cost_limit_usd:
            raise BudgetExceededError(
                "DAILY_COST_LIMIT", usage.cost_usd, config.daily_cost_limit_usd, "USD"
            )

    def record(self, app_id: str, model: str, tokens_in: int, tokens_out: int) -> float:
        cost = calculate_cost(model, tokens_in, tokens_out)
        self.repo.add_usage(app_id, date.today(), tokens_in, tokens_out, cost)
        return cost

    def get_usage(self, app_id: str) -> DailyUsage:
        return self.repo.get_usage(app_id, date.today())
