"""Auth routes — mock SSO sign-in for the dev slice."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from app import auth
from app.schemas import LoginRequest, LoginResponse, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/dev-users", response_model=list[User])
def dev_users() -> list[User]:
    """Dev-only: the SSO identities offered as one-click sign-ins."""
    return auth.dev_users()


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    """Dev SSO. In prod this validates an OIDC token instead of trusting an email."""
    token, user = auth.dev_login(req.email)
    return LoginResponse(token=token, user=user)


@router.get("/me", response_model=User)
def me(user: User = Depends(auth.current_user)) -> User:
    return user


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)) -> None:
    if authorization:
        _, _, token = authorization.partition(" ")
        auth.logout(token)
