"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import Request

from app.store import StoreProtocol


def get_store(request: Request) -> StoreProtocol:
    """The submission store, created at startup and held on app.state."""
    return request.app.state.store
