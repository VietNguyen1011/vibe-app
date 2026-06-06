# Python (FastAPI) app

API in `main.py`, static UI in `index.html`. Deps in `requirements.txt`.

Golden path (do not break — the platform scan checks this):
- Never hardcode secrets — read from env (`os.environ[...]`).
- LLM calls go through the AI Gateway (`VIBEAPP_GATEWAY_URL`), never boto3/Bedrock directly.
- Outbound HTTP only to hosts declared in `app.yaml` → `spec.network.egress`.
- No Dockerfile — buildpacks own the image.
