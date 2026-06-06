from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml

from guardrails.budget import BudgetConfig


@dataclass
class AppConfig:
    app_id: str
    allowed_models: list[str]
    budget: BudgetConfig
    pii_action: Literal["block", "redact", "warn"] = "block"


class AppNotFoundError(Exception):
    def __init__(self, app_id: str) -> None:
        self.app_id = app_id
        super().__init__(f"App '{app_id}' not found in registry")


class AppRegistry:
    def __init__(self, registry_path: str = "app_registry.yaml") -> None:
        self._apps: dict[str, AppConfig] = {}
        self._load(registry_path)

    def _load(self, path: str) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        for app_id, cfg in data["apps"].items():
            self._apps[app_id] = AppConfig(
                app_id=app_id,
                allowed_models=cfg["allowed_models"],
                budget=BudgetConfig(
                    daily_token_limit=cfg["budget"]["daily_token_limit"],
                    daily_cost_limit_usd=cfg["budget"]["daily_cost_limit_usd"],
                ),
                pii_action=cfg.get("pii_action", "block"),
            )

    def get(self, app_id: str) -> AppConfig:
        if app_id not in self._apps:
            raise AppNotFoundError(app_id)
        return self._apps[app_id]

    def all_ids(self) -> list[str]:
        return list(self._apps.keys())
