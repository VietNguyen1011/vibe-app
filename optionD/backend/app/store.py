"""In-memory submission store.

A stand-in for the real datastore (DynamoDB / Postgres). Thread-safe enough for a
single-process demo; swap for a repository backed by a DB and the API is unchanged.
"""

from __future__ import annotations

from threading import RLock
from typing import Protocol

from app.scanner import slugify, synthetic_scan
from app.schemas import SecretSlot, Status, Submission


class StoreProtocol(Protocol):
    """The persistence contract routes depend on. In-memory today, a DB-backed
    repository tomorrow — routes never change."""

    def list(self) -> list[Submission]: ...
    def get(self, sub_id: str) -> Submission | None: ...
    def add(self, sub: Submission) -> Submission: ...
    def patch(self, sub_id: str, **changes) -> Submission | None: ...


class SubmissionStore:
    def __init__(self) -> None:
        self._items: dict[str, Submission] = {}
        self._lock = RLock()
        for sub in _seed():
            self._items[sub.id] = sub

    def list(self) -> list[Submission]:
        with self._lock:
            # newest first: add() prepends, so insertion order already has the
            # most recent submission at the head.
            return list(self._items.values())

    def get(self, sub_id: str) -> Submission | None:
        with self._lock:
            return self._items.get(sub_id)

    def add(self, sub: Submission) -> Submission:
        with self._lock:
            # prepend by rebuilding dict so the queue shows newest at top
            self._items = {sub.id: sub, **self._items}
            return sub

    def patch(self, sub_id: str, **changes) -> Submission | None:
        with self._lock:
            cur = self._items.get(sub_id)
            if cur is None:
                return None
            updated = cur.model_copy(update={k: v for k, v in changes.items() if v is not None})
            self._items[sub_id] = updated
            return updated


def _mk(over: dict) -> Submission:
    repo = synthetic_scan(over["repo_url"])
    return Submission(
        id=over["id"],
        repo_url=over["repo_url"],
        repo=repo,
        app_name=over["app_name"],
        slug=slugify(over["app_name"]),
        description=over["description"],
        owner_email=over["owner_email"],
        team=over["team"],
        model_id=over["model_id"],
        budget=over["budget"],
        secrets=[
            SecretSlot(key=s.key, set=True, platform_managed=s.platform_managed)
            for s in repo.detected_secrets
        ],
        status=Status(over["status"]),
        submitted_at=over["submitted_at"],
        live_url=over.get("live_url"),
        spend_this_month=over.get("spend_this_month", 0),
    )


def _seed() -> list[Submission]:
    return [
        _mk(
            dict(
                id="sub-claims",
                repo_url="https://github.com/alice-internal/claims-triage",
                app_name="Claims Triage Helper",
                description="Sorts incoming abuse reports by severity",
                owner_email="maya.chen@alice.io",
                team="trust-intel",
                model_id="sonnet",
                budget=200,
                status="review",
                submitted_at="12 min ago",
            )
        ),
        _mk(
            dict(
                id="sub-brief",
                repo_url="https://github.com/alice-internal/morning-brief",
                app_name="Morning Brief",
                description="Daily threat digest for the intel team",
                owner_email="devon.park@alice.io",
                team="research",
                model_id="haiku",
                budget=80,
                status="live",
                submitted_at="3 days ago",
                live_url="morning-brief.apps.alice.io",
                spend_this_month=41,
            )
        ),
        _mk(
            dict(
                id="sub-persona",
                repo_url="https://github.com/alice-internal/persona-lab",
                app_name="Persona Lab",
                description="Generates red-team persona prompts",
                owner_email="sam.ortiz@alice.io",
                team="adversarial",
                model_id="opus",
                budget=600,
                status="live",
                submitted_at="1 week ago",
                live_url="persona-lab.apps.alice.io",
                spend_this_month=312,
            )
        ),
    ]
