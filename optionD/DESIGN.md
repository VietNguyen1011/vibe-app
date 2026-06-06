# Vibeapp — Platform Design (Deliverable 1)

**Problem.** Dozens of non-technical employees vibe-code working apps with Claude
Code. Getting one from "works on my laptop" to "live URL my team uses" is manual
and operator-gated, with no org-wide story for cost, guardrails, or audit.

**Thesis.** Give the employee one path — *submit a repo, answer five friendly
questions, get a live URL* — and make the platform, not the person, own every hard
boundary (IAM, secrets, network, budget, model access). The employee supplies
**intent**; Vibeapp turns intent into **least-privilege artifacts** a provisioner
applies. The code slice in this repo is the intent→artifacts core.

---

## 1. Target architecture — prompt to live URL

```
Employee laptop                    Vibeapp (platform team owns)              DevOps team owns
─────────────                      ─────────────────────────────              ───────────────
Claude Code  ──push──►  GitHub ──►  ┌──────────────────────────┐
                          repo      │ Portal API (this slice)  │
                                    │  • scan repo (read-only) │
   friendly wizard ◄──────────────► │  • build manifest        │
   (5 questions)                    │  • validate (the gate)   │
                                    │  • generate artifacts ───┼──► artifact bundle
                                    │  • project cost          │     (IAM trust + perms,
                                    └──────────┬───────────────┘      deploy.yaml, secrets
                                               │ approve (human)       bootstrap, manifest)
                                               ▼                              │
                                    ┌──────────────────────────┐             ▼
                                    │ Provisioner (event/PR)   │◄──── consumes bundle
                                    │  applies IAM, secrets,   │      ┌────────────────────┐
                                    │  App Runner service      │────► │ AWS App Runner svc │
                                    └──────────────────────────┘      │  + IAM role        │
                                               │                      │  + scoped S3/secrets│
                                               ▼                      └─────────┬──────────┘
                                       live URL emailed                         │ every Bedrock
                                       app.apps.alice.io                        │ call + tool span
                                                                                ▼
                                                                    Observability MCP collector
                                                                    (per-app/user cost + traces)
```

**End-to-end path:**
1. Employee builds an app with Claude Code, pushes to an internal GitHub repo.
2. Opens Vibeapp, signs in with SSO, pastes the repo URL.
3. Vibeapp **scans** (read-only) the repo: runtime, framework, port, referenced
   secrets, risky patterns.
4. Wizard asks five plain-language questions: *what's it called, what does it do,
   which team, which AI brain, monthly spend limit.* Detected secrets are surfaced;
   platform-managed ones (e.g. `ANTHROPIC_API_KEY`) need no action.
