"""Error responses use a consistent {error, detail} envelope."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _admin():
    token = client.post("/api/auth/login", json={"email": "priya.nair@alice.io"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _employee():
    token = client.post("/api/auth/login", json={"email": "maya.chen@alice.io"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_not_found_envelope():
    r = client.get("/api/submissions/does-not-exist")
    assert r.status_code == 404
    assert r.json() == {"error": "not_found", "detail": "Submission not found"}


def test_unauthorized_envelope():
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


def test_forbidden_envelope():
    # employee attempting an admin-only patch
    r = client.patch("/api/submissions/sub-claims", json={"status": "review"}, headers=_employee())
    assert r.status_code == 403
    assert r.json()["error"] == "forbidden"


def test_conflict_on_double_approve():
    admin = _admin()
    # sub-brief is seeded as 'live' — approving a non-review app conflicts
    r = client.post("/api/submissions/sub-brief/approve", headers=admin)
    assert r.status_code == 409
    assert r.json()["error"] == "conflict"
