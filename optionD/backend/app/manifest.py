"""vibeapp.yaml manifest — the single source of truth.

Every artifact a provisioner consumes is derived from this manifest. The friendly
form answers are normalized here into the canonical app spec.
"""

from __future__ import annotations

import re

from app.catalog import model_by_id
from app.compute import task_size
from app.config import (
    APPS_BUCKET,
    HUMAN_IN_LOOP_BUDGET_USD,
    OBS_MCP_ENDPOINT,
)
from app.schemas import Submission


def _bare_repo(repo_url: str) -> str:
    return re.sub(r"^https?://", "", repo_url)


def build_manifest(sub: Submission) -> dict:
    model = model_by_id(sub.model_id)
    size = task_size(sub.repo.runtime)
    return {
        "apiVersion": "vibeapp.alice.io/v1",
        "kind": "AppDeployment",
        "metadata": {
            "name": sub.slug,
            "owner": sub.owner_email,
            "team": sub.team,
            "description": sub.description,
        },
        "source": {
            "repo": _bare_repo(sub.repo_url),
            "ref": sub.repo.ref,
            "commit": sub.repo.commit,
        },
        "runtime": {
            "type": "ecs-fargate",
            "framework": sub.repo.framework,
            "port": sub.repo.port,
            "cpu": size["cpu"],
            "memory": size["memory"],
        },
        "network": {
            "ingress": "private",
            "egressAllowlist": ["egress-proxy", "ai-gateway", "rds-proxy"],
            "internetGatewayRoute": False,
        },
        "guardrails": {
            "modelAllowlist": [model.model_id],
            "monthlyBudgetUsd": sub.budget,
            "piiScan": True,
            "promptInjectionShield": True,
            "humanInLoop": sub.budget >= HUMAN_IN_LOOP_BUDGET_USD,
        },
        "observability": {
            "mcpEndpoint": OBS_MCP_ENDPOINT,
            "tracing": True,
            "attribution": {"app": sub.slug, "owner": sub.owner_email},
        },
        "secrets": [f"apps/{sub.slug}/{s.key}" for s in sub.secrets],
        "s3Prefix": f"s3://{APPS_BUCKET}/{sub.slug}/",
    }
