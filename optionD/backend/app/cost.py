"""Projected monthly token cost — LLM spend as a first-class signal.

Rough projection for a modest internal app. Real attribution comes from the
observability MCP endpoint tagging every Bedrock call with app + owner; this is
the up-front estimate the employee sees before launch.
"""

from __future__ import annotations

from app.catalog import model_by_id
from app.schemas import CostProjection, Submission

# Assumed shape of a modest internal app.
_CALLS_PER_DAY = 240
_IN_TOKENS = 1800
_OUT_TOKENS = 600


def project_cost(sub: Submission) -> CostProjection:
    model = model_by_id(sub.model_id)
    daily = (
        _CALLS_PER_DAY * (_IN_TOKENS / 1000) * model.in_per_1k
        + _CALLS_PER_DAY * (_OUT_TOKENS / 1000) * model.out_per_1k
    )
    return CostProjection(
        monthly=round(daily * 30),
        per_call=round(daily / _CALLS_PER_DAY, 4),
        calls_per_day=_CALLS_PER_DAY,
    )
