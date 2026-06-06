"""Submission lifecycle: create, list, fetch, approve, status transitions."""

from __future__ import annotations

import threading

from fastapi import APIRouter, Depends

from app import auth
from app.deps import get_store
from app.errors import ConflictError, NotFoundError, ValidationGateError
from app.schemas import (
    Status,
    StatusPatch,
    Submission,
    SubmissionDetail,
    SubmissionInput,
    User,
)
from app.service import build_detail, input_to_submission
from app.settings import get_settings
from app.store import StoreProtocol
from app.validation import validate_submission

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.get("", response_model=list[Submission])
def list_submissions(store: StoreProtocol = Depends(get_store)) -> list[Submission]:
    return store.list()


@router.post("", response_model=SubmissionDetail, status_code=201)
def create_submission(
    data: SubmissionInput,
    user: User = Depends(auth.current_user),
    store: StoreProtocol = Depends(get_store),
) -> SubmissionDetail:
    # Owner is the authenticated user — never trusted from the request body.
    sub = input_to_submission(data)
    sub.owner_email = user.email
    store.add(sub)
    return build_detail(sub)


@router.get("/{sub_id}", response_model=SubmissionDetail)
def get_submission(sub_id: str, store: StoreProtocol = Depends(get_store)) -> SubmissionDetail:
    sub = store.get(sub_id)
    if sub is None:
        raise NotFoundError("Submission not found")
    return build_detail(sub)


@router.patch("/{sub_id}", response_model=Submission)
def patch_submission(
    sub_id: str,
    patch: StatusPatch,
    _: User = Depends(auth.require_admin),
    store: StoreProtocol = Depends(get_store),
) -> Submission:
    """Request changes / retire — generic status transitions for the admin."""
    sub = store.patch(sub_id, status=patch.status, live_url=patch.live_url)
    if sub is None:
        raise NotFoundError("Submission not found")
    return sub


@router.post("/{sub_id}/approve", response_model=Submission)
def approve(
    sub_id: str,
    _: User = Depends(auth.require_admin),
    store: StoreProtocol = Depends(get_store),
) -> Submission:
    """Approve & provision.

    Only a submission that passes every validation check may be approved (the gate).
    Flips to `provisioning` immediately, then to `live` after the provisioner runs.
    The delayed transition runs on a timer thread so it is independent of the
    request's event loop (works under both uvicorn and the test client)."""
    sub = store.get(sub_id)
    if sub is None:
        raise NotFoundError("Submission not found")
    if sub.status != Status.review:
        raise ConflictError(f"Cannot approve a submission in status '{sub.status.value}'")

    checks = validate_submission(sub)
    if not all(c.ok for c in checks):
        failed = [c.id for c in checks if not c.ok]
        raise ValidationGateError(f"Validation failed: {', '.join(failed)}")

    sub = store.patch(sub_id, status=Status.provisioning)
    delay = get_settings().provision_seconds
    threading.Timer(delay, _finish_provisioning, args=(store, sub_id)).start()
    return sub


def _finish_provisioning(store: StoreProtocol, sub_id: str) -> None:
    sub = store.get(sub_id)
    if sub is None or sub.status != Status.provisioning:
        return
    domain = get_settings().apps_domain
    store.patch(sub_id, status=Status.live, live_url=f"{sub.slug}.{domain}")
