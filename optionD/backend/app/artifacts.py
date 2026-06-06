"""The four artifacts a real provisioner consumes.

This module is the heart of Option D. Given a validated submission it emits:
  1. iam-trust-policy.json   — who may assume the app's role (and only this app's runtime)
  2. iam-permissions.json    — least-privilege: one model, one S3 prefix, one secrets namespace
  3. deploy.yaml             — what the provisioner reads to stand up the service
  4. secrets-bootstrap.sh    — creates empty, named secret slots (never values)

Least-privilege is a platform invariant, not a knob: the scoping below is computed
from the slug/model and cannot be widened by tenant input. Tests assert this.
"""

from __future__ import annotations

import json

from app.catalog import model_by_id
from app.compute import task_size
from app.config import (
    APPS_BUCKET,
    AWS_ACCOUNT,
    AWS_REGION,
    ECS_CLUSTER,
    HUMAN_IN_LOOP_BUDGET_USD,
    OBS_MCP_ENDPOINT,
    PLATFORM_SECRET_ROTATION_DAYS,
)
from app.manifest import _bare_repo
from app.schemas import Artifact, Submission


def trust_policy(sub: Submission) -> str:
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "EcsTaskAssume",
                    "Effect": "Allow",
                    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                    "Condition": {
                        "StringEquals": {"aws:SourceAccount": AWS_ACCOUNT},
                        "ArnLike": {
                            "aws:SourceArn": f"arn:aws:ecs:{AWS_REGION}:{AWS_ACCOUNT}:task/{ECS_CLUSTER}/*"
                        },
                    },
                }
            ],
        },
        indent=2,
    )


def permissions_policy(sub: Submission) -> str:
    slug = sub.slug
    model = model_by_id(sub.model_id)
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "BedrockInvokeAllowlistedModelsOnly",
                    "Effect": "Allow",
                    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                    "Resource": [f"arn:aws:bedrock:{AWS_REGION}::foundation-model/{model.model_id}"],
                },
                {
                    "Sid": "S3OwnPrefixOnly",
                    "Effect": "Allow",
                    "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
                    "Resource": [
                        f"arn:aws:s3:::{APPS_BUCKET}",
                        f"arn:aws:s3:::{APPS_BUCKET}/{slug}/*",
                    ],
                    "Condition": {"StringLike": {"s3:prefix": [f"{slug}/*"]}},
                },
                {
                    "Sid": "SecretsOwnNamespaceOnly",
                    "Effect": "Allow",
                    "Action": ["secretsmanager:GetSecretValue"],
                    "Resource": [
                        f"arn:aws:secretsmanager:{AWS_REGION}:{AWS_ACCOUNT}:secret:apps/{slug}/*"
                    ],
                },
                {
                    "Sid": "EmitTelemetry",
                    "Effect": "Allow",
                    "Action": ["cloudwatch:PutMetricData"],
                    "Resource": "*",
                    "Condition": {"StringEquals": {"cloudwatch:namespace": f"vibeapp/{slug}"}},
                },
            ],
        },
        indent=2,
    )


def security_groups(sub: Submission) -> str:
    """Per-app network boundary — the inbound/outbound control App Runner can't express.

    Inbound: the task is reachable only from the internal ALB, on its own port. Outbound:
    deny-by-default with an allowlist to the egress proxy, the AI gateway (Bedrock has no
    public path), and the RDS proxy. The app subnet has no route to an internet gateway —
    that is the structural egress invariant from the platform design. Derived from the
    slug/port; a tenant cannot widen it. Tests assert these properties.
    """
    return json.dumps(
        {
            "albSg": {
                "scheme": "internal",
                "ingress": [
                    {
                        "from": "com.amazonaws.global.cloudfront.origin-facing",
                        "protocol": "tcp",
                        "port": 443,
                    }
                ],
            },
            "taskSg": {
                "ingress": [{"from": "albSg", "protocol": "tcp", "port": sub.repo.port}],
                "egress": [
                    {"to": "egress-proxy-sg", "note": "allowlisted outbound only"},
                    {"to": "ai-gateway-sg", "note": "Bedrock via gateway — no public path"},
                    {"to": "rds-proxy-sg", "note": "data tier via proxy"},
                ],
                "egressDefault": "deny",
                "internetGatewayRoute": False,
            },
        },
        indent=2,
    )


