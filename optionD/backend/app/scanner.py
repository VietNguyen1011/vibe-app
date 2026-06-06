"""Repo scanner — real, read-only inspection via the GitHub API.

We never clone or execute tenant code. We read metadata + a handful of manifest
files over HTTPS (repo info, latest commit, the file tree, and known dependency /
env files) and infer runtime, framework, entrypoint, port, and referenced secrets.

If the network/API is unavailable (offline demo, rate limit, private repo without a
token), we fall back to a believable synthetic result so the slice still runs — the
`RepoScan` interface is identical either way, so nothing downstream changes.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from app.schemas import DetectedSecret, Finding, RepoScan
from app.settings import get_settings

_REPO_RE = re.compile(r"github\.com/([^/]+)/([^/?#]+)", re.IGNORECASE)

# Keys the platform manages centrally (rotated for the tenant) vs. the owner must set.
_PLATFORM_MANAGED = {"ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BEDROCK_API_KEY"}

# Default port by framework so the deploy config is sensible.
_PORTS = {"Streamlit": 8501, "Flask": 5000, "FastAPI": 8000, "Django": 8000, "Gradio": 7860,
          "Express": 3000, "Next.js": 3000, "Vite": 5173, "Static site": 80}


def slugify(s: str | None) -> str:
    """App name -> k8s/ARN-safe id. Used everywhere a name becomes an identifier."""
    s = (s or "app").lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s[:40] or "app"


# ----------------------------------------------------------------- HTTP helpers

def _headers() -> dict[str, str]:
    h = {"User-Agent": "vibeapp-scanner", "Accept": "application/vnd.github+json"}
    token = get_settings().github_token
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _get(url: str, *, raw: bool = False):
    timeout = get_settings().scan_timeout_seconds
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (trusted github host)
        body = r.read()
    return body.decode("utf-8", "replace") if raw else json.loads(body)


# ----------------------------------------------------------------- detection

def _detect(paths: list[str], fetch_text) -> dict:
    """Infer runtime/framework/entrypoint/secrets from the file tree + manifest files.
    `fetch_text(path)` returns the file's text or None."""
    lower = {p.lower(): p for p in paths}
    base = {p.rsplit("/", 1)[-1].lower() for p in paths}

    dockerfile = "dockerfile" in base
    runtime, framework, entrypoint = "unknown", "Unknown", paths[0] if paths else "app"
    secret_keys: list[str] = []

    def has(name: str) -> bool:
        return name in lower or name in base

    # ---- Python ----
    if has("requirements.txt") or has("pyproject.toml") or any(p.endswith(".py") for p in paths):
        runtime = "python"
        deps = ((fetch_text("requirements.txt") or "") + "\n" + (fetch_text("pyproject.toml") or "")).lower()
        for name, key in [("streamlit", "Streamlit"), ("fastapi", "FastAPI"), ("flask", "Flask"),
                          ("django", "Django"), ("gradio", "Gradio")]:
            if name in deps:
                framework = key
                break
        else:
            framework = "Python"
        # Prefer the shallowest match — the real entrypoint sits near the repo root,
        # not in tests/ or examples/.
        for cand in ["streamlit_app.py", "app.py", "main.py", "wsgi.py", "manage.py"]:
            matches = [p for p in paths if p.rsplit("/", 1)[-1].lower() == cand]
            if matches:
                entrypoint = min(matches, key=lambda p: p.count("/"))
                break

    # ---- Node ----
    elif has("package.json"):
        runtime = "node"
        pkg_raw = fetch_text("package.json") or "{}"
        try:
            pkg = json.loads(pkg_raw)
        except json.JSONDecodeError:
            pkg = {}
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        if "next" in deps:
            framework = "Next.js"
        elif "vite" in deps:
            framework = "Vite"
        elif "express" in deps:
            framework = "Express"
        else:
            framework = "Node"
        entrypoint = pkg.get("main") or "index.js"

    # ---- Static site ----
    elif has("index.html"):
        runtime, framework = "static", "Static site"
        entrypoint = next(p for p in paths if p.rsplit("/", 1)[-1].lower() == "index.html")

    # ---- Secrets from env templates ----
    for envf in [".env.example", ".env.sample", ".env.template", ".env.dist"]:
        text = fetch_text(envf)
        if not text:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key = line.split("=", 1)[0].strip().lstrip("export ").strip()
            if re.fullmatch(r"[A-Z0-9_]{2,}", key) and key not in secret_keys:
                secret_keys.append(key)

    return {
        "runtime": runtime,
        "framework": framework,
        "dockerfile": dockerfile,
        "entrypoint": entrypoint,
        "port": _PORTS.get(framework, 8080),
        "secret_keys": secret_keys,
    }


