---
name: vibeapp-scaffolding
description: Use when scaffolding a new VibeApp project skeleton — choosing a beginner-friendly stack and laying down the UI + API files.
---
# VibeApp Scaffolding

Stacks (beginner-friendly only — never Java/C++/Go):
- `static-html` — one HTML page + a small JS API. Simplest.
- `react-ts` — Vite + React + TypeScript. Interactive UIs.
- `python-api` — FastAPI + static page. Python users.

Templates live in `$CLAUDE_PLUGIN_ROOT/skills/vibeapp-scaffolding/templates/<stack>/`. Copy ALL files to the project root. For `react-ts`, rename the `src-` prefixed files into a `src/` dir and the API handler:
- `src-App.tsx` -> `src/App.tsx`
- `src-main.tsx` -> `src/main.tsx`
- `api-handler.ts` -> `src/api.ts`
- copy `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `README.md` as-is to root

Always keep: static UI entry (`index.html`) + API entrypoint + README. Buildpacks detect the stack from these files — do not add Dockerfiles.
