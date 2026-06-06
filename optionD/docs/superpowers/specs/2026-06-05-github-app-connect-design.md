# Spec — GitHub App connect flow

**Date:** 2026-06-05
**Status:** Approved (design)
**Decisions:** Mockable boundary (GitHub HTTP behind an interface; fake provider in dev,
real creds via env in prod). Single shared connection (not per-user) for the demo.

## Goal

Replace the "paste a public URL" connect step with a **GitHub App authorize flow**:
the user clicks *Connect GitHub*, authorizes the app, picks a repo (including private),
and the platform scans it using an **installation access token**. Runs offline in dev
via a fake provider; swapping in real GitHub credentials needs no code change.

Keep the existing public-URL scan as a secondary fallback.

## Non-goals

Per-user installations, webhooks, multi-org governance, long-lived token storage,
real GitHub registration as a run prerequisite. (Real mode is wired but optional.)

## Part 1 — Backend: the `GitHubClient` seam

New `app/github.py`:

```
class RepoRef(CamelModel):      # for the picker
    full_name: str; private: bool; default_branch: str

class Connection(CamelModel):
    installation_id: str; account: str; connected: bool = True

class GitHubClient(Protocol):
    def authorize_url(self, state: str) -> str: ...
    def exchange(self, code: str, installation_id: str) -> Connection: ...
    def list_repos(self, conn: Connection) -> list[RepoRef]: ...
    def read_repo(self, conn: Connection, full_name: str) -> RepoScan: ...
```

- **FakeGitHubClient** (dev default): `authorize_url` returns the backend callback URL
  itself with a fake `code`+`installation_id` (so the redirect loop completes offline);
  `exchange` returns a Connection for account `alice-internal`; `list_repos` returns a
  canned set incl. one `private: true` repo; `read_repo` returns a believable `RepoScan`
  (reuses the synthetic builder / `_detect` over canned files).
- **RealGitHubClient** (when `github_app_id` + private key + client secret set): mints a
  GitHub App JWT (RS256 over the private key), exchanges for an installation token,
  lists `/installation/repositories`, reads contents — reuses `scanner._detect`.
- **`get_github_client()`** picks Real if configured else Fake (cached).

Connection state held in the store (single `Connection | None`), exposed via
`deps.get_store`. Installation tokens are minted on demand, never persisted/logged.

## Part 2 — Backend: routes `app/routers/github.py`

- `GET /api/github/status` → `{connected: bool, account: str | None}`
- `GET /api/github/connect` → `{authorizeUrl}`; generates + stores a CSRF `state`.
- `GET /api/github/callback?code&installation_id&state` → validate `state`, `exchange`,
  store connection, **redirect** (302) to `/?github=connected`.
- `GET /api/github/repos` → `list[RepoRef]`; raises `ConflictError` if not connected.
- `POST /api/github/disconnect` → clears connection, 204.
- Extend scan: `POST /api/scan` accepts `{repoFullName}` (read via `read_repo` when
  connected) **or** `{repoUrl}` (existing public path). Exactly one provided.

CSRF: `state` is a random token stored server-side (set), removed on callback; a
missing/unknown state → `ForbiddenError`.

## Part 3 — Frontend

- **StepConnect** primary action becomes **Connect GitHub** (`useGithubConnect` →
  `window.location = authorizeUrl`). A small "or paste a public URL instead" toggle
  reveals the existing input.
- On load, read `?github=connected` / `useGithubStatus`; when connected show the
  account chip + **repo picker** (`useGithubRepos`) with a 🔒 badge on private repos.
  Selecting a repo runs the scan by `repoFullName` → existing Details step.
- `Disconnect` clears it.
- `api/queries.ts`: `githubStatusQuery`, `githubReposQuery`, `useGithubConnect`,
  `useDisconnectGithub`; `useScan` accepts `{repoUrl}` or `{repoFullName}`.
- New types: `RepoRef`, `GithubStatus`.

## Part 4 — Config / settings

Add to `Settings`: `github_app_id`, `github_app_private_key`, `github_client_id`,
`github_client_secret`, `github_app_slug`, `github_callback_url`
(default `http://localhost:8000/api/github/callback`). All empty → Fake mode.

## Part 5 — Testing (keep BE 100% / FE ~99%)

- Backend: full flow with FakeGitHubClient — connect (returns authorizeUrl + sets
  state), callback (valid state → connected + redirect; bad state → 403), status,
  repos (incl. not-connected 409), scan by `repoFullName`, disconnect. RealGitHubClient
  JWT minting tested with a throwaway RSA key (sign succeeds, header shape). Mock all
  network.
- Frontend: Connect button calls connect; repo picker renders private badge; selecting
  a repo triggers scan→Details; fallback paste path still works.
- Playwright MCP: drive Connect GitHub (fake) → connected → pick a private repo → scan
  → Details → submit, end to end.

## Migration / structure

`scanner.py` stays (public path + `_detect` reused by both clients). `github.py` is a
new bounded module; routes thin; one new router registered in `create_app`. No change
to artifacts/manifest/validation/lifecycle.
