"""Domain exceptions + a single place that maps them to HTTP responses.

Routes raise semantic errors (`NotFoundError`, `ForbiddenError`, …) instead of
HTTP-coupled `HTTPException`. One handler renders them all to a consistent envelope
`{"error": <code>, "detail": <message>}`, so clients can branch on a stable `error`
code rather than parsing prose.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class VibeappError(Exception):
    status = 400
    code = "error"

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class UnauthorizedError(VibeappError):
    status, code = 401, "unauthorized"


class ForbiddenError(VibeappError):
    status, code = 403, "forbidden"


class NotFoundError(VibeappError):
    status, code = 404, "not_found"


class ConflictError(VibeappError):
    status, code = 409, "conflict"


class ValidationGateError(VibeappError):
    status, code = 422, "validation_failed"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(VibeappError)
    async def _handle(_: Request, exc: VibeappError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content={"error": exc.code, "detail": exc.detail},
        )