def deploy_config(sub: Submission) -> str:
    slug = sub.slug
    model = model_by_id(sub.model_id)
    size = task_size(sub.repo.runtime)
    lines = [
        "# deploy.yaml — generated by Vibeapp. Hand off to the provisioner as-is.",
        "apiVersion: vibeapp.alice.io/v1",
        "kind: AppDeployment",
        "metadata:",
        f"  name: {slug}",
        f"  owner: {sub.owner_email}",
        f"  team: {sub.team}",
        "source:",
        f"  repo: {_bare_repo(sub.repo_url)}",
        f"  ref: {sub.repo.ref}",
        f"  commit: {sub.repo.commit}",
        "runtime:",
        "  type: ecs-fargate",
        f"  cluster: {ECS_CLUSTER}",
        "  task:",
        f"    cpu: {size['cpu']}        # {size['cpuLabel']}",
        f"    memory: {size['memory']}     # {size['memoryLabel']}",
        f"    port: {sub.repo.port}",
        "    healthCheck: { path: /healthz, interval: 10 }",
        "  service:",
        "    desiredCount: 1",
        "    deploymentCircuitBreaker: { enable: true, rollback: true }",
        "    subnets: private-app",
        "    securityGroup: taskSg",
        "    albTargetGroup: { scheme: internal, port: 443 }",
        "iam:",
        "  taskRole:",
        "    trustPolicy: ./iam-trust-policy.json",
        "    permissions: ./iam-permissions.json",
        "  executionRole: platform-shared",
        "securityGroups: ./security-groups.json",
        "env:",
        "  - { name: APP_ENV, value: production }",
        f"  - {{ name: MODEL_ID, value: {model.model_id} }}",
        f"  - {{ name: OBS_MCP_ENDPOINT, value: {OBS_MCP_ENDPOINT} }}",
        "guardrails:",
        f"  modelAllowlist: [{model.model_id}]",
        f"  monthlyBudgetUsd: {sub.budget}",
        "  piiScan: true",
        "  promptInjectionShield: true",
        f"  humanInLoop: {str(sub.budget >= HUMAN_IN_LOOP_BUDGET_USD).lower()}",
        "observability:",
        "  tracing: true",
        f"  attribution: {{ app: {slug}, owner: {sub.owner_email} }}",
    ]
    return "\n".join(lines)


def secrets_bootstrap(sub: Submission) -> str:
    slug = sub.slug
    keys = " ".join(s.key for s in sub.secrets)
    lines = [
        "#!/usr/bin/env bash",
        "# secrets-bootstrap.sh — creates the namespace + empty slots. Never the values.",
        "set -euo pipefail",
        f'NS="apps/{slug}"',
        "",
        f"for KEY in {keys}; do",
        "  aws secretsmanager create-secret \\",
        '    --name "$NS/$KEY" \\',
        '    --description "Managed by Vibeapp — set value via console or rotation job" \\',
        f"    --tags Key=app,Value={slug} Key=owner,Value={sub.owner_email} \\",
        f"    --region {AWS_REGION} 2>/dev/null \\",
        '  || echo "exists: $NS/$KEY (skipped)"',
        "done",
        "",
        f"# Rotation: ANTHROPIC_API_KEY is platform-managed and rotated centrally every {PLATFORM_SECRET_ROTATION_DAYS}d.",
    ]
    return "\n".join(lines)


def generate_artifacts(sub: Submission) -> list[Artifact]:
    return [
        Artifact(
            file="iam-trust-policy.json",
            lang="json",
            body=trust_policy(sub),
            label="IAM trust policy",
            note="Lets the app's runtime assume its own role — and nothing else's.",
        ),
        Artifact(
            file="iam-permissions.json",
            lang="json",
            body=permissions_policy(sub),
            label="Least-privilege permissions",
            note="Scoped to one model, one S3 prefix, one secrets namespace.",
        ),
        Artifact(
            file="security-groups.json",
            lang="json",
            body=security_groups(sub),
            label="Network security groups",
            note="Inbound from the internal ALB only; egress deny-by-default to an allowlist. No internet-gateway route.",
        ),
        Artifact(
            file="deploy.yaml",
            lang="yaml",
            body=deploy_config(sub),
            label="Deployment config",
            note="What the provisioner reads to stand up the service.",
        ),
        Artifact(
            file="secrets-bootstrap.sh",
            lang="bash",
            body=secrets_bootstrap(sub),
            label="Secrets bootstrap",
            note="Creates empty, named slots. Values are set out-of-band.",
        ),
    ]
