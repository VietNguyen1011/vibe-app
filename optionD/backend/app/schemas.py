"""API contract — Pydantic models.

The shapes here are the honest interface between the portal and a real provisioner.
A submission goes in; a manifest + four artifacts + a validation report come out.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _camel(s: str) -> str:
    head, *tail = s.split("_")
    return head + "".join(w.capitalize() for w in tail)


class CamelModel(BaseModel):
    """Serialize to camelCase for the JS frontend, accept either casing in."""

    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)


# ----------------------------------------------------------------------------- auth


class Role(str, Enum):
    employee = "employee"
    admin = "admin"


class User(CamelModel):
    email: str
    name: str
    team: str
    role: Role


class LoginRequest(CamelModel):
    email: str


class LoginResponse(CamelModel):
    token: str
    user: User


# ----------------------------------------------------------------------------- catalog


class ModelOption(CamelModel):
    id: str
    label: str
    blurb: str
    model_id: str
    in_per_1k: float
    out_per_1k: float
    recommended: bool = False


# ----------------------------------------------------------------------------- repo scan


class DetectedSecret(CamelModel):
    key: str
    reason: str
    platform_managed: bool = False


class Finding(CamelModel):
    level: Literal["ok", "warn", "danger"]
    text: str


class RepoScan(CamelModel):
    url: str
    owner: str
    name: str
    ref: str
    commit: str
    runtime: str
    framework: str
    dockerfile: bool
    entrypoint: str
    port: int
    detected_secrets: list[DetectedSecret]
    findings: list[Finding]


class ScanRequest(CamelModel):
    # Exactly one of these. repo_url = public path; repo_full_name = a connected
    # (possibly private) repo read via the GitHub App installation.
    repo_url: str | None = None
    repo_full_name: str | None = None


# ----------------------------------------------------------------------------- submission


class Status(str, Enum):
    review = "review"
    provisioning = "provisioning"
    live = "live"
    failed = "failed"


class SecretSlot(CamelModel):
    key: str
    set: bool = False
    platform_managed: bool = False
    # NOTE: a value is never persisted server-side — the portal only records that
    # a slot exists. Real values are written out-of-band into Secrets Manager.
    reason: str | None = None


class SubmissionInput(CamelModel):
    """What the friendly wizard collects. Everything a non-technical user answers."""

    repo_url: str = Field(min_length=1)
    repo: RepoScan
    app_name: str = Field(min_length=1)
    description: str = ""
    owner_email: str
    team: str
    model_id: str = "sonnet"
    budget: int = Field(ge=0)
    secrets: list[SecretSlot] = []


class ValidationCheck(CamelModel):
    id: str
    ok: bool
    warn: bool = False
    friendly: str
    technical: str
    warn_text: str | None = None


class CostProjection(CamelModel):
    monthly: int
    per_call: float
    calls_per_day: int


class Artifact(CamelModel):
    file: str
    lang: Literal["json", "yaml", "bash"]
    body: str
    label: str
    note: str


class Submission(CamelModel):
    id: str
    repo_url: str
    repo: RepoScan
    app_name: str
    slug: str
    description: str = ""
    owner_email: str
    team: str
    model_id: str
    budget: int
    secrets: list[SecretSlot]
    status: Status = Status.review
    submitted_at: str = "just now"
    live_url: str | None = None
    spend_this_month: int = 0


class SubmissionDetail(CamelModel):
    """A submission plus everything derived from it — the admin's full view."""

    submission: Submission
    manifest: dict
    artifacts: list[Artifact]
    validation: list[ValidationCheck]
    cost: CostProjection


class StatusPatch(CamelModel):
    status: Status | None = None
    live_url: str | None = None
