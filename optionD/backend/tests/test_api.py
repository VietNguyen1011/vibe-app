import time

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def auth(email="maya.chen@alice.io"):
    token = client.post("/api/auth/login", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


EMPLOYEE = auth("maya.chen@alice.io")
ADMIN = auth("priya.nair@alice.io")


# A static repo payload so tests never hit the network (the scanner is exercised
# separately in test_scanner.py).
_REPO = {
    "url": "https://github.com/alice-internal/demo",
    "owner": "alice-internal",
    "name": "demo",
    "ref": "main",
    "commit": "abc1234",
    "runtime": "python",
    "framework": "Streamlit",
    "dockerfile": True,
    "entrypoint": "app.py",
    "port": 8080,
    "detectedSecrets": [{"key": "ANTHROPIC_API_KEY", "reason": "x", "platformManaged": True}],
    "findings": [{"level": "ok", "text": "ok"}],
}


def _input(**over):
    base = {
        "repoUrl": "github.com/alice-internal/demo",
        "repo": _REPO,
        "appName": "Demo App",
        "description": "A demo",
        "ownerEmail": "maya.chen@alice.io",
        "team": "research",
        "modelId": "sonnet",
        "budget": 200,
        "secrets": [{"key": s["key"], "platformManaged": s["platformManaged"]} for s in _REPO["detectedSecrets"]],
    }
    base.update(over)
    return base


def test_models_endpoint_returns_allowlist():
    r = client.get("/api/models")
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()}
    assert {"sonnet", "haiku", "opus"} <= ids


def test_validate_does_not_persist():
    before = len(client.get("/api/submissions").json())
    r = client.post("/api/validate", json=_input(), headers=EMPLOYEE)
    assert r.status_code == 200
    assert "validation" in r.json() and "cost" in r.json()
    after = len(client.get("/api/submissions").json())
    assert before == after


def test_create_submission_returns_artifacts_and_appears_in_queue():
    r = client.post("/api/submissions", json=_input(appName="Queue Test"), headers=EMPLOYEE)
    assert r.status_code == 201
    detail = r.json()
    assert len(detail["artifacts"]) == 5
    sid = detail["submission"]["id"]
    queue = client.get("/api/submissions").json()
    assert any(s["id"] == sid for s in queue)
    assert queue[0]["id"] == sid  # newest first


def test_owner_is_taken_from_session_not_body():
    # Body claims a different owner; the authenticated identity must win.
    r = client.post("/api/submissions", json=_input(ownerEmail="someone.else@alice.io"), headers=EMPLOYEE)
    assert r.json()["submission"]["ownerEmail"] == "maya.chen@alice.io"


def test_approve_lifecycle_review_to_live():
    sid = client.post("/api/submissions", json=_input(appName="Lifecycle"), headers=EMPLOYEE).json()["submission"]["id"]
    r = client.post(f"/api/submissions/{sid}/approve", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["status"] == "provisioning"
    deadline = time.time() + 6
    status = "provisioning"
    while time.time() < deadline:
        status = client.get(f"/api/submissions/{sid}").json()["submission"]["status"]
        if status == "live":
            break
        time.sleep(0.3)
    assert status == "live"


def test_cannot_approve_invalid_submission():
    sid = client.post("/api/submissions", json=_input(appName="Bad", budget=0), headers=EMPLOYEE).json()["submission"]["id"]
    r = client.post(f"/api/submissions/{sid}/approve", headers=ADMIN)
    assert r.status_code == 422


def test_404_on_missing_submission():
    assert client.get("/api/submissions/nope").status_code == 404


# ----------------------------------------------------------------------- auth gates


def test_create_requires_auth():
    assert client.post("/api/submissions", json=_input()).status_code == 401


def test_employee_cannot_approve():
    sid = client.post("/api/submissions", json=_input(appName="RBAC"), headers=EMPLOYEE).json()["submission"]["id"]
    r = client.post(f"/api/submissions/{sid}/approve", headers=EMPLOYEE)
    assert r.status_code == 403


def test_login_unknown_identity_rejected():
    assert client.post("/api/auth/login", json={"email": "hacker@evil.com"}).status_code == 401


def test_me_reflects_logged_in_user():
    r = client.get("/api/auth/me", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_logout_clears_session():
    token = client.post("/api/auth/login", json={"email": "devon.park@alice.io"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401  # session gone


def test_malformed_authorization_header_is_unauthorized():
    assert client.get("/api/auth/me", headers={"Authorization": "Basic xyz"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "garbage"}).status_code == 401


def test_scan_endpoint(monkeypatch):
    import app.scanner as scanner

    monkeypatch.setattr(
        scanner, "_get",
        lambda url, raw=False: (
            {"default_branch": "main", "html_url": "https://github.com/o/r"} if url.endswith("/repos/o/r")
            else {"sha": "abc1234"} if url.endswith("/commits/main")
            else {"tree": [{"path": "index.html", "type": "blob"}]} if "trees" in url
            else (_ for _ in ()).throw(__import__("urllib").error.URLError("x"))
        ),
    )
    r = client.post("/api/scan", json={"repoUrl": "https://github.com/o/r"})
    assert r.status_code == 200 and r.json()["framework"] == "Static site"


def test_admin_patch_success():
    sid = client.post("/api/submissions", json=_input(appName="Patch Me"), headers=EMPLOYEE).json()["submission"]["id"]
    r = client.patch(f"/api/submissions/{sid}", json={"status": "review"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["status"] == "review"


def test_patch_missing_submission_404():
    assert client.patch("/api/submissions/nope", json={"status": "review"}, headers=ADMIN).status_code == 404


def test_approve_missing_submission_404():
    assert client.post("/api/submissions/nope/approve", headers=ADMIN).status_code == 404


def test_lifespan_startup_shutdown():
    # Entering the context runs the lifespan (startup → yield → shutdown).
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200


def test_dev_users_endpoint():
    r = client.get("/api/auth/dev-users")
    assert r.status_code == 200
    emails = {u["email"] for u in r.json()}
    assert "priya.nair@alice.io" in emails


def test_finish_provisioning_transitions_to_live():
    from app.routers.submissions import _finish_provisioning
    from app.store import SubmissionStore
    from app.schemas import Status

    store = SubmissionStore()
    sid = store.list()[0].id
    store.patch(sid, status=Status.provisioning)
    _finish_provisioning(store, sid)
    after = store.get(sid)
    assert after.status == Status.live and after.live_url.endswith(".apps.internal")
    # no-op when not in provisioning
    _finish_provisioning(store, sid)
    assert store.get(sid).status == Status.live
    # no-op for missing id
    _finish_provisioning(store, "missing")
