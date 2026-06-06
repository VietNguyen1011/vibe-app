# Interview Prep — vibeapp (Option D)

> Private notes for the 45-minute live discussion. The brief says they'll **walk
> through the design, compare it to their internal approach, and dig into a couple
> of operational scenarios.** This doc is the talk track + a Q&A bank for that.

---

## 1. The 60-second pitch

> "Alice has dozens of non-technical people vibe-coding real tools with Claude Code.
> The gap is the last mile: laptop → live URL, safely, without them touching IAM or
> Kubernetes. I built **vibeapp** — a portal where someone pastes a repo, answers
> five plain-language questions, and the platform turns that intent into the exact
> least-privilege artifacts a provisioner applies. The employee never sees IAM; the
> platform owns every boundary. I built the slice that's the actual hard part:
> **scan → validate → generate artifacts → human-approve → live**, with the security
> properties enforced and tested, not assumed."

Lead with the **insight**: the employee supplies *intent*, the platform owns *blast
radius*. Everything else follows from that split.

---

## 2. What I built (deliverable map)

- **Design doc** — `DESIGN.md` (target arch, tenancy, observability/cost, guardrails,
  lifecycle, ownership, tradeoffs, rollout).
- **Code slice — Option D**: FastAPI backend (the "provisioner-feeder") + React/TS
  frontend (the employee wizard + admin console). Real repo scan, real artifact
  generation, mock SSO + RBAC, simulated provisioning lifecycle.
- **README** — run instructions, next steps, AI-collaboration writeup.
- **Demo video** — `docs/videos/vibeapp-demo.mp4`.

Numbers to drop: **34 backend tests**, **8 frontend tests**, strict TypeScript,
TanStack Query, Dockerized. ~one focused build, not a kitchen sink.

---

## 3. Architecture walkthrough (talk track)

Trace the **end-to-end path** — this is what they want to see:

1. Employee pushes a Claude Code repo to internal GitHub.
2. Opens vibeapp, **signs in with SSO** → identity decides what they can see/own.
3. Pastes the repo URL → **read-only scan** (real GitHub API): runtime, framework,
   entrypoint, Dockerfile, secret references. *(Show: it detected `mdn/...` as a
   Static site with 0 secrets — it genuinely reads the repo.)*
4. **Five friendly questions**: name, what it does, team, which AI brain (Bedrock
   model allowlist), monthly budget.
