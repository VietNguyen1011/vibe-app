"""Real scan_repo path, with the GitHub HTTP layer mocked.

We never hit the network in tests: `_get` is monkeypatched to serve a fake repo
(metadata, commit, tree, and raw files). This exercises scan_repo end to end plus
the `_get`/`_headers` HTTP helpers in isolation."""

import io
import urllib.error

import pytest

import app.scanner as scanner
from app.settings import Settings


def _fake_github(files: dict, tree_paths: list[str], *, branch="main", owner="o", name="r"):
    api = f"https://api.github.com/repos/{owner}/{name}"
    raw_base = f"https://raw.githubusercontent.com/{owner}/{name}/{branch}/"

    def fake_get(url, raw=False):  # noqa: A002 - mirrors real signature
        if url == api:
            return {"default_branch": branch, "html_url": f"https://github.com/{owner}/{name}"}
        if url == f"{api}/commits/{branch}":
            return {"sha": "deadbeefcafe"}
        if url == f"{api}/git/trees/{branch}?recursive=1":
            return {"tree": [{"path": p, "type": "blob"} for p in tree_paths]}
        # raw file fetch
        path = url[len(raw_base):] if url.startswith(raw_base) else None
        if path in files:
            return files[path]
        raise urllib.error.URLError("404")

    return fake_get


def test_scan_static_site(monkeypatch):
    monkeypatch.setattr(scanner, "_get", _fake_github({}, ["index.html", "css/x.css"], owner="mdn", name="site"))
    r = scanner.scan_repo("https://github.com/mdn/site")
    assert r.runtime == "static" and r.framework == "Static site"
    assert r.entrypoint == "index.html" and r.commit == "deadbee"
    assert r.detected_secrets == []
    assert any("No secret references" in f.text for f in r.findings)


def test_scan_python_streamlit_with_secrets(monkeypatch):
    files = {
        "requirements.txt": "streamlit==1.40\nanthropic\n",
        ".env.example": "ANTHROPIC_API_KEY=\nSLACK_WEBHOOK_URL=\n",
    }
    monkeypatch.setattr(scanner, "_get", _fake_github(files, ["app.py", "requirements.txt", "Dockerfile", ".env.example"]))
    r = scanner.scan_repo("https://github.com/o/r")
    assert r.framework == "Streamlit" and r.dockerfile is True
    keys = {s.key for s in r.detected_secrets}
    assert keys == {"ANTHROPIC_API_KEY", "SLACK_WEBHOOK_URL"}
    assert next(s for s in r.detected_secrets if s.key == "ANTHROPIC_API_KEY").platform_managed is True


def test_scan_node_default_main(monkeypatch):
    files = {"package.json": '{"dependencies":{"lodash":"^4"}}'}
    monkeypatch.setattr(scanner, "_get", _fake_github(files, ["package.json", "src/x.js"]))
    r = scanner.scan_repo("https://github.com/o/r")
    assert r.runtime == "node" and r.framework == "Node" and r.entrypoint == "index.js"


def test_scan_tolerates_unfetchable_env_file(monkeypatch):
    # .env.example is in the tree but the raw fetch fails — must not crash.
    monkeypatch.setattr(scanner, "_get", _fake_github({}, ["app.py", "requirements.txt", ".env.example"]))
    r = scanner.scan_repo("https://github.com/o/r")
    assert r.runtime == "python" and r.detected_secrets == []


def test_scan_non_github_url_falls_back():
    r = scanner.scan_repo("https://gitlab.com/o/r")
    assert any("Could not reach GitHub" in f.text for f in r.findings)


def test_scan_network_error_falls_back(monkeypatch):
    def boom(url, raw=False):  # noqa: A002
        raise urllib.error.URLError("down")

    monkeypatch.setattr(scanner, "_get", boom)
    r = scanner.scan_repo("https://github.com/owner/name")
    assert r.owner == "owner" and r.name == "name"
    assert any("Could not reach GitHub" in f.text for f in r.findings)


def test_headers_include_token_when_set(monkeypatch):
    monkeypatch.setattr(scanner, "get_settings", lambda: Settings(github_token="ghp_x"))
    h = scanner._headers()
    assert h["Authorization"] == "Bearer ghp_x"
    assert "User-Agent" in h


def test_headers_no_token(monkeypatch):
    monkeypatch.setattr(scanner, "get_settings", lambda: Settings(github_token=""))
    assert "Authorization" not in scanner._headers()


def test_get_parses_json_and_raw(monkeypatch):
    class FakeResp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(scanner, "_headers", lambda: {})
    monkeypatch.setattr(scanner.urllib.request, "urlopen", lambda req, timeout=0: FakeResp(b'{"a": 1}'))
    assert scanner._get("https://api.github.com/x") == {"a": 1}
    monkeypatch.setattr(scanner.urllib.request, "urlopen", lambda req, timeout=0: FakeResp(b"plain text"))
    assert scanner._get("https://raw/x", raw=True) == "plain text"
