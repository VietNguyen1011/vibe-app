# Launchpad Prod-Hardening + TypeScript Migration — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`).
> NOTE: This repo is not under git and the user's policy forbids commits unless
> asked — the per-task "commit" steps from the standard template are intentionally
> omitted. Verify each task with its test/typecheck instead.

**Goal:** Raise the working Launchpad Option D slice to production-shaped best
practices — FastAPI restructure + full React TypeScript migration + TanStack Query —
without changing behavior or the verified UI.

**Architecture:** Backend gets pydantic-settings, an app factory + lifespan, domain
routers, centralized exceptions, and a DI-injected store behind a Protocol. Frontend
migrates to strict TS with typed API models and TanStack Query for server-state
(declarative polling). Docker artifacts added. Behavior is preserved; the same
end-to-end flows verify it.

**Tech Stack:** FastAPI, pydantic-settings, uv/pyproject, pytest · React 18, Vite,
TypeScript (strict), @tanstack/react-query, Vitest + RTL · Docker.

---

## File Structure

**Backend (`backend/app/`)**
- `settings.py` (new) — `Settings(BaseSettings)`, `get_settings()`.
- `config.py` (modify) — re-export constants from `Settings()` defaults (keeps pure
  modules import-driven).
- `errors.py` (new) — `LaunchpadError` hierarchy + handler registration.
- `store.py` (modify) — add `StoreProtocol`; `SubmissionStore` unchanged logic.
- `deps.py` (new) — `get_store`, re-export auth deps.
- `routers/health.py`, `routers/auth.py`, `routers/catalog.py`, `routers/submissions.py` (new).
- `main.py` (rewrite) — `create_app()` + `lifespan`; `app = create_app()`.
- `auth.py` (modify) — raise `errors.*` instead of `HTTPException`; store sessions as-is.

**Frontend (`frontend/`)**
- `tsconfig.json`, `tsconfig.node.json`, `eslint.config.js` (new).
- `src/types.ts` (new) — API model types.
- `src/api/client.ts` (was `api.js`) — typed wrapper + token store.
- `src/api/queries.ts` (new) — query/mutation hooks.
- `src/main.tsx`, `src/App.tsx`, all components → `.tsx`.
- `src/test/*.test.tsx` (new) — Vitest.
- `vite.config.ts`, `vitest` config.

**Docker (root + each app)**
- `backend/Dockerfile`, `backend/.dockerignore`.
- `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`.
- `docker-compose.yml`.

---

## Part 1 — Backend

### Task 1: Settings via pydantic-settings

**Files:** Create `backend/app/settings.py`; Modify `backend/app/config.py`; add dep in `pyproject.toml`.

- [ ] **Step 1** Add `pydantic-settings>=2.5` to `[project].dependencies`, `uv sync`.
- [ ] **Step 2** Write `settings.py`:

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LAUNCHPAD_", env_file=".env", extra="ignore")
    aws_account: str = "412755901388"
    aws_region: str = "us-east-1"
    apps_bucket: str = "alice-internal-apps"
    obs_mcp_endpoint: str = "https://obs.platform.alice.io/mcp"
    apps_domain: str = "apps.alice.io"
    owner_email_domain: str = "alice.io"
    human_in_loop_budget_usd: int = 500
    platform_secret_rotation_days: int = 90
    provision_seconds: float = 2.6
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3** Rewrite `config.py` to source constants from defaults (keeps
  `from app.config import AWS_ACCOUNT` working in pure modules):

```python
from app.settings import get_settings
_s = get_settings()
AWS_ACCOUNT = _s.aws_account
AWS_REGION = _s.aws_region
APPS_BUCKET = _s.apps_bucket
OBS_MCP_ENDPOINT = _s.obs_mcp_endpoint
APPS_DOMAIN = _s.apps_domain
OWNER_EMAIL_DOMAIN = _s.owner_email_domain
HUMAN_IN_LOOP_BUDGET_USD = _s.human_in_loop_budget_usd
PLATFORM_SECRET_ROTATION_DAYS = _s.platform_secret_rotation_days
```

- [ ] **Step 4** Run `uv run pytest` — still green (pure modules unaffected).

### Task 2: Centralized errors

**Files:** Create `backend/app/errors.py`.

- [ ] **Step 1** Write hierarchy + handler installer:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

class LaunchpadError(Exception):
    status = 400
    code = "error"
    def __init__(self, detail: str): self.detail = detail

class UnauthorizedError(LaunchpadError): status, code = 401, "unauthorized"
class ForbiddenError(LaunchpadError): status, code = 403, "forbidden"
class NotFoundError(LaunchpadError): status, code = 404, "not_found"
class ConflictError(LaunchpadError): status, code = 409, "conflict"
class ValidationGateError(LaunchpadError): status, code = 422, "validation_failed"

def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(LaunchpadError)
    async def _handle(_: Request, exc: LaunchpadError):
        return JSONResponse(status_code=exc.status, content={"error": exc.code, "detail": exc.detail})
