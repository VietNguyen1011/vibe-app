# Spec — 1m15s demo clip

**Date:** 2026-06-05  
**Status:** Approved  

## Goal
A ~75-second Playwright video showing the full vibeapp flow: GitHub App connect → private repo scan → wizard → admin approve → **app live + lifecycle** view. "Thật kĩ" = deliberate pauses on key moments, slow artifact scroll, end on full lifecycle confirmation.

## Shot sequence

| Timecode | Scene | Technique |
|---|---|---|
| 0–4s | Login screen | Pause 2s on dev identities |
| 4–10s | Maya login → Connect step | Show tagline, Connect GitHub button |
| 10–18s | Authorize → repo picker | **Pause 3s** on "Connected as alice-internal" + 🔒 badges |
| 18–30s | Pick claims-triage → scan → Details | Detected chips (Streamlit/app.py/1 key) → model picker → budget → cost "$104/mo est" |
| 30–37s | Safety check | Checks animate in → "All clear" banner |
| 37–44s | Done + Peek under the hood | Timeline → expand artifacts → IAM JSON highlighted |
| 44–50s | Sign out → Priya admin | Stat strip → queue with new submission selected |
| 50–57s | Artifacts tab | Slow scroll through 4 files |
| 57–62s | Summary → Approve | PROVISIONING badge → LIVE flip |
| 62–75s | App live: lifecycle | Live URL chip paused 2s → Cost & guardrails tab (spend tracker, projected $104/mo, LLM pricing) → back to Summary → Retire app button = full lifecycle |

## Output
`docs/videos/vibeapp-1min-demo.{webm,mp4}` + copy to Desktop.
