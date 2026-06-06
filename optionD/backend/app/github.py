"""GitHub App connect flow — the integration seam.

The app depends on `GitHubClient`, never on GitHub directly. In dev (no credentials)
`FakeGitHubClient` simulates the authorize→install→read loop entirely offline, so the
whole flow runs and tests without a registered app. Set the `github_app_*` settings to
swap in `RealGitHubClient` (mints a GitHub App JWT, exchanges for an installation token,
reads private repo contents) — no caller changes.

Installation tokens are minted on demand and never persisted or logged.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from functools import lru_cache
from typing import Protocol

from app.scanner import _detect, synthetic_scan
from app.schemas import CamelModel, Finding, RepoScan
from app.settings import get_settings


class RepoRef(CamelModel):
    full_name: str
    private: bool
    default_branch: str


class Connection(CamelModel):
    installation_id: str
    account: str
    connected: bool = True


class GithubStatus(CamelModel):
    connected: bool
    account: str | None = None


class GitHubClient(Protocol):
    def authorize_url(self, state: str) -> str: ...
    def exchange(self, code: str, installation_id: str) -> Connection: ...
    def list_repos(self, conn: Connection) -> list[RepoRef]: ...
    def read_repo(self, conn: Connection, full_name: str) -> RepoScan: ...


# ----------------------------------------------------------------- Fake (dev default)

class FakeGitHubClient:
    """Offline simulation. authorize_url points straight back at our own callback so the
    redirect loop completes without a real GitHub round-trip."""

    _REPOS = [
        RepoRef(full_name="alice-internal/claims-triage", private=True, default_branch="main"),
        RepoRef(full_name="alice-internal/morning-brief", private=True, default_branch="main"),
        RepoRef(full_name="alice-internal/public-docs", private=False, default_branch="main"),
    ]

    def authorize_url(self, state: str) -> str:
        cb = get_settings().github_callback_url
        return f"{cb}?code=fake-code&installation_id=42&state={state}"

    def exchange(self, code: str, installation_id: str) -> Connection:
        return Connection(installation_id=installation_id or "42", account="alice-internal")

    def list_repos(self, conn: Connection) -> list[RepoRef]:
        return list(self._REPOS)

    def read_repo(self, conn: Connection, full_name: str) -> RepoScan:
        scan = synthetic_scan(f"https://github.com/{full_name}")
        private = next((r.private for r in self._REPOS if r.full_name == full_name), True)
        scan.findings = [
            Finding(level="ok", text=f"Read via GitHub App installation {conn.installation_id}"),
            Finding(level="ok" if private else "warn", text="Private repo" if private else "Public repo"),
        ]
        return scan


# ----------------------------------------------------------------- Real (opt-in)

class RealGitHubClient:
    """Talks to real GitHub via a registered App. Used when credentials are configured."""

    _API = "https://api.github.com"

    def _app_jwt(self) -> str:
        import jwt  # local import: only needed in real mode

        s = get_settings()
        now = int(time.time())
        payload = {"iat": now - 30, "exp": now + 540, "iss": s.github_app_id}
        return jwt.encode(payload, s.github_app_private_key, algorithm="RS256")

    def _get(self, url: str, token: str, *, raw: bool = False):
        import json

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "vibeapp",
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
            },
        )
        with urllib.request.urlopen(req, timeout=get_settings().scan_timeout_seconds) as r:  # noqa: S310
            body = r.read()
        return body.decode("utf-8", "replace") if raw else json.loads(body)

    def _install_token(self, installation_id: str) -> str:
        import json

        url = f"{self._API}/app/installations/{installation_id}/access_tokens"
        req = urllib.request.Request(
            url, method="POST",
            headers={
                "User-Agent": "vibeapp",
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self._app_jwt()}",
            },
        )
        with urllib.request.urlopen(req, timeout=get_settings().scan_timeout_seconds) as r:  # noqa: S310
            return json.loads(r.read())["token"]

    def authorize_url(self, state: str) -> str:
        s = get_settings()
        return f"https://github.com/apps/{s.github_app_slug}/installations/new?state={state}"

    def exchange(self, code: str, installation_id: str) -> Connection:
        token = self._install_token(installation_id)
        inst = self._get(f"{self._API}/app/installations/{installation_id}", self._app_jwt())
        account = inst.get("account", {}).get("login", "unknown")
        # token is used immediately for nothing here; minted again per read.
        del token
        return Connection(installation_id=installation_id, account=account)

    def list_repos(self, conn: Connection) -> list[RepoRef]:
        token = self._install_token(conn.installation_id)
        data = self._get(f"{self._API}/installation/repositories", token)
        return [
            RepoRef(full_name=r["full_name"], private=r["private"], default_branch=r.get("default_branch", "main"))
            for r in data.get("repositories", [])
        ]

    def read_repo(self, conn: Connection, full_name: str) -> RepoScan:
        token = self._install_token(conn.installation_id)
        owner, name = full_name.split("/", 1)
        api = f"{self._API}/repos/{owner}/{name}"
        repo = self._get(api, token)
        branch = repo.get("default_branch", "main")
        commit = self._get(f"{api}/commits/{branch}", token).get("sha", "")[:7] or "unknown"
        tree = self._get(f"{api}/git/trees/{branch}?recursive=1", token)
        paths = [n["path"] for n in tree.get("tree", []) if n.get("type") == "blob"]
        by_base = {p.rsplit("/", 1)[-1].lower(): p for p in paths}

        def fetch_text(filename: str) -> str | None:
            p = by_base.get(filename.lower())
            if not p:
                return None
            try:
                return self._get(f"https://raw.githubusercontent.com/{owner}/{name}/{branch}/{p}", token, raw=True)
            except urllib.error.URLError:
                return None

        d = _detect(paths, fetch_text)
        from app.schemas import DetectedSecret

        return RepoScan(
            url=repo.get("html_url", f"https://github.com/{full_name}"),
            owner=owner, name=name, ref=branch, commit=commit,
            runtime=d["runtime"], framework=d["framework"], dockerfile=d["dockerfile"],
            entrypoint=d["entrypoint"], port=d["port"],
            detected_secrets=[DetectedSecret(key=k, reason="Referenced in .env template", platform_managed=False) for k in d["secret_keys"]],
            findings=[
                Finding(level="ok", text=f"Read {len(paths)} files at {commit} (installation {conn.installation_id})"),
                Finding(level="ok" if repo.get("private") else "warn", text="Private repo" if repo.get("private") else "Public repo"),
            ],
        )


@lru_cache
def get_github_client() -> GitHubClient:
    s = get_settings()
    if s.github_app_id and s.github_app_private_key:
        return RealGitHubClient()
    return FakeGitHubClient()