```

- [ ] **Step 2** `uv run python -c "import app.errors"` — imports clean.

### Task 3: Store Protocol + DI

**Files:** Modify `backend/app/store.py`; Create `backend/app/deps.py`.

- [ ] **Step 1** Add Protocol to `store.py`:

```python
from typing import Protocol
class StoreProtocol(Protocol):
    def list(self) -> list[Submission]: ...
    def get(self, sub_id: str) -> Submission | None: ...
    def add(self, sub: Submission) -> Submission: ...
    def patch(self, sub_id: str, **changes) -> Submission | None: ...
```

- [ ] **Step 2** Write `deps.py`:

```python
from fastapi import Request
from app.store import StoreProtocol

def get_store(request: Request) -> StoreProtocol:
    return request.app.state.store
```

- [ ] **Step 3** `uv run python -c "import app.deps"` — clean.

### Task 4: Routers

**Files:** Create `backend/app/routers/{__init__.py,health.py,auth.py,catalog.py,submissions.py}`.

- [ ] **Step 1** `health.py`: `router = APIRouter()`; `GET /api/health` → `{"status":"ok"}`.
- [ ] **Step 2** `auth.py`: move the 4 auth routes; use `auth.dev_users/dev_login/...`;
  raise `UnauthorizedError` instead of `HTTPException` in `auth.py` module.
- [ ] **Step 3** `catalog.py`: `GET /api/models`, `POST /api/scan`, `POST /api/validate`
  (validate depends `auth.current_user`, sets `sub.owner_email = user.email`).
  Keep `ValidationResponse` model here (or in schemas).
- [ ] **Step 4** `submissions.py`: list/create/get/patch/approve. `create`/`validate`
  set owner from session; `patch`/`approve` depend `auth.require_admin`; use
  `get_store` dependency; raise `NotFoundError`/`ConflictError`/`ValidationGateError`.
  Move `_finish_provisioning` timer here (reads `provision_seconds` from settings).
- [ ] **Step 5** `auth.py` module: replace its `HTTPException` raises with
  `UnauthorizedError`/`ForbiddenError`.

### Task 5: App factory + lifespan

**Files:** Rewrite `backend/app/main.py`.

- [ ] **Step 1** Write:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.settings import get_settings
from app.errors import install_error_handlers
from app.store import SubmissionStore
from app.routers import health, auth, catalog, submissions

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = SubmissionStore()
    yield

def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Launchpad", version="0.2.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])
    install_error_handlers(app)
    for m in (health, auth, catalog, submissions):
        app.include_router(m.router)
    return app

app = create_app()
```

- [ ] **Step 2** Run `uv run uvicorn app.main:app --port 8099` smoke (curl health).

### Task 6: Adapt + extend tests

**Files:** Modify `backend/tests/*`; Create `backend/tests/test_errors.py`, `test_settings.py`.

- [ ] **Step 1** Update imports if any moved; `TestClient(app)` still valid.
- [ ] **Step 2** `test_settings.py`: monkeypatch env `LAUNCHPAD_PROVISION_SECONDS=0.1`,
  assert `Settings().provision_seconds == 0.1` (use a fresh `Settings()` not cached).
- [ ] **Step 3** `test_errors.py`: GET `/api/submissions/nope` → 404 body
  `{"error":"not_found","detail":...}`; employee approve → 403 `{"error":"forbidden"}`.
- [ ] **Step 4** `uv run pytest` — all green.

---

## Part 2 — Frontend (TypeScript + TanStack Query)

### Task 7: TS config + deps

**Files:** Create `tsconfig.json`, `tsconfig.node.json`; Modify `package.json`, `vite.config.js`→`.ts`.

- [ ] **Step 1** Add deps: `typescript`, `@types/react`, `@types/react-dom`,
  `@tanstack/react-query`, dev: `vitest`, `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`, `typescript-eslint`, `eslint`.
- [ ] **Step 2** `tsconfig.json` strict (`"strict": true`, `"noUncheckedIndexedAccess": true`,
  `"jsx": "react-jsx"`, `"moduleResolution": "bundler"`, `"types": ["vitest/globals","@testing-library/jest-dom"]`).