5. **Safety check** runs the validation gate and auto-resolves what it can
   (e.g. re-scopes a shared-bucket reference to the app's own prefix).
6. Submit → the request lands in the platform-admin **review queue** with a
   validated **manifest** and four generated **artifacts**.
7. Admin reviews and **approves**; the artifact bundle is handed to the DevOps
   **provisioner**, which stands up an App Runner service with a least-privilege
   role. App goes `provisioning → live`; the URL is emailed to the owner.

**Why App Runner, not EKS** — see §7.

---

## 2. Tenancy and isolation

One AWS account, hard per-app partitioning. The unit of tenancy is the **app**
(`slug`), not the user — apps outlive and are shared across users.

| Concern | Shared (platform invariant) | Per-app (parameterized) |
|---|---|---|
| **Compute** | App Runner service quota, base container contract, VPC connector | One App Runner service per app, its own task role |
| **IAM** | Trust-policy *shape*, permission-policy *shape* | A role assumable **only** by this app's runtime; Bedrock scoped to one model, S3 to one prefix, secrets to one namespace |
| **Data (S3)** | One bucket `alice-internal-apps` | Prefix `s3://…/<slug>/*`, enforced by `s3:prefix` condition |
| **Secrets** | Secrets Manager, rotation jobs | Namespace `apps/<slug>/*`; values set out-of-band, never by the portal |
| **Network** | Internal-only VPC, no public ingress | Per-service egress; apps can't reach each other |
| **Telemetry** | CloudWatch + MCP collector | Metric namespace `vibeapp/<slug>`, traces tagged `app=<slug>` |

**The isolation guarantee is generated, not hand-written.** `artifacts.py` derives
every ARN/prefix from the slug, and the slug is hardened (`slugify` strips `/`, `*`,
`..`). A test submits the app name `../* OR s3:::*` and asserts the generated policy
still can't escape its prefix. This is the property that lets a non-technical user
ship safely: they *cannot* widen their own blast radius.

---

## 3. Observability and cost

**LLM token cost is a first-class signal, attributed per-app and per-user.**

- Every generated app ships with `OBS_MCP_ENDPOINT` and an attribution block
  (`app=<slug>, owner=<email>`). Every Bedrock call and tool-call span flows to the
  observability MCP collector tagged with both — so cost and traces roll up by app,
  by user, and by team across the whole agent / tool-call chain. (This is the
  consumer side of Option B's MCP server.)
- **Budgets are enforced, not just reported.** Each app declares
  `monthlyBudgetUsd`, wired to a billing alarm. At 80% the owner is emailed; at 100%
  the app pauses — no surprise bills. The portal shows a projected monthly cost
  *before* launch (`cost.py`) and actual spend after.
- **Tracing.** `tracing: true` in the manifest; spans carry the app/owner tags so a
  slow or expensive run is traceable to a specific app and the specific tool calls
  inside it.

The admin **Cost & guardrails** tab surfaces budget burn, per-call cost, and the
model's token pricing in one place.

---

## 4. Guardrails

Defense in depth, on by default, not opt-in:

- **Model allowlist.** Apps may invoke only models on the Bedrock allowlist
  (`catalog.py`), pinned into the IAM permission policy — so the *only* model an app
  can call is the one approved, enforced at the AWS layer, not just in code.
- **Prompt-injection shield + PII scan.** Enabled by default in every manifest
  (`promptInjectionShield`, `piiScan`). The employee sees a reassuring "personal-info
  scanning is on"; the platform sees it as a non-negotiable guardrail.
- **Human-in-the-loop checkpoints.** (a) Every submission needs **human approval**
  before provisioning. (b) Apps with `budget ≥ $500` require human-in-the-loop on
  high-cost runs (`humanInLoop` in the manifest).
- **Least-privilege IAM** (§2) — the structural guardrail.
- **Audit trail.** Identity is taken from the SSO session, never the request body;
  owner = authenticated user; approve/retire are RBAC-gated to platform admins.
  Every state transition is an auditable, attributable event. (In the slice this is
  the in-memory store + role gate; in production, an append-only audit log.)

---

## 5. Lifecycle

- **Provisioning.** Submit → validate → human approve → artifact bundle → provisioner
  → live. Async: approval returns immediately, the service comes up out of band, the
  URL is emailed.
- **Updates.** A new push re-scans and re-submits; the manifest is versioned
  (`vibeapp.alice.io/v1`) and the diff is reviewable. Re-submit is keyed on
  `(repo, commit)`.
- **Secret rotation.** Platform-managed secrets (e.g. `ANTHROPIC_API_KEY`) rotate
  centrally every 90 days (`secrets-bootstrap.sh` documents this). App-specific
  secrets live in the app's namespace; the bootstrap script creates **empty named
  slots** — values are set out-of-band, never transit the portal.
- **Retirement.** An admin retires an app (in the slice: back to review; in
  production: deprovision the service, revoke the role, archive secrets + S3 prefix,
  keep the audit record).

---

## 6. Ownership — Vibeapp vs. DevOps

The boundary is the **artifact bundle**: Vibeapp produces it, DevOps consumes it.

| Vibeapp (AI Infra — me) | DevOps (central platform) |
|---|---|
| Portal API + employee/admin UX | The **provisioner** that applies the bundle |
| Manifest schema + artifact generation | Shared VPC, base AMIs/containers, the S3 bucket, Secrets Manager |
| Guardrails: allowlists, budgets, PII/injection defaults | App Runner platform, scaling, on-call for the platform itself |
| Per-app/user cost + trace attribution (MCP) | Account-level IAM guardrails (SCPs, permission boundaries) |
| Model catalog + Bedrock allowlist policy | Network egress controls, base CloudWatch |

**The contract.** Vibeapp emits a versioned bundle —
`{manifest, iam-trust-policy.json, iam-permissions.json, deploy.yaml,
secrets-bootstrap.sh}` — to an agreed channel (S3 path or a PR against an infra
repo) and an event. DevOps owns an idempotent provisioner that consumes exactly that
schema and nothing else. Neither side reaches into the other: Vibeapp never holds
admin AWS credentials; DevOps never parses repos or talks to employees. The
permission *boundary* (the SCP/permission-boundary the app role must fit inside) is
DevOps's; the permission *policy* (scoped to one model/prefix/namespace) is
Vibeapp's. This is what lets the small DevOps team stay small — they review one
stable interface, not N bespoke apps.

---

## 7. Tradeoffs

**App Runner vs. EKS (chosen: App Runner).** The user can't and shouldn't reason
about pods, ingress, or HPAs. App Runner gives a container → URL with managed TLS,
scaling, and a clean per-service IAM role — almost exactly the per-app isolation
unit we want, with near-zero platform-team toil per app. EKS would offer denser
bin-packing and more control, but every app would need namespace/network-policy/
RBAC wiring that *someone* owns — re-creating the operator-gated bottleneck we're
removing. We trade cost efficiency at scale for a drastically simpler ownership
model and faster path to live. If density becomes the constraint at hundreds of
apps, App Runner → ECS/Fargate is a provisioner-side change invisible to employees.

**Sync vs. async deployment (chosen: async).** Approval returns instantly and the
app provisions out of band. Synchronous would be simpler to demo but couples the
portal's request lifecycle to AWS provisioning time and failure modes. Async keeps
the UX responsive and the system resilient; the cost is needing status polling /
eventing (modelled here by a timer + poll).

**Shared bucket + prefix vs. dedicated bucket per app (chosen: shared + prefix).**
One bucket with enforced `s3:prefix` conditions is far less account-object sprawl and
easier for DevOps to govern, while still giving each app a private space. A
dedicated bucket per app would be marginally stronger isolation but multiplies
lifecycle and quota management for little real gain inside one trusted org.

---

## 8. Rollout shape

**Ships first (the thin vertical):** the portal that scans a repo, validates,
generates the bundle, and hands it to a provisioner for **one runtime** (Streamlit/
container on App Runner) and **one model tier**. Human approval on every app. This is
the slice in this repo plus the provisioner handshake.

**Stays manual at launch:** the approve step (a human reads each submission), secret
*values* (set out-of-band by the owner/DevOps), and onboarding net-new runtimes.
Manual-but-bounded beats automated-but-wrong while trust is being established.

**Unlocks the next 10×:**
- Self-serve **re-submit on push** (declarative `vibeapp.yaml` committed to the
  repo) removes the portal round-trip for updates.
- **Auto-approve** low-risk apps (recognized runtime, budget under a threshold,
  clean scan) — humans review only the exceptions.
- More runtimes + model tiers via the catalog, no portal changes.
- Live cost/trace attribution (MCP) turns the cost panel from projection into
  real-time spend, enabling org-wide budgets and chargeback.

The throughput limiter is human approval; the rollout is explicitly designed to
shrink what needs a human until only genuinely risky apps do.
