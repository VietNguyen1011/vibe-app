import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PiiScanResult:
    found: bool
    entities: list[dict] = field(default_factory=list)

    @property
    def types(self) -> list[str]:
        return list({e["type"] for e in self.entities})


class PiiBlockedError(Exception):
    def __init__(self, types: list[str]):
        self.types = types
        super().__init__(f"PII detected and blocked: {types}")


class PiiScanner(ABC):
    @abstractmethod
    def scan(self, text: str) -> PiiScanResult: ...

    @abstractmethod
    def redact(self, text: str, result: PiiScanResult) -> str: ...


class RegexPiiScanner(PiiScanner):
    """Lightweight scanner using regex. No cloud dependency — good for local demo and tests."""

    _PATTERNS: list[tuple[str, re.Pattern]] = [
        ("EMAIL_ADDRESS", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
        ("PHONE_NUMBER",  re.compile(r"\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")),
        ("US_SSN",        re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
        ("CREDIT_CARD",   re.compile(r"\b(?:\d[ -]?){13,16}\b")),
    ]

    def scan(self, text: str) -> PiiScanResult:
        entities: list[dict] = []
        for entity_type, pattern in self._PATTERNS:
            for m in pattern.finditer(text):
                entities.append({"type": entity_type, "start": m.start(), "end": m.end(), "score": 0.9})
        return PiiScanResult(found=bool(entities), entities=entities)

    def redact(self, text: str, result: PiiScanResult) -> str:
        # Process in reverse order so replacing earlier spans doesn't shift later offsets
        redacted = text
        for e in sorted(result.entities, key=lambda x: x["start"], reverse=True):
            placeholder = f"<{e['type']}>"
            redacted = redacted[: e["start"]] + placeholder + redacted[e["end"] :]
        return redacted


class PresidioPiiScanner(PiiScanner):
    """Full NLP-based scanner using Microsoft Presidio. Requires: pip install presidio-analyzer presidio-anonymizer + spacy model."""

    def __init__(self) -> None:
        from presidio_analyzer import AnalyzerEngine
        self._analyzer = AnalyzerEngine()

    def scan(self, text: str) -> PiiScanResult:
        results = self._analyzer.analyze(text=text, language="en")
        if not results:
            return PiiScanResult(found=False)
        entities = [
            {"type": r.entity_type, "start": r.start, "end": r.end, "score": r.score}
            for r in results
        ]
        return PiiScanResult(found=True, entities=entities)

    def redact(self, text: str, result: PiiScanResult) -> str:
        from presidio_anonymizer import AnonymizerEngine
        from presidio_analyzer import RecognizerResult

        analyzer_results = [
            RecognizerResult(entity_type=e["type"], start=e["start"], end=e["end"], score=e["score"])
            for e in result.entities
        ]
        anonymizer = AnonymizerEngine()
        return anonymizer.anonymize(text=text, analyzer_results=analyzer_results).text


class ComprehendPiiScanner(PiiScanner):
    """Production stub — uses Amazon Comprehend DetectPiiEntities."""

    def scan(self, text: str) -> PiiScanResult:
        # PRODUCTION:
        # client = boto3.client('comprehend')
        # resp = client.detect_pii_entities(Text=text, LanguageCode='en')
        # entities = [{"type": e["Type"], "start": e["BeginOffset"],
        #              "end": e["EndOffset"], "score": e["Score"]}
        #             for e in resp["Entities"]]
        # return PiiScanResult(found=bool(entities), entities=entities)
        raise NotImplementedError("Comprehend backend not configured")

    def redact(self, text: str, result: PiiScanResult) -> str:
        raise NotImplementedError("Comprehend backend not configured")


def create_scanner() -> PiiScanner:
    backend = os.getenv("PII_BACKEND", "regex")
    if backend == "presidio":
        return PresidioPiiScanner()
    if backend == "comprehend":
        return ComprehendPiiScanner()
    return RegexPiiScanner()
