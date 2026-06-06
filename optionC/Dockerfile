FROM python:3.12-slim

WORKDIR /app

# Install production deps only (no presidio/spacy — use regex PII backend in Docker)
RUN pip install --no-cache-dir \
    fastapi==0.136.3 \
    "uvicorn[standard]>=0.30.0" \
    httpx>=0.27.0 \
    pydantic>=2.0.0 \
    anthropic>=0.30.0 \
    python-dotenv>=1.0.0 \
    pyyaml>=6.0.0

COPY guardrails/ ./guardrails/
COPY server/     ./server/
COPY toy_app/    ./toy_app/
COPY app_registry.yaml .

EXPOSE 8080

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
