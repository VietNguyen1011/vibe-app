---
name: vibeapp-build
description: Use when a non-technical user wants to build, create, make, set up, or get an internal web app, tool, website, dashboard, or internal service to run on the VibeApp platform — including vague asks like "make me a tool that…" or "I want an app for…". Runs the golden-path pipeline (intent interview, scaffolding, app.yaml authoring, guardrails, pre-push validation) so the result deploys to the VibeApp Portal without errors.
---
# Build a VibeApp

You are guiding a non-technical user. Never expose AWS/IAM/Lambda/Fargate choices.

## Completeness rule (non-negotiable)
The user may be non-technical and vague. Do NOT scaffold or write app.yaml until EVERY
intent item below has an answer. If the user doesn't volunteer one, ask a short
follow-up (one at a time) and offer a sensible default they can accept ("I'll assume no
file uploads — ok?"). A "complete app" means: app.yaml validates clean AND the scaffold
builds. Never hand back a half-configured app.

## Pipeline (follow in order)

1. **Confirm intent — ask one at a time, plain language:**
   - What should the app do? (one sentence — becomes `metadata.description`)
   - A short name for it? (lowercase-with-dashes, e.g. `expense-tracker` -> `metadata.name`; offer one derived from the description)
   - Your work email? (the app owner -> `metadata.owner`; you cannot guess this — always ask)
   - Does it need to remember/store data? (yes -> database)
   - Will users upload or download files? (yes -> storage)
   - Does it call any outside service? Which websites? (-> egress hostnames)
   - Should it use AI? For what? (-> ai.enabled; suggest Haiku for simple, Sonnet for complex)
   - If AI: roughly how much per month can it spend? (-> ai.budget.monthlyUsd; offer a safe default like $20 they can accept — never leave this unasked, the platform caps spend here)
   - Any sensitive actions like sending email or deleting things? (-> guardedActions)
   - Anything on a schedule / in the background (e.g. a weekly summary)? (-> queue: true)
   - Will it run long tasks or chat-stream? (-> shape agent/streaming/batch, else web-api)
   - Pick a stack — recommend `react-ts` (interactive app) by default; offer `static-html` for a simple page or `python-api` for Python. If they don't care, choose react-ts.

2. **Dispatch two sub-agents in parallel** (one message, two dispatches — they are independent):
   `scaffolder` (pass the chosen stack + intent) and `manifest-author` (pass ALL intent answers, including name, owner email, description, and the chosen stack).

3. **Barrier**, then apply the `vibeapp-guardrails` skill to the generated code.

4. **Preflight**: invoke `vibeapp-preflight` (it dispatches the `validator` sub-agent / runs the bundled validator). If it reports issues, hand them to `manifest-author` to fix, then re-validate. Loop until green.

5. **Ship it — don't assume the user knows git.** Most non-technical users have no repo yet. Do the mechanical parts FOR them, in plain language:
   - If there's no git repo here, run `git init`, `git add -A`, and an initial commit for them.
   - If there's no GitHub remote, walk them through it simply: offer to create one with `gh repo create <name> --private --source=. --push` if the `gh` CLI is available; otherwise give them the one-line steps (create an empty private repo on github.com, then copy the two commands you print: `git remote add origin <url>` and `git push -u origin main`).
   - Then tell them the only manual step left: open the VibeApp Portal, sign in with company SSO, link GitHub once, and point it at this repo.
   - The Portal validates, scans, builds, and deploys; the live internal URL (behind company SSO) comes back in a few minutes.

REQUIRED SUB-SKILLS used along the way: vibeapp-scaffolding, vibeapp-manifest, vibeapp-guardrails, vibeapp-preflight.
