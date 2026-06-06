"""Bedrock model allowlist + friendly catalog.

This is the model allowlist guardrail from the assignment. The employee picks by
friendly `label`; the platform pins the real Bedrock `model_id` into the IAM
permissions policy so the app can invoke that model and nothing else.
"""

from __future__ import annotations

from app.schemas import ModelOption

MODEL_CATALOG: list[ModelOption] = [
    ModelOption(
        id="sonnet",
        label="Claude 3.5 Sonnet",
        blurb="Smart and fast — great for most apps",
        model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
        in_per_1k=0.003,
        out_per_1k=0.015,
        recommended=True,
    ),
    ModelOption(
        id="haiku",
        label="Claude 3.5 Haiku",
        blurb="Lightning quick — best for simple, high-volume tasks",
        model_id="anthropic.claude-3-5-haiku-20241022-v1:0",
        in_per_1k=0.0008,
        out_per_1k=0.004,
    ),
    ModelOption(
        id="opus",
        label="Claude 3 Opus",
        blurb="Deepest reasoning — for the hardest problems",
        model_id="anthropic.claude-3-opus-20240229-v1:0",
        in_per_1k=0.015,
        out_per_1k=0.075,
    ),
]

_BY_ID = {m.id: m for m in MODEL_CATALOG}


def model_by_id(model_id: str | None) -> ModelOption:
    """Resolve a catalog id, falling back to the recommended default."""
    return _BY_ID.get(model_id or "", MODEL_CATALOG[0])


def is_allowlisted(model_id: str | None) -> bool:
    return model_id in _BY_ID