# ----------------------------------------------------------------- public API

def scan_repo(url: str) -> RepoScan:
    m = _REPO_RE.search(url or "")
    if not m:
        return _fallback(url)
    owner, name = m.group(1), re.sub(r"\.git$", "", m.group(2))
    api = f"https://api.github.com/repos/{owner}/{name}"

    try:
        repo = _get(api)
        branch = repo.get("default_branch", "main")
        commit = _get(f"{api}/commits/{branch}").get("sha", "")[:7] or "unknown"
        tree = _get(f"{api}/git/trees/{branch}?recursive=1")
        paths = [n["path"] for n in tree.get("tree", []) if n.get("type") == "blob"]

        raw_base = f"https://raw.githubusercontent.com/{owner}/{name}/{branch}/"
        path_by_base = {p.rsplit("/", 1)[-1].lower(): p for p in paths}

        def fetch_text(filename: str) -> str | None:
            p = path_by_base.get(filename.lower())
            if not p:
                return None
            try:
                return _get(raw_base + p, raw=True)
            except urllib.error.URLError:
                return None

        d = _detect(paths, fetch_text)
        secrets = [
            DetectedSecret(key=k, reason="Referenced in .env template",
                           platform_managed=k in _PLATFORM_MANAGED)
            for k in d["secret_keys"]
        ]
        findings = [
            Finding(level="ok", text=f"Scanned {len(paths)} files at {commit} on {branch}"),
            Finding(level="ok" if d["dockerfile"] else "warn",
                    text="Dockerfile found" if d["dockerfile"] else "No Dockerfile — platform will build a default image"),
        ]
        if not secrets:
            findings.append(Finding(level="ok", text="No secret references detected"))

        return RepoScan(
            url=repo.get("html_url", url), owner=owner, name=name, ref=branch, commit=commit,
            runtime=d["runtime"], framework=d["framework"], dockerfile=d["dockerfile"],
            entrypoint=d["entrypoint"], port=d["port"],
            detected_secrets=secrets, findings=findings,
        )
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, KeyError):
        return _fallback(url, owner=owner, name=name)


def _fallback(url: str, *, owner: str | None = None, name: str | None = None) -> RepoScan:
    """Synthetic result when the API can't be reached. Same interface, flagged honestly."""
    if owner is None or name is None:
        m = _REPO_RE.search(url or "")
        owner = m.group(1) if m else "alice-internal"
        name = re.sub(r"\.git$", "", m.group(2)) if m else "my-app"
    return RepoScan(
        url=url or f"https://github.com/{owner}/{name}",
        owner=owner, name=name, ref="main", commit="unknown",
        runtime="python", framework="Streamlit", dockerfile=True, entrypoint="app.py", port=8080,
        detected_secrets=[
            DetectedSecret(key="ANTHROPIC_API_KEY", reason="example (offline fallback)", platform_managed=True),
        ],
        findings=[Finding(level="warn", text="Could not reach GitHub — showing example data")],
    )


def synthetic_scan(url: str) -> RepoScan:
    """Offline synthetic scan — used for seed data so startup makes no network calls."""
    return _fallback(url)
