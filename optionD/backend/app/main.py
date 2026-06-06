"""Vibeapp portal API (Option D) — application factory.

Takes a GitHub repo URL + an app manifest (collected via a friendly form), validates
it, and produces the artifacts a real provisioner would consume. It does NOT actually
provision — approval simulates a `provisioning → live` transition so the lifecycle is
visible end to end.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.errors import install_error_handlers
from app.routers import auth, catalog, github, health, submissions
from app.settings import get_settings
from app.store import SubmissionStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Store is created in create_app so it exists for the app's whole lifetime
    # (and under a bare TestClient). Lifespan is where real resources — DB pools,
    # the obs MCP client — would be opened/closed in production.
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Vibeapp",
        description="From prompt to production — submit a vibe-coded app for safe deployment.",
        version="0.2.0",
        lifespan=lifespan,
    )
    # Held on app.state, injected via deps.get_store. One instance per app.
    app.state.store = SubmissionStore()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    for module in (health, auth, catalog, github, submissions):
        app.include_router(module.router)
    return app


app = create_app()
