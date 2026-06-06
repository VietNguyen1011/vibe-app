from app.settings import Settings


def test_defaults_are_platform_invariants():
    s = Settings()
    assert s.aws_region == "us-east-1"
    assert s.apps_bucket == "alice-internal-apps"
    assert s.owner_email_domain == "alice.io"


def test_env_overrides_settings(monkeypatch):
    monkeypatch.setenv("VIBEAPP_PROVISION_SECONDS", "0.1")
    monkeypatch.setenv("VIBEAPP_APPS_DOMAIN", "test.local")
    s = Settings()  # fresh instance, not the lru_cache'd get_settings()
    assert s.provision_seconds == 0.1
    assert s.apps_domain == "test.local"