- [ ] **Step 3** Scripts: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`,
  `"lint": "eslint src"`. Rename `vite.config.js`→`.ts`, add `test: { environment: 'jsdom', globals: true, setupFiles }`.

### Task 8: Types

**Files:** Create `src/types.ts`.

- [ ] **Step 1** Define all API types (camelCase) per spec §2.1 — `Role`, `User`,
  `ModelOption`, `DetectedSecret`, `RepoScan`, `SecretSlot`, `Status`,
  `ValidationCheck`, `CostProjection`, `Artifact`, `Submission`, `SubmissionDetail`,
  `SubmissionInput`, `ValidationResponse`.

### Task 9: Typed client

**Files:** `src/api/client.ts` (from `api.js`).

- [ ] **Step 1** `request<T>(path, opts): Promise<T>` with Bearer, 401 token-clear,
  error-envelope parse (`{error, detail}` → `Error(detail)`), `auth` token store.
  Export typed `endpoints` object or leave raw calls to queries.ts.

### Task 10: Query/mutation hooks

**Files:** Create `src/api/queries.ts`; Modify `src/main.tsx`.

- [ ] **Step 1** `main.tsx`: wrap `<QueryClientProvider client={qc}>`.
- [ ] **Step 2** `queries.ts`: `queryOptions` for `models`, `submissions`,
  `submission(id, {pollWhileProvisioning})`, `me`, `devUsers`. Mutations: `useScan`,
  `useValidate`, `useCreateSubmission`, `useApprove`, `usePatchSubmission`,
  `useLogin`, `useLogout`. Invalidate `["submissions"]`/`["submission",id]` on writes.
  `submission` query uses `refetchInterval: (q) => q.state.data?.submission.status === "provisioning" ? 800 : false`.

### Task 11: Migrate components to TSX

**Files:** All `src/**/*.jsx` → `.tsx`.

- [ ] **Step 1** Leaf comps: `Icon.tsx` (typed `name`/props), `CodeBlock.tsx`,
  `Misc.tsx` (Steps/BigCheck/Toast), `TweaksPanel.tsx` (Tweak types).
- [ ] **Step 2** `auth/Login.tsx` — uses `useDevUsers`, `useLogin`.
- [ ] **Step 3** `employee/EmployeeFlow.tsx` — `useScan`, `useValidate`,
  `useCreateSubmission`; props typed (`user: User`, `models: ModelOption[]`).
- [ ] **Step 4** `admin/AdminConsole.tsx` — `useSubmissions`, `useSubmission`
  (polling), `useApprove`, `usePatchSubmission`. Remove manual `setInterval`.
- [ ] **Step 5** `App.tsx` — `useMe` on load, login/logout, RBAC gating unchanged.
- [ ] **Step 6** Delete old `.jsx` files; `npm run typecheck` clean.

### Task 12: Frontend tests

**Files:** Create `src/test/setup.ts`, `src/test/highlight.test.ts`,
`src/test/Login.test.tsx`, `src/test/client.test.ts`.

- [ ] **Step 1** `setup.ts`: `import "@testing-library/jest-dom"`.
- [ ] **Step 2** `highlight.test.ts`: json/yaml/bash produce balanced `<span>` (count
  open==close), escapes `<`.
- [ ] **Step 3** `client.test.ts`: mock `fetch` → non-ok throws with detail; 401
  clears token.
- [ ] **Step 4** `Login.test.tsx`: mock `fetch` for `/auth/dev-users`, render, assert
  the 3 identities appear. (Wrap in `QueryClientProvider`.)
- [ ] **Step 5** `npm run test` green; `npm run build` succeeds.

---

## Part 3 — Docker

### Task 13: Backend image

**Files:** `backend/Dockerfile`, `backend/.dockerignore`.

- [ ] **Step 1** `python:3.12-slim`, install uv, `uv sync --no-dev`, non-root user,
  `CMD ["uv","run","uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]`.

### Task 14: Frontend image + compose

**Files:** `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, `docker-compose.yml`.

- [ ] **Step 1** Multi-stage: `node:20-alpine` build → `nginx:alpine` serve `dist`,
  nginx `location /api { proxy_pass http://backend:8000; }`.
- [ ] **Step 2** `docker-compose.yml`: `backend` (8000) + `frontend` (8080:80),
  `LAUNCHPAD_CORS_ORIGINS` env wired.
- [ ] **Step 3** `docker compose config` validates (don't require full build run).

---

## Final Verification

- [ ] `cd backend && uv run pytest` — green.
- [ ] `cd frontend && npm run typecheck` — no errors.
- [ ] `npm run test` — green.
- [ ] `npm run build` — succeeds.
- [ ] **Playwright MCP** e2e: Maya login → scan → details → safety → submit →
  "You're all set!"; Priya login → queue → Artifacts (4 files) → Approve →
  provisioning→live. No console errors beyond favicon. UI matches current screenshots.

---

## Self-Review

- **Spec coverage:** settings ✓(T1) errors ✓(T2) store/DI ✓(T3) routers ✓(T4)
  factory/lifespan ✓(T5) backend tests ✓(T6) TS config ✓(T7) types ✓(T8) client
  ✓(T9) TanStack ✓(T10) component migration ✓(T11) FE tests ✓(T12) Docker ✓(T13-14)
  Playwright ✓(Final). All spec sections mapped.
- **Placeholders:** none — code shown for each non-trivial step.
- **Type consistency:** `StoreProtocol` methods match `SubmissionStore`; query keys
  `["submissions"]`/`["submission",id]` consistent across T10/T11; error `{error,detail}`
  shape consistent T2/T6.
