# Spec — Launchpad prod-hardening + TypeScript migration

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation
**Scope decision:** Pragmatic prod-shaped (not "full prod"). React server-state via TanStack Query.

## Goal

Take the working Launchpad Option D slice (FastAPI + React JSX) and raise it to
production-shaped best practices **without changing behavior or the verified UI**:

- Migrate the entire React frontend to TypeScript (strict).
- Restructure the FastAPI backend to current best practices (settings, routers,
  app factory, lifespan, centralized exceptions, DI-injected store).
- Adopt TanStack Query for server-state on the frontend.
- Add Docker artifacts and a light frontend test layer (Vitest + RTL).

**Non-goal / explicitly out of scope** (listed in README "next steps"): CI workflow,
rate-limiting, structured JSON logging, Zustand, OpenAPI client codegen, real DB,
real OIDC. These are deliberately excluded — the assignment scores judgment over
volume; over-building a take-home is a negative signal.

**Invariant:** the employee wizard, admin console, login, theming, and accessibility
behavior must look and work exactly as they do now. This is a refactor, verified by
the same end-to-end flows.

---

## Part 1 — Backend (FastAPI)

### 1.1 Settings via pydantic-settings
- Add `pydantic-settings` dependency.
- New `app/settings.py`: `Settings(BaseSettings)` with env override and current
  `config.py` values as defaults: `aws_account`, `aws_region`, `apps_bucket`,
  `obs_mcp_endpoint`, `apps_domain`, `owner_email_domain`,
  `human_in_loop_budget_usd`, `platform_secret_rotation_days`, `provision_seconds`,
  `cors_origins` (list). Env prefix `LAUNCHPAD_`.
- `get_settings()` `@lru_cache` accessor. `config.py` retained as a thin re-export
  of the default Settings instance so existing imports (`artifacts.py`, etc.) keep
  working with minimal churn — or migrate imports to `get_settings()`. Decision:
  keep module-level constants sourced from `Settings()` defaults so pure functions
  (`artifacts`, `manifest`, `validation`) stay import-driven and unit-testable
  without a request; settings env-override affects app wiring (CORS, provision delay).

### 1.2 App factory + lifespan
- `create_app() -> FastAPI` builds the app: middleware (CORS from settings),
  exception handlers, routers.
- `lifespan` async context manager: on startup, construct the `SubmissionStore`
  (seeded) and attach to `app.state`; clean teardown.
- `app/main.py` exposes `app = create_app()` for uvicorn.

### 1.3 Routers (domain split)
- `app/routers/auth.py` — `/api/auth/*` (dev-users, login, me, logout).
- `app/routers/catalog.py` — `/api/models`, `/api/scan`, `/api/validate`.
- `app/routers/submissions.py` — `/api/submissions*`, approve, patch.
- `app/routers/health.py` — `/api/health`.
- Each uses `APIRouter`; `create_app` includes them.

### 1.4 Centralized exceptions
- `app/errors.py`: `LaunchpadError` base + `NotFoundError`, `ForbiddenError`,
  `ConflictError`, `ValidationGateError`, `UnauthorizedError`, each with status +
  message.
- Exception handlers registered in `create_app` → consistent JSON
  `{"error": "<type>", "detail": "<message>"}`.
- Replace inline `HTTPException(...)` in routes/auth with these.

### 1.5 Store via dependency + Protocol
- `app/store.py`: define `StoreProtocol` (list/get/add/patch). `SubmissionStore`
  implements it (in-memory, current logic).
- Routes depend on `get_store(request) -> StoreProtocol` reading `app.state.store`.
- Swapping for a DB later = new implementation, routes unchanged.

### 1.6 Tests
- Keep all 25 pytest; adapt imports to router/settings structure.
- Add: settings env-override test; exception-handler shape test (404/403 return the
  `{error, detail}` envelope).

---

## Part 2 — Frontend (TypeScript + TanStack Query)

