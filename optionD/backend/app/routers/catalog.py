"""Pre-submit helpers: model allowlist, repo scan, and the non-persisting safety
check that powers the wizard's live preview."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app import auth, github
from app.catalog import MODEL_CATALOG
from app.deps import get_store
from app.errors import ConflictError, ValidationGateError
from app.scanner import scan_repo
from app.store import StoreProtocol
from app.schemas import (
    CamelModel,
    CostProjection,
    ModelOption,
    RepoScan,
    ScanRequest,
    SubmissionInput,
    User,
    ValidationCheck,
)
from app.service import build_detail, input_to_submission

router = APIRouter(prefix="/api", tags=["catalog"])


class ValidationResponse(CamelModel):
    validation: list[ValidationCheck]
    cost: CostProjection


@router.get("/models", response_model=list[ModelOption])
def list_models() -> list[ModelOption]:
    """The Bedrock model allowlist the employee picks from."""
    return MODEL_CATALOG


@router.post("/scan", response_model=RepoScan)
def scan(req: ScanRequest, store: StoreProtocol = Depends(get_store)) -> RepoScan:
    """Read-only scan. A connected repo (repoFullName) is read via the GitHub App
    installation token; a public repoUrl uses the unauthenticated path."""
    if req.repo_full_name:
        conn = store.get_connection()
        if conn is None:
            raise ConflictError("GitHub is not connected")
        return github.get_github_client().read_repo(conn, req.repo_full_name)
    if req.repo_url:
        return scan_repo(req.repo_url)
    raise ValidationGateError("Provide repoUrl or repoFullName")


@router.post("/validate", response_model=ValidationResponse)
def validate(data: SubmissionInput, user: User = Depends(auth.current_user)) -> ValidationResponse:
    """Run the safety check without persisting.

    Owner identity is taken from the session, not the body, so the preview reflects
    the real authenticated owner."""
    sub = input_to_submission(data)
    sub.owner_email = user.email
    detail = build_detail(sub)
    return ValidationResponse(validation=detail.validation, cost=detail.cost)
