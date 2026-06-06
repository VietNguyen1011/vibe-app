# GitHub App Connect Flow — Implementation Plan

> Implement task-by-task. Repo isn't using commits per user policy — verify each task
> with tests instead of committing.

**Goal:** Replace paste-public-URL with a GitHub App authorize flow that pulls private
repos, behind a mockable `GitHubClient` seam (fake in dev, real creds in prod).

**Architecture:** New `app/github.py` (Protocol + Fake/Real clients + CSRF state) and
`app/routers/github.py` (status/connect/callback/repos/disconnect). Connection held in
the store. Scan endpoint gains a `repoFullName` path that reads via installation token.
Frontend Connect step becomes "Connect GitHub" → repo picker → scan.

**Tech Stack:** FastAPI, PyJWT (RS256 for the App JWT), React/TS, TanStack Query.

---

## File structure
- `backend/app/settings.py` (modify) — github_app_* fields.
- `backend/app/github.py` (new) — RepoRef, Connection, GitHubClient Protocol,
  FakeGitHubClient, RealGitHubClient, get_github_client, CSRF state helpers.
- `backend/app/store.py` (modify) — hold `connection` + `csrf_states`.
- `backend/app/routers/github.py` (new) — routes.
- `backend/app/routers/catalog.py` (modify) — scan accepts repoFullName.
- `backend/app/main.py` (modify) — include github router.
- `backend/tests/test_github.py` (new).
- `frontend/src/types.ts` (modify) — RepoRef, GithubStatus; ScanArg.
- `frontend/src/api/queries.ts` (modify) — github hooks; useScan by url|fullName.
- `frontend/src/employee/EmployeeFlow.tsx` (modify) — Connect GitHub + picker + fallback.
- `frontend/src/App.tsx` (modify) — consume `?github=connected`.
- `frontend/src/test/github.test.tsx` (new).

---

### Task 1: Settings
Add to `Settings`: `github_app_id=""`, `github_app_private_key=""`, `github_client_id=""`,
`github_client_secret=""`, `github_app_slug="vibeapp"`,
`github_callback_url="http://localhost:8000/api/github/callback"`. Add `pyjwt[crypto]>=2.9`
to deps. `uv sync`.

### Task 2: github.py — types + Fake + Real + factory
- Pydantic `RepoRef{fullName,private,defaultBranch}`, `Connection{installationId,account,connected}`,
  `GithubStatus{connected,account|None}`.
- `GitHubClient` Protocol: `authorize_url(state)`, `exchange(code, installation_id)`,
  `list_repos(conn)`, `read_repo(conn, full_name)`.
- `FakeGitHubClient`: `authorize_url` → `{callback}?code=fake&installation_id=42&state={state}`;
  `exchange` → `Connection("42","alice-internal")`; `list_repos` → 3 refs incl one private;
  `read_repo` → `synthetic_scan` adjusted with the chosen name (+private finding).
- `RealGitHubClient`: `_app_jwt()` (PyJWT RS256, iss=app_id, 10-min exp); `_install_token(id)`
  POST `/app/installations/{id}/access_tokens`; `list_repos` GET `/installation/repositories`;
  `read_repo` reuse `scanner` tree+contents with token header. Reuse `scanner._detect`.
- `get_github_client()` `@lru_cache` → Real if `github_app_id` and key set, else Fake.
- CSRF: `new_state()`/`pop_state(state)->bool` backed by a module set (or store).

### Task 3: store — connection + csrf
Add to `SubmissionStore`: `self.connection: Connection|None=None`, `self.csrf: set[str]`.
Methods: `set_connection`, `get_connection`, `clear_connection`, `add_state`, `take_state`.
Extend `StoreProtocol` accordingly.

### Task 4: routers/github.py
- `GET /api/github/status` → GithubStatus from store.
- `GET /api/github/connect` → `{authorizeUrl}`; `state=new`, store.add_state(state),
  `client.authorize_url(state)`.
- `GET /api/github/callback` (Request) → read code/installation_id/state; if not
  store.take_state(state) → ForbiddenError; `conn=client.exchange(...)`;
  store.set_connection(conn); return `RedirectResponse("/?github=connected", 302)`.
- `GET /api/github/repos` → if no connection ConflictError; `client.list_repos(conn)`.
- `POST /api/github/disconnect` → store.clear_connection(); 204.

### Task 5: scan accepts repoFullName
`catalog.py`: `ScanRequest{repoUrl: str|None=None, repoFullName: str|None=None}`.
Route: if repoFullName → require connection (ConflictError else) → `client.read_repo`;
elif repoUrl → `scan_repo`; else 422.

### Task 6: register router + main
`create_app` include `github.router`.

### Task 7: backend tests (100%)
`test_github.py`: connect returns authorizeUrl+sets state; callback bad state→403;
callback good state→302 + status connected; repos before connect→409, after→list w/ private;
scan by repoFullName before connect→409, after→RepoScan; disconnect→204 then status
disconnected; Fake read_repo shape; Real `_app_jwt` signs with a throwaway RSA key
(decode header alg==RS256). Keep coverage 100% (mock real HTTP).

### Task 8: frontend types + queries
`types.ts`: `RepoRef{fullName,private,defaultBranch}`, `GithubStatus{connected,account}`.
`queries.ts`: `githubStatusQuery`, `githubReposQuery`, `useDisconnectGithub`,
`useGithubConnect` (GET connect → returns authorizeUrl). `useScan` mutate arg becomes
`{repoUrl?:string; repoFullName?:string}`.

### Task 9: StepConnect — Connect GitHub + picker + fallback
- Primary: **Connect GitHub** button → `connect()` → `window.location.href=authorizeUrl`.
- If status.connected: account chip + Disconnect + repo list (RepoRef) with 🔒 on private;
  click → `onPick(fullName)` → parent scans by fullName.
- Collapsible "or paste a public URL instead" reveals existing input (scan by url).

### Task 10: App — consume ?github=connected
On mount, if `location.search` has `github=connected`, invalidate `["github","status"]`
and strip the param (history.replaceState). Employee view shows connected state.

### Task 11: frontend tests
`github.test.tsx`: StepConnect connected=false shows Connect button (calls connect);
connected=true renders repos incl private badge; clicking a repo calls scan→Details;
fallback paste still scans. Keep FE ~99%.

### Task 12: verify + Playwright
`uv run pytest --cov` 100%; `npm run typecheck && npm run coverage`; `npm run build`.
Playwright MCP: Connect GitHub (fake) → connected → pick private repo → Details → submit.

---

## Self-review
- Spec coverage: settings(T1) client/seam(T2) store(T3) routes(T4) scan(T5) wiring(T6)
  BE tests(T7) FE types/queries(T8) StepConnect(T9) callback-consume(T10) FE tests(T11)
  verify+Playwright(T12). All spec parts mapped.
- Types consistent: `RepoRef.fullName`, `Connection.installationId`, `GithubStatus.connected`
  used identically across BE/FE.
- No placeholders.
