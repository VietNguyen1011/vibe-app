"""Runtime configuration via pydantic-settings.

Every value is overridable by a `VIBEAPP_`-prefixed env var (or a `.env` file), so
the same image runs in dev and prod without code changes. The defaults are the
platform invariants for Alice's internal account — see DESIGN.md → Tenancy.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VIBEAPP_", env_file=".env", extra="ignore"
    )

    # AWS placement (platform invariants).
    aws_account: str = "412755901388"
    aws_region: str = "us-east-1"
    apps_bucket: str = "alice-internal-apps"
    ecs_cluster: str = "vibeapp-apps"

    # Platform endpoints + policy.
    obs_mcp_endpoint: str = "https://obs.platform.alice.io/mcp"
    apps_domain: str = "apps.internal"
    owner_email_domain: str = "alice.io"
    human_in_loop_budget_usd: int = 500
    platform_secret_rotation_days: int = 90

    # Repo scanning. Optional GitHub token raises the API rate limit (60→5000/hr)
    # and enables private repos. Empty = unauthenticated public scans.
    github_token: str = ""
    scan_timeout_seconds: float = 8.0

    # GitHub App connect flow. All empty -> the dev FakeGitHubClient (offline).
    # Set these (App ID + PEM private key + OAuth client creds) to talk to real GitHub.
    github_app_id: str = ""
    github_app_private_key: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""
    github_app_slug: str = "vibeapp"
    # Relative by default so it works through the Vite dev proxy and same-origin in
    # prod. For real GitHub, set this to the absolute public URL registered in the App.
    github_callback_url: str = "/api/github/callback"

    # Behavior.
    provision_seconds: float = 2.6
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
