import pytest
from guardrails.allowlist import ModelAllowlist, ModelNotAllowedError


@pytest.fixture
def allowlist():
    return ModelAllowlist()


def test_allowed_model_passes(allowlist):
    allowlist.check("claude-3-5-haiku-20241022", ["claude-3-5-haiku-20241022"])


def test_disallowed_model_blocked(allowlist):
    with pytest.raises(ModelNotAllowedError) as exc_info:
        allowlist.check("claude-3-5-sonnet-20241022", ["claude-3-5-haiku-20241022"])
    assert exc_info.value.model == "claude-3-5-sonnet-20241022"
    assert "claude-3-5-haiku-20241022" in exc_info.value.allowed


def test_multiple_allowed_models(allowlist):
    allowed = ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"]
    allowlist.check("claude-3-5-haiku-20241022", allowed)
    allowlist.check("claude-3-5-sonnet-20241022", allowed)


def test_empty_allowlist_blocks_all(allowlist):
    with pytest.raises(ModelNotAllowedError):
        allowlist.check("claude-3-5-haiku-20241022", [])


def test_error_message_is_informative(allowlist):
    with pytest.raises(ModelNotAllowedError) as exc_info:
        allowlist.check("gpt-4", ["claude-3-5-haiku-20241022"])
    assert "gpt-4" in str(exc_info.value)
