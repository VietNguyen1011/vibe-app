"""Platform invariants, sourced from Settings defaults.

Pure modules (artifacts, manifest, validation, cost) import these constants so they
stay unit-testable without a request context. The values come from `Settings()` — a
single source of truth — while env overrides at app-wiring time live in
`settings.get_settings()`.

These are deliberately constants, not request inputs: the employee supplies intent
and the platform owns the boundaries (account, region, bucket, namespaces, budget
thresholds). Per-app values (slug, owner, model) are parameterized elsewhere.
"""

from __future__ import annotations

from app.settings import get_settings

_s = get_settings()

AWS_ACCOUNT = _s.aws_account
AWS_REGION = _s.aws_region
APPS_BUCKET = _s.apps_bucket
ECS_CLUSTER = _s.ecs_cluster
OBS_MCP_ENDPOINT = _s.obs_mcp_endpoint
APPS_DOMAIN = _s.apps_domain
OWNER_EMAIL_DOMAIN = _s.owner_email_domain
HUMAN_IN_LOOP_BUDGET_USD = _s.human_in_loop_budget_usd
PLATFORM_SECRET_ROTATION_DAYS = _s.platform_secret_rotation_days
