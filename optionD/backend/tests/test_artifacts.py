"""The artifacts are the product. These tests pin the least-privilege invariants
that must hold no matter what a tenant submits."""

import json

from app.artifacts import (
    deploy_config,
    generate_artifacts,
    permissions_policy,
    secrets_bootstrap,
    security_groups,
    trust_policy,
)
from app.catalog import model_by_id
from app.compute import task_size


def test_generates_five_named_artifacts(sample_submission):
    files = {a.file for a in generate_artifacts(sample_submission)}
    assert files == {
        "iam-trust-policy.json",
        "iam-permissions.json",
        "security-groups.json",
        "deploy.yaml",
        "secrets-bootstrap.sh",
    }


def test_trust_policy_assumable_only_by_ecs_tasks(sample_submission):
    pol = json.loads(trust_policy(sample_submission))
    stmt = pol["Statement"][0]
    assert stmt["Principal"]["Service"] == "ecs-tasks.amazonaws.com"
    src_arn = stmt["Condition"]["ArnLike"]["aws:SourceArn"]
    assert ":task/" in src_arn and "vibeapp-apps" in src_arn


def test_security_groups_no_public_inbound_no_open_egress(sample_submission):
    sg = json.loads(security_groups(sample_submission))
    task = sg["taskSg"]
    # Inbound only from the ALB SG, on the app port — never the open internet.
    assert task["ingress"] == [
        {"from": "albSg", "protocol": "tcp", "port": sample_submission.repo.port}
    ]
    assert all(rule["from"] != "0.0.0.0/0" for rule in task["ingress"])
    # Egress is deny-by-default with an explicit allowlist — never 0.0.0.0/0.
    assert task["egressDefault"] == "deny"
    assert all(rule["to"] != "0.0.0.0/0" for rule in task["egress"])
    assert {rule["to"] for rule in task["egress"]} == {
        "egress-proxy-sg",
        "ai-gateway-sg",
        "rds-proxy-sg",
    }
    # The structural invariant: app subnet has no route to an internet gateway.
    assert task["internetGatewayRoute"] is False


def test_alb_is_internal(sample_submission):
    sg = json.loads(security_groups(sample_submission))
    assert sg["albSg"]["scheme"] == "internal"


def test_deploy_is_ecs_fargate_with_block_sizing_and_circuit_breaker(sample_submission):
    y = deploy_config(sample_submission)
    assert "type: ecs-fargate" in y
    size = task_size(sample_submission.repo.runtime)
    assert f"cpu: {size['cpu']}" in y and f"memory: {size['memory']}" in y
    assert "deploymentCircuitBreaker" in y and "rollback: true" in y
    assert "securityGroups: ./security-groups.json" in y
    assert "apprunner" not in y


def test_permissions_pin_exactly_one_bedrock_model(sample_submission):
    pol = json.loads(permissions_policy(sample_submission))
    bedrock = next(s for s in pol["Statement"] if s["Sid"].startswith("BedrockInvoke"))
    model = model_by_id(sample_submission.model_id)
    assert bedrock["Resource"] == [
        f"arn:aws:bedrock:us-east-1::foundation-model/{model.model_id}"
    ]


def test_permissions_s3_fenced_to_own_prefix(sample_submission):
    pol = json.loads(permissions_policy(sample_submission))
    s3 = next(s for s in pol["Statement"] if s["Sid"] == "S3OwnPrefixOnly")
    slug = sample_submission.slug
    assert s3["Condition"]["StringLike"]["s3:prefix"] == [f"{slug}/*"]
    # No statement may grant a wildcard S3 resource.
    assert all("arn:aws:s3:::*" not in r for st in pol["Statement"] for r in _resources(st))


def test_permissions_secrets_namespaced(sample_submission):
    pol = json.loads(permissions_policy(sample_submission))
    sec = next(s for s in pol["Statement"] if s["Sid"] == "SecretsOwnNamespaceOnly")
    assert sec["Resource"][0].endswith(f"secret:apps/{sample_submission.slug}/*")


def test_a_malicious_app_name_cannot_break_out_of_its_prefix():
    """slugify must neutralize path-traversal / wildcard attempts in the app name."""
    from app.scanner import slugify, synthetic_scan
    from app.schemas import Submission

    evil = "../* OR s3:::*"
    slug = slugify(evil)
    assert "/" not in slug and "*" not in slug and ".." not in slug
    sub = Submission(
        id="x",
        repo_url="https://github.com/alice-internal/x",
        repo=synthetic_scan("https://github.com/alice-internal/x"),
        app_name=evil,
        slug=slug,
        owner_email="a@alice.io",
        team="research",
        model_id="sonnet",
        budget=50,
        secrets=[],
    )
    pol = json.loads(permissions_policy(sub))
    for st in pol["Statement"]:
        for r in _resources(st):
            assert ".." not in r


def test_secrets_bootstrap_never_contains_values(sample_submission):
    script = secrets_bootstrap(sample_submission)
    assert "create-secret" in script
    # Bootstrap creates named slots only — the --secret-string flag must be absent.
    assert "--secret-string" not in script


def _resources(statement):
    r = statement.get("Resource", [])
    return r if isinstance(r, list) else [r]
