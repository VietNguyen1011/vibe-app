---
name: vibeapp-preflight
description: Use before pushing a VibeApp app — validates app.yaml and runs the build-compatibility checklist so the platform accepts it on the first try.
---
# VibeApp Preflight

1. Run the validator: `node "$CLAUDE_PLUGIN_ROOT/scripts/validate-manifest.mjs" app.yaml`. Relay any issues in plain language; loop with `manifest-author` until it prints "is valid".
2. Build-compat checklist:
   - [ ] static UI + API entrypoint present
   - [ ] no Dockerfile (buildpacks own the image)
   - [ ] no hardcoded secrets (grep for obvious keys)
   - [ ] LLM calls use `VIBEAPP_GATEWAY_URL`, not a provider SDK
   - [ ] every external host the code calls is in `spec.network.egress`
3. When all green, tell the user it's ready to `git push`.
