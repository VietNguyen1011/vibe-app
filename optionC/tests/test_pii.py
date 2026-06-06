import pytest
from guardrails.pii import RegexPiiScanner


@pytest.fixture
def scanner():
    return RegexPiiScanner()


def test_clean_text_passes(scanner):
    result = scanner.scan("Tell me about our Q3 marketing strategy.")
    assert not result.found
    assert result.entities == []


def test_email_detected(scanner):
    result = scanner.scan("Contact john.doe@example.com for details.")
    assert result.found
    assert "EMAIL_ADDRESS" in result.types


def test_ssn_detected(scanner):
    result = scanner.scan("My SSN is 123-45-6789.")
    assert result.found
    assert "US_SSN" in result.types


def test_phone_number_detected(scanner):
    result = scanner.scan("Call me at 555-867-5309.")
    assert result.found
    assert "PHONE_NUMBER" in result.types


def test_multiple_pii_types_in_one_text(scanner):
    result = scanner.scan("Email: foo@bar.com, SSN: 123-45-6789")
    assert result.found
    assert "EMAIL_ADDRESS" in result.types
    assert "US_SSN" in result.types


def test_redact_email_replaces_with_placeholder(scanner):
    text = "Email me at user@example.com please."
    result = scanner.scan(text)
    redacted = scanner.redact(text, result)
    assert "user@example.com" not in redacted
    assert "<EMAIL_ADDRESS>" in redacted


def test_redact_ssn(scanner):
    text = "SSN: 123-45-6789"
    result = scanner.scan(text)
    redacted = scanner.redact(text, result)
    assert "123-45-6789" not in redacted
    assert "<US_SSN>" in redacted


def test_redacted_text_scans_clean(scanner):
    """After redaction, a second scan should find no PII."""
    text = "Contact 555-867-5309 or user@example.com"
    result = scanner.scan(text)
    redacted = scanner.redact(text, result)
    clean_result = scanner.scan(redacted)
    assert not clean_result.found


def test_pii_types_property_deduplicates(scanner):
    result = scanner.scan("foo@a.com bar@b.com")
    assert result.types.count("EMAIL_ADDRESS") == 1
