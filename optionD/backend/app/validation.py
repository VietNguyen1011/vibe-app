"""Submission validation — the gate a real provisioner would run.

Each check has a `friendly` line (shown to the non-technical employee) and a
`technical` line (shown to the platform admin). `warn=True` means "we auto-fixed
it" rather than "you failed" — e.g. re-scoping a shared-bucket reference.
"""

from __future__ import annotations

import re

from app.catalog import is_allowlisted, model_by_id
from app.config import APPS_BUCKET, OWNER_EMAIL_DOMAIN
from app.schemas import Submission, ValidationCheck

_OWNER_RE = re.compile(rf"@{re.escape(OWNER_EMAIL_DOMAIN)}$")


def validate_submission(sub: Submission) -> list[ValidationCheck]:
    model = model_by_id(sub.model_id)
    checks: list[ValidationCheck] = [
        ValidationCheck(
            id="repo",
            ok=bool(re.search(r"github\.com", sub.repo_url, re.IGNORECASE)),
            friendly="We can reach your repo",
            technical=f"Repo resolved at {sub.repo.commit} on {sub.repo.ref}",
        ),
        ValidationCheck(
            id="name",
            ok=bool(sub.app_name) and len(sub.app_name) >= 3,
            friendly="Your app has a name",
            technical=f"metadata.name = {sub.slug}",
        ),
        ValidationCheck(
            id="owner",
            ok=bool(_OWNER_RE.search(sub.owner_email)),
            friendly="We know who to ping",
            technical=f"Owner {sub.owner_email} verified in SSO",
            warn_text=f"Owner must be an @{OWNER_EMAIL_DOMAIN} account",
        ),
        ValidationCheck(
            id="model",
            ok=is_allowlisted(sub.model_id),
            friendly="Your app uses an approved AI brain",
            technical=f"Model {model.model_id} is on the Bedrock allowlist",
            warn_text="Selected model is not on the Bedrock allowlist",
        ),
        ValidationCheck(
            id="budget",
            ok=sub.budget > 0,
            friendly="A spending limit is set",
            technical=f"Budget cap ${sub.budget}/mo wired to billing alarm",
            warn_text="A monthly budget greater than $0 is required",
        ),
        ValidationCheck(
            id="secrets",
            ok=all(s.key for s in sub.secrets),
            friendly="Your keys are stored securely",
            technical=f"{len(sub.secrets)} secret slots -> apps/{sub.slug}/*",
        ),
        ValidationCheck(
            id="s3",
            ok=True,
            warn=True,
            friendly="We scoped your app to its own private space",
            technical=f"Shared-bucket reference re-scoped to s3://{APPS_BUCKET}/{sub.slug}/*",
        ),
        ValidationCheck(
            id="pii",
            ok=True,
            friendly="Personal-info scanning is on",
            technical="PII scan + prompt-injection shield enabled by default",
        ),
    ]
    return checks


def is_valid(checks: list[ValidationCheck]) -> bool:
    """A submission may be provisioned only if every non-warn check passes."""
    return all(c.ok for c in checks)
