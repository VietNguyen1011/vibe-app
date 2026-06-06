"""
Demo 'vibe-coded' internal app — a marketing copy assistant.
Calls the guardrails proxy instead of Bedrock/Anthropic directly.

Run (two terminals):
    LLM_BACKEND=mock uvicorn server.main:app --port 8080
    uvicorn toy_app.main:app --port 8081

Try it:
    # Good call
    curl -X POST http://localhost:8081/generate \
         -H 'Content-Type: application/json' \
         -d '{"prompt": "Write a tagline for our Q3 product launch"}'

    # Blocked — wrong model
    curl -X POST http://localhost:8081/generate \
         -H 'Content-Type: application/json' \
         -d '{"prompt": "Hello", "model": "claude-3-5-sonnet-20241022"}'

    # Blocked — PII in prompt
    curl -X POST http://localhost:8081/generate \
         -H 'Content-Type: application/json' \
         -d '{"prompt": "My SSN is 123-45-6789, write a bio for me"}'
"""
import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Marketing Copy Tool (demo vibe-coded app)")

GUARDRAILS_URL = os.getenv("GUARDRAILS_URL", "http://localhost:8080")
APP_ID = "marketing-tool"


class GenerateRequest(BaseModel):
    prompt: str
    model: str = "claude-3-5-haiku-20241022"


@app.post("/generate")
async def generate(req: GenerateRequest):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{GUARDRAILS_URL}/v1/{APP_ID}/messages",
            json={
                "model": req.model,
                "messages": [{"role": "user", "content": req.prompt}],
                "max_tokens": 512,
                "system": "You are a helpful marketing copywriter for Alice AI.",
            },
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail"))

    data = resp.json()
    return {
        "text": data["content"][0]["text"],
        "model": data["model"],
        "tokens_used": data["usage"]["input_tokens"] + data["usage"]["output_tokens"],
    }


@app.get("/health")
def health():
    return {"status": "ok", "app_id": APP_ID, "guardrails_url": GUARDRAILS_URL}
