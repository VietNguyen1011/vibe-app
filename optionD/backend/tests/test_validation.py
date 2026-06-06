from app.manifest import build_manifest
from app.validation import is_valid, validate_submission


def test_clean_submission_passes(sample_submission):
    checks = validate_submission(sample_submission)
    assert is_valid(checks)


def test_non_alice_owner_fails(sample_submission):
    sample_submission.owner_email = "maya@gmail.com"
    checks = validate_submission(sample_submission)
    owner = next(c for c in checks if c.id == "owner")
    assert owner.ok is False
    assert not is_valid(checks)


def test_zero_budget_fails(sample_submission):
    sample_submission.budget = 0
    checks = validate_submission(sample_submission)
    assert not is_valid(checks)


def test_unknown_model_fails(sample_submission):
    sample_submission.model_id = "gpt-4o"
    checks = validate_submission(sample_submission)
    model = next(c for c in checks if c.id == "model")
    assert model.ok is False


def test_s3_check_is_an_autoresolved_warning(sample_submission):
    checks = validate_submission(sample_submission)
    s3 = next(c for c in checks if c.id == "s3")
    assert s3.warn is True and s3.ok is True


def test_human_in_loop_triggers_at_budget_threshold(sample_submission):
    sample_submission.budget = 600
    assert build_manifest(sample_submission)["guardrails"]["humanInLoop"] is True
    sample_submission.budget = 200
    assert build_manifest(sample_submission)["guardrails"]["humanInLoop"] is False


def test_manifest_runtime_is_fargate_with_network_block(sample_submission):
    m = build_manifest(sample_submission)
    assert m["runtime"]["type"] == "ecs-fargate"
    assert m["network"]["internetGatewayRoute"] is False
    assert "ai-gateway" in m["network"]["egressAllowlist"]