### 2.1 TypeScript
- `tsconfig.json` (strict, `noUncheckedIndexedAccess`, bundler resolution) +
  `tsconfig.node.json`. Add `typescript`, `@types/react`, `@types/react-dom`.
- Rename all `.jsx` → `.tsx` (and `api.js` → `api/client.ts`).
- `src/types.ts`: types mirroring backend camelCase responses — `Role`, `User`,
  `ModelOption`, `DetectedSecret`, `RepoScan`, `SecretSlot`, `Status`,
  `ValidationCheck`, `CostProjection`, `Artifact`, `Submission`, `SubmissionDetail`,
  `SubmissionInput`.
- `tsc --noEmit` is the type gate (npm script `typecheck`). Minimal eslint flat
  config (`typescript-eslint` recommended).

### 2.2 TanStack Query
- Add `@tanstack/react-query`. `QueryClientProvider` in `main.tsx`.
- `src/api/client.ts`: typed `request<T>()` wrapper (Bearer header, 401 clears
  token, error envelope parsing) + token store.
- `src/api/queries.ts`: typed `queryOptions` + hooks:
  - Queries: `useModels`, `useSubmissions`, `useSubmission(id)`, `useMe`,
    `useDevUsers`.
  - Mutations: `useScan`, `useValidate`, `useCreateSubmission`, `useApprove`,
    `usePatchSubmission`, `useLogin`, `useLogout`.
  - Invalidate `submissions` / `submission` on create/approve/patch.
- **Admin polling**: `useSubmission(id, { refetchInterval })` — poll while status is
  `provisioning`, stop when `live`. Removes the manual `setInterval` in
  `AdminConsole`.

### 2.3 Components (behavior unchanged)
- All components ported to `.tsx` with prop types/interfaces.
- `EmployeeFlow` keeps the validate-preview via `useValidate` mutation (or a query
  keyed on inputs); cost preview unchanged.
- `AdminConsole` uses query hooks; approve/patch via mutations.
- Theming, Tweaks, a11y, design tokens: **unchanged** (`theme.css` stays).

### 2.4 Frontend tests (Vitest + RTL, light)
- Add `vitest`, `@testing-library/react`, `jsdom`, `@testing-library/jest-dom`.
- Tests: `highlight()` unit (json/yaml/bash well-formed), `Login` renders dev-users
  (mocked `fetch`), `client` error path (throws on non-ok, clears token on 401).
- npm script `test`.

### 2.5 Env
- `VITE_API_BASE` optional (default `/api`); keep vite dev proxy with
  `LAUNCHPAD_API` override.

---

## Part 3 — Docker

- `backend/Dockerfile`: `python:3.12-slim`, install uv, `uv sync --no-dev`, non-root
  user, `uvicorn app.main:app`.
- `frontend/Dockerfile`: multi-stage — node build → `nginx:alpine` serving
  `dist/`, with an nginx conf proxying `/api` to backend.
- `docker-compose.yml` (root): `backend` (8000) + `frontend` (8080→nginx), env wired.
- `.dockerignore` for each.

---

## Verification (definition of done)

1. `cd backend && uv run pytest` — all green (≥25 + new).
2. `cd frontend && npm run typecheck` — no errors.
3. `npm run test` (vitest) — green.
4. `npm run build` — succeeds.
5. **Playwright MCP** end-to-end against running stack: login as Maya → scan →
   details → safety → submit → "You're all set!"; login as Priya → queue → Artifacts
   tab shows 4 files → Approve → `provisioning → live`. Confirm UI matches the
   current verified screenshots and no console errors (besides favicon).

---

## Migration strategy

Incremental, behavior-preserving:
1. Backend restructure first (settings → errors → store Protocol → routers → factory),
   keep tests green at each step.
2. Frontend: add TS config + types, then migrate leaf components → containers, then
   swap data layer to TanStack Query, then add tests.
3. Docker last.
4. Full verification incl. Playwright.
