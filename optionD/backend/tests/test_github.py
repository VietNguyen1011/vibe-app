"""GitHub App connect flow. Fake client drives the routes; Real client is unit-tested
with a throwaway RSA key + mocked HTTP."""

import io
import json
import urllib.error
import urllib.request

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

import app.github as ghmod
from app.github import Connection, RealGitHubClient
from app.main import app
from app.settings import Settings

client = TestClient(app)


def _auth():
    token = client.post("/api/auth/login", json={"email": "maya.chen@alice.io"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ fake flow (routes)

def test_full_connect_flow_fake():
    h = _auth()
    # not connected initially
    assert client.get("/api/github/status").json()["connected"] is False
    # repos + private scan blocked before connect
    assert client.get("/api/github/repos", headers=h).status_code == 409
    assert client.post("/api/scan", json={"repoFullName": "alice-internal/claims-triage"}).status_code == 409

    # connect → authorizeUrl carries a state
    body = client.get("/api/github/connect", headers=h).json()
    assert "state=" in body["authorizeUrl"]
    state = body["authorizeUrl"].split("state=")[1]

    # callback with bad state → 403
    assert client.get("/api/github/callback", params={"state": "bogus", "installation_id": "42"},
                      follow_redirects=False).status_code == 403

    # callback with good state → redirect + connected
    cb = client.get("/api/github/callback", params={"state": state, "code": "x", "installation_id": "42"},
                    follow_redirects=False)
    assert cb.status_code == 302 and "github=connected" in cb.headers["location"]
    assert client.get("/api/github/status").json() == {"connected": True, "account": "alice-internal"}

    # repos now lists, incl. a private one
    repos = client.get("/api/github/repos", headers=h).json()
    assert any(r["private"] for r in repos)

    # scan a connected (private) repo
    scan = client.post("/api/scan", json={"repoFullName": "alice-internal/claims-triage"}).json()
    assert scan["name"] == "claims-triage"

    # disconnect
    assert client.post("/api/github/disconnect", headers=h).status_code == 204
    assert client.get("/api/github/status").json()["connected"] is False


def test_scan_requires_a_repo_arg():
    assert client.post("/api/scan", json={}).status_code == 422


def test_connect_requires_auth():
    assert client.get("/api/github/connect").status_code == 401


def test_fake_read_repo_marks_public_repo():
    from app.github import FakeGitHubClient
    fc = FakeGitHubClient()
    conn = Connection(installation_id="42", account="alice-internal")
    scan = fc.read_repo(conn, "alice-internal/public-docs")
    assert any("Public repo" in f.text for f in scan.findings)


# ------------------------------------------------------------------ real client (mocked)

@pytest.fixture
def rsa_pem():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _real(monkeypatch, rsa_pem):
    s = Settings(github_app_id="123", github_app_private_key=rsa_pem, github_app_slug="vibeapp")
    monkeypatch.setattr(ghmod, "get_settings", lambda: s)
    return RealGitHubClient()


def test_real_app_jwt_is_rs256(monkeypatch, rsa_pem):
    rc = _real(monkeypatch, rsa_pem)
    token = rc._app_jwt()
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["iss"] == "123"


def test_real_authorize_url(monkeypatch, rsa_pem):
    rc = _real(monkeypatch, rsa_pem)
    assert rc.authorize_url("st8") == "https://github.com/apps/vibeapp/installations/new?state=st8"


def _fake_urlopen(routes):
    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def opener(req, timeout=0):
        url = req.full_url
        body = routes(url, req)
        return Resp(body if isinstance(body, bytes) else json.dumps(body).encode())

    return opener


def test_real_exchange_list_and_read(monkeypatch, rsa_pem):
    rc = _real(monkeypatch, rsa_pem)

    def routes(url, req):
        if url.endswith("/access_tokens"):
            return {"token": "ghs_inst"}
        if "/app/installations/42" in url:
            return {"account": {"login": "acme"}}
        if url.endswith("/installation/repositories"):
            return {"repositories": [{"full_name": "acme/secret", "private": True, "default_branch": "main"}]}
        if url.endswith("/repos/acme/secret"):
            return {"default_branch": "main", "private": True, "html_url": "https://github.com/acme/secret"}
        if "/commits/main" in url:
            return {"sha": "abcdef0"}
        if "trees" in url:
            return {"tree": [{"path": "app.py", "type": "blob"}, {"path": "requirements.txt", "type": "blob"}]}
        if "raw.githubusercontent.com" in url:
            return b"streamlit\n"
        return {}

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen(routes))

    conn = rc.exchange("code", "42")
    assert conn.account == "acme" and conn.installation_id == "42"
    repos = rc.list_repos(conn)
    assert repos[0].full_name == "acme/secret" and repos[0].private is True
    scan = rc.read_repo(conn, "acme/secret")
    assert scan.framework == "Streamlit" and scan.commit == "abcdef0"
    assert any("Private repo" in f.text for f in scan.findings)


def test_real_read_repo_tolerates_unfetchable_file(monkeypatch, rsa_pem):
    rc = _real(monkeypatch, rsa_pem)

    def routes(url, req):
        if url.endswith("/access_tokens"):
            return {"token": "t"}
        if url.endswith("/repos/acme/x"):
            return {"default_branch": "main", "private": False, "html_url": "h"}
        if "/commits/main" in url:
            return {"sha": "0000000"}
        if "trees" in url:
            return {"tree": [{"path": "index.html", "type": "blob"}, {"path": ".env.example", "type": "blob"}]}
        if "raw" in url:
            raise urllib.error.URLError("no raw")
        return {}

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen(routes))
    scan = rc.read_repo(Connection(installation_id="9", account="acme"), "acme/x")
    assert scan.runtime == "static"


def test_get_github_client_picks_real_when_configured(monkeypatch, rsa_pem):
    s = Settings(github_app_id="1", github_app_private_key=rsa_pem)
    monkeypatch.setattr(ghmod, "get_settings", lambda: s)
    ghmod.get_github_client.cache_clear()
    assert isinstance(ghmod.get_github_client(), RealGitHubClient)
    ghmod.get_github_client.cache_clear()  # reset for other tests
