from typing import Optional
from pydantic import BaseModel


class MessageParam(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[MessageParam]
    max_tokens: int = 1024
    system: Optional[str] = None


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class ChatResponse(BaseModel):
    id: str
    model: str
    content: list[dict]
    usage: TokenUsage
    stop_reason: str = "end_turn"


class BudgetStatus(BaseModel):
    app_id: str
    date: str
    tokens_in: int
    tokens_out: int
    total_tokens: int
    cost_usd: float
    token_limit: int
    cost_limit_usd: float
    token_pct: float
    cost_pct: float
