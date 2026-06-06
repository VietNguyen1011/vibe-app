# Static HTML app

Edit `index.html` for the UI, `api.js` for endpoints.

Golden path (do not break — the platform scan checks this):
- Never hardcode secrets — read from env (e.g. `process.env.VIBEAPP_GATEWAY_TOKEN`).
- LLM calls go through the AI Gateway (`VIBEAPP_GATEWAY_URL`), never Bedrock directly.
- Outbound HTTP only to hosts declared in `app.yaml` → `spec.network.egress`.
- No Dockerfile — buildpacks own the image.
