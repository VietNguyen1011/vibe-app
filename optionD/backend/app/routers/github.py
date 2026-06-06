"""GitHub App connect routes — authorize → callback → list repos → disconnect."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse

from app import auth, github
from app.deps import get_store
from app.errors import ConflictError, ForbiddenError
from app.github import GithubStatus, RepoRef
from app.schemas import CamelModel, User
from app.store import StoreProtocol

router = APIRouter(prefix="/api/github", tags=["github"])


class AuthorizeResponse(CamelModel):
    authorize_url: str


@router.get("/status", response_model=GithubStatus)
def status(store: StoreProtocol = Depends(get_store)) -> GithubStatus:
    conn = store.get_connection()
    return GithubStatus(connected=conn is not None, account=conn.account if conn else None)


@router.get("/connect", response_model=AuthorizeResponse)
def connect(
    _: User = Depends(auth.current_user),
    store: StoreProtocol = Depends(get_store),
) -> AuthorizeResponse:
    """Start the flow: mint a CSRF state and return where the browser should go."""
    state = secrets.token_urlsafe(16)
    store.add_state(state)
    return AuthorizeResponse(authorize_url=github.get_github_client().authorize_url(state))


@router.get("/callback")
def callback(
    state: str = "",
    code: str = "",
    installation_id: str = "",
    store: StoreProtocol = Depends(get_store),
) -> RedirectResponse:
    """GitHub (or the fake) redirects here. Validate CSRF, exchange, store, bounce to SPA."""
    if not store.take_state(state):
        raise ForbiddenError("Invalid or expired OAuth state")
    conn = github.get_github_client().exchange(code, installation_id)
    store.set_connection(conn)
    return RedirectResponse(url="/?github=connected", status_code=302)


@router.get("/repos", response_model=list[RepoRef])
def repos(
    _: User = Depends(auth.current_user),
    store: StoreProtocol = Depends(get_store),
) -> list[RepoRef]:
    conn = store.get_connection()
    if conn is None:
        raise ConflictError("GitHub is not connected")
    return github.get_github_client().list_repos(conn)


@router.post("/disconnect", status_code=204)
def disconnect(
    _: User = Depends(auth.current_user),
    store: StoreProtocol = Depends(get_store),
) -> None:
    store.clear_connection()
