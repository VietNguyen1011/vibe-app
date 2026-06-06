---
name: vibeapp-guardrails
description: Use when wiring a VibeApp app's code to platform golden-path practices — secrets, AI Gateway, egress, and guarded actions — so it passes the platform security scan.
---
# VibeApp Guardrails (golden path)

Apply to all generated code:

1. **Secrets** — never hardcode. Read from env (the scoped role injects them at runtime), e.g. `process.env.VIBEAPP_GATEWAY_TOKEN`.
2. **AI Gateway** — all LLM calls go to `VIBEAPP_GATEWAY_URL`, never Bedrock/boto3/other-provider SDKs directly. The gateway enforces the model allowlist, budget, and PII redaction.
3. **Egress** — outbound HTTP only to hosts declared in `spec.network.egress`. Don't call undeclared hosts.
4. **Guarded actions** — send/delete/external mutations must be declared in `spec.guardrails.guardedActions` (routed through MCP mediation for human approval). Don't auto-execute them silently.
5. **Least privilege** — only request resources the app truly needs in the manifest.