5. **Safety check** = the validation gate. Auto-resolves what it can (re-scopes a
   shared-bucket reference to the app's own prefix).
6. Submit → lands in the **admin review queue** with a validated **manifest** + four
   **artifacts**.
7. Admin reviews, **approves** → artifacts handed to the DevOps provisioner →
   `provisioning → live`, URL emailed.

The one-liner that ties it together: **"The manifest is the single source of truth;
every artifact is derived from it and nothing is hand-written."**

**Backend shape to mention:** settings (pydantic-settings, env-overridable),
app-factory + lifespan, domain routers, centralized error envelope, store behind a
`Protocol` (swap in-memory → DynamoDB without touching routes). Identity comes from
the session, never the request body.

---

## 4. Key decisions + how to defend them

| Decision | Why | If pushed |
|---|---|---|
| **App Runner over EKS** | Container→URL with managed TLS/scaling + a clean per-service IAM role = the isolation unit we want, near-zero per-app toil. EKS re-creates the operator bottleneck. | "If density bites at hundreds of apps, App Runner→ECS/Fargate is a provisioner-side change invisible to employees." |
| **Artifacts generated server-side, not in the browser** | The artifacts *are* the product; a provisioner must call an API, not scrape a UI. | The original Claude Design prototype computed them client-side — I deliberately moved them. |
| **Least-privilege as a tested invariant** | Scoping (one model, one S3 prefix, one secrets namespace) is computed from the slug and can't be widened by input. | Adversarial test: app name `../* OR s3:::*` still can't escape its prefix. |
| **Identity from session, not body** | You can't submit "as" someone else; admin actions gated by role. | Easy path was trusting `ownerEmail` from the form — I overrode it. |
| **Async lifecycle (approve returns immediately)** | Don't couple the request to AWS provisioning time/failures. | Modeled with a timer thread + polling; prod = event/queue. |
| **Shared bucket + enforced prefix** over bucket-per-app | Less account sprawl, easier for DevOps to govern, still private per app. | Dedicated buckets = marginally stronger isolation, lots more lifecycle/quota mgmt. |

---

## 5. Ownership boundary (the contract) — talk track

> "The boundary **is** the artifact bundle. vibeapp produces a versioned
> `{manifest, iam-trust, iam-permissions, deploy.yaml, secrets-bootstrap}`; DevOps
> owns the idempotent provisioner that consumes exactly that schema. Neither reaches
> into the other — vibeapp never holds admin AWS creds; DevOps never parses repos or
> talks to employees. The permission *boundary* (SCP / permission boundary) is theirs;
> the permission *policy* scoped to one app is mine. That's what keeps a small DevOps
> team small: they review one stable interface, not N bespoke apps."

---

## 6. Operational scenarios — Q&A bank (the meat)

Expect them to probe failure modes. Crisp answers:

- **"An app blows its budget."** Budget is a manifest field wired to a billing alarm.
  At 80% the owner is emailed; at 100% the app pauses — no surprise bills. The admin
  cost tab shows burn. Per-app/owner tagging means I can attribute the spike to one
  app and (with the obs MCP) to the specific tool-calls inside it.
- **"Prompt injection / the app misbehaves."** `promptInjectionShield` + `piiScan` are
  on by default in every manifest, not opt-in. Model access is pinned in IAM to the
  one allowlisted Bedrock model, so even a compromised app can't call others. For
  high-budget apps, human-in-the-loop is required on runs.
- **"A secret leaks."** Secrets live in a per-app namespace (`apps/<slug>/*`); the
  bootstrap script creates *empty named slots* — values are set out-of-band and never
  transit the portal. Platform-managed keys (e.g. `ANTHROPIC_API_KEY`) rotate centrally
  every 90 days. Blast radius is one app's namespace.
- **"App needs a new/blocked model."** It's an allowlist (`catalog.py`). Add to the
  catalog → it flows into the IAM permissions policy. An app literally cannot invoke a
  model that isn't pinned in its role — enforced at AWS, not just in code.
- **"Noisy neighbor / one app hogs resources."** Per-app App Runner service with its
  own autoscaling (min/max/maxConcurrency) and its own role — apps can't reach each
  other (network) or each other's data (S3 prefix + secrets namespace).
- **"Scale to 10x apps."** Throughput limiter is human approval. Rollout shrinks it:
  auto-approve low-risk apps (known runtime, budget under threshold, clean scan); more
  runtimes/models via the catalog with no portal change; declarative `vibeapp.yaml`
  committed to the repo so re-submits skip the round-trip.
- **"Rollback / retire."** Admin retires → deprovision service, revoke role, archive
  secrets + S3 prefix, keep the audit record. (Slice models retire as review→ ; prod
  deprovisions.)
- **"Audit: who approved what?"** Every state transition is attributable — identity
  from SSO session, approve/retire RBAC-gated to admins. Slice has the gate + role
  checks; prod adds an append-only audit log.
- **"What if the scan is wrong / repo is weird?"** Scan is best-effort and read-only;
  on failure it falls back to a flagged synthetic result rather than blocking. The
  employee can correct any detected field in the form. Nothing auto-deploys — a human
  approves.

---

## 7. What's real vs stubbed (be honest — they'll ask)

**Real:** repo scan (live GitHub API, read-only — detects runtime/framework/entry/
secrets/commit), artifact generation (least-privilege, computed from inputs),
validation gate, manifest, cost projection, auth + RBAC, lifecycle, 34 tests.

**Stubbed (honestly):** no actual AWS provisioning — approval simulates
`provisioning→live` (the brief explicitly allows this). SSO is a one-click dev
stand-in for a real OIDC flow — isolated to `auth.py`. Store is in-memory behind a
`Protocol`. No full-source secret grep (only `.env` templates).

The line: **"Stubs are at honest boundaries — the interfaces don't lie about what's
real. Swapping any one is a local change."**

---

## 8. Known gaps / next (shows judgment)

1. Real provisioner handshake (write artifacts to S3 / a PR against an infra repo +
   emit an event) — makes the ownership boundary executable.
2. Persistence + idempotency (DynamoDB/Postgres behind the same repo interface; submit
   idempotent on `(repo, commit)`).
3. Live cost/trace attribution via the obs MCP endpoint (projection → real spend).
4. Real OIDC, signed sessions, append-only audit log.
5. Deeper scan: full-source secret grep, private-repo tokens, rate-limit caching.

---

## 9. AI-collaboration story (they score this explicitly)

- **Used Claude Code** as the co-engineer: read the brief + the Claude Design handoff,
  ported the client-side prototype into a real FastAPI + React/TS app, wrote the tests.
- **Where I overrode it:** (a) moved artifact generation server-side — the obvious port
  kept it in the browser, wrong for Option D; (b) made least-privilege a *tested*
  invariant with an adversarial case, not a trusted template; (c) pushed identity to
  the session when SSO went in; (d) kept scope honest — declined to build a real
  provisioner/DB, stubbed at clean boundaries; (e) verified in a real browser
  (Playwright) instead of trusting "it should render."
- Punchline: **"I treat it like a fast junior who needs a senior's judgment on
  architecture and security — it accelerates the typing, I own the decisions."**

---

## 10. Curveballs + one-liners

- *"Why not Vercel/Netlify/Heroku?"* — Internal-only, on AWS with Bedrock; we want apps
  inside our account/VPC with our IAM + Bedrock guardrails, not a third party.
- *"Why a portal at all, not just CI/CD?"* — The persona can't write a pipeline. The
  portal *is* the interface that turns intent into a reviewable, least-privilege bundle.
- *"Isn't human approval a bottleneck?"* — Yes, by design at launch (trust-building).
  The rollout explicitly shrinks what needs a human until only risky apps do.
- *"What breaks first at scale?"* — Approval throughput, then GitHub scan rate limits
  (→ token + caching), then in-memory store (→ DB). All anticipated.
- *"Biggest weakness?"* — No real provisioner yet; it's the next thing I'd build and
  the interface is already designed for it.

---

## 11. Questions to ask them

- How do you currently get a vibe-coded app to a live URL — and who's the gate?
- Where's your real ownership line between platform and DevOps?
- Is per-app/per-user LLM cost attribution solved, or still a pain?
- App Runner, ECS, EKS, or Lambda for this class of internal app — and why?
- How do you handle the human-approval bottleneck as app count grows?
