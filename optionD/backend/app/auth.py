"""Authentication — mock SSO for the dev slice.

In production this module would validate an OIDC/SAML token from Alice's IdP
(e.g. Okta / Entra) and map the verified identity + group claims to a User. Here,
to keep the slice runnable without an IdP, `dev_login` trusts a known email from a
curated directory — a one-click sign-in. The rest of the app only ever sees the
resolved `User`, so swapping the dev login for real token validation is a local
change with no ripple.

The boundary the code enforces is real: identity comes from the session, not from
request bodies. A submission's owner is the *authenticated* user — a caller cannot
submit an app "as" someone else.
"""

from __future__ import annotations

import secrets
from threading import RLock

from fastapi import Depends, Header

from app.errors import ForbiddenError, UnauthorizedError
from app.schemas import Role, User

# Curated dev SSO directory. In prod these come from the IdP, not a constant.
_DIRECTORY: dict[str, User] = {
    "maya.chen@alice.io": User(
        email="maya.chen@alice.io", name="Maya Chen", team="trust-intel", role=Role.employee
    ),
    "devon.park@alice.io": User(
        email="devon.park@alice.io", name="Devon Park", team="research", role=Role.employee
    ),
    "priya.nair@alice.io": User(
        email="priya.nair@alice.io", name="Priya Nair", team="platform", role=Role.admin
    ),
}

# token -> email. A stand-in for a real session store / verified JWT.
_SESSIONS: dict[str, str] = {}
_LOCK = RLock()


def dev_users() -> list[User]:
    """The identities offered on the dev login screen."""
    return list(_DIRECTORY.values())


def dev_login(email: str) -> tuple[str, User]:
    user = _DIRECTORY.get(email)
    if user is None:
        raise UnauthorizedError("Unknown SSO identity")
    token = secrets.token_urlsafe(24)
    with _LOCK:
        _SESSIONS[token] = email
    return token, user


def logout(token: str) -> None:
    with _LOCK:
        _SESSIONS.pop(token, None)


def _user_for_token(token: str | None) -> User | None:
    if not token:
        return None
    with _LOCK:
        email = _SESSIONS.get(token)
    return _DIRECTORY.get(email) if email else None


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token if scheme.lower() == "bearer" and token else None


def current_user(authorization: str | None = Header(default=None)) -> User:
    """Resolve the authenticated user or 401. Use as a route dependency."""
    user = _user_for_token(_bearer(authorization))
    if user is None:
        raise UnauthorizedError("Not authenticated")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    """Gate platform-admin actions to the admin role."""
    if user.role != Role.admin:
        raise ForbiddenError("Platform-admin role required")
    return user
