import pytest

from app.scanner import synthetic_scan
from app.schemas import SecretSlot, Status, Submission


@pytest.fixture
def sample_submission() -> Submission:
    repo = synthetic_scan("https://github.com/alice-internal/claims-triage")
    return Submission(
        id="sub-test",
        repo_url="https://github.com/alice-internal/claims-triage",
        repo=repo,
        app_name="Claims Triage Helper",
        slug="claims-triage-helper",
        description="Sorts incoming abuse reports by severity",
        owner_email="maya.chen@alice.io",
        team="trust-intel",
        model_id="sonnet",
        budget=200,
        secrets=[
            SecretSlot(key=s.key, set=True, platform_managed=s.platform_managed)
            for s in repo.detected_secrets
        ],
        status=Status.review,
    )
