# React + TypeScript app

UI in `src-App.tsx` (→ `src/App.tsx`), React mount `src-main.tsx` (→ `src/main.tsx`), API in `api-handler.ts` (→ `src/api.ts`). `index.html` + `vite.config.ts` + `tsconfig.json` go at the root.

Golden path (do not break — the platform scan checks this):
- Never hardcode secrets — read from env.
- LLM calls go through the AI Gateway (`VIBEAPP_GATEWAY_URL`), never Bedrock directly.
- Outbound HTTP only to hosts declared in `app.yaml` → `spec.network.egress`.
- No Dockerfile — buildpacks own the image.
