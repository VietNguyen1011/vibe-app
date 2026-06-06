"""Application service layer — ties the pieces together.

Kept separate from the HTTP layer so the same logic is unit-testable without a
client. `build_detail` is the canonical "submission -> everything derived" path
used by both the create and fetch endpoints.
"""

from __future__ import annotations

import secrets as _secrets

from app.artifacts import generate_artifacts
from app.cost import project_cost
from app.manifest import build_manifest
from app.scanner import slugify
from app.schemas import (
    Status,
    Submission,
    SubmissionDetail,
    SubmissionInput,
)
from app.validation import validate_submission


def new_id() -> str:
    return "sub-" + _secrets.token_hex(3)


def input_to_submission(data: SubmissionInput, *, sub_id: str | None = None) -> Submission:
    """Normalize friendly form input into a canonical Submission."""
    return Submission(
        id=sub_id or new_id(),
        repo_url=data.repo_url if data.repo_url.startswith("http") else "https://" + data.repo_url,
        repo=data.repo,
        app_name=data.app_name,
        slug=slugify(data.app_name or data.repo.name),
        description=data.description,
        owner_email=data.owner_email,
        team=data.team,
        model_id=data.model_id,
        budget=data.budget,
        secrets=data.secrets,
        status=Status.review,
        submitted_at="just now",
        spend_this_month=0,
    )


def build_detail(sub: Submission) -> SubmissionDetail:
    return SubmissionDetail(
        submission=sub,
        manifest=build_manifest(sub),
        artifacts=generate_artifacts(sub),
        validation=validate_submission(sub),
        cost=project_cost(sub),
    )
