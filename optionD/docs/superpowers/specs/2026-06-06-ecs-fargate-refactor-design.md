# Spec — Compute refactor: App Runner → ECS Fargate + tested network control

**Date:** 2026-06-06
**Status:** Approved

## Goal

Make the artifact slice emit **ECS Fargate** instead of App Runner, and turn per-app
**network control (inbound + outbound)** into a *generated, tested* artifact — the
same way IAM least-privilege already is. This closes the gap the Design Doc §8 names:
App Runner abstracts networking, so "no route to an internet gateway; egress only
through the proxy" cannot be expressed as a structural invariant. Fargate can.

This aligns the code with the Design Doc's **chosen** compute. Design Doc §8 verbatim:
> *"Compute: ECS Fargate (chosen) … Fargate gives full control of the VPC, subnets,
> security groups, and route tables — which is what lets 'no route to an internet
> gateway; egress only through the proxy' be a structural invariant … (The code slice
> in Deliverable 2 emits App Runner config as the fastest way to demo the
> intent→artifacts pattern; that is precisely the provisioner-side swap described here.)"*

## Non-goals (scope fence)

- **No change** to S3 / secrets / Bedrock-model / CloudWatch IAM scoping — the
  least-privilege permission statements stay byte-for-byte except where ECS requires it.
- **No change** to `scanner.runtime` (that field is the *language* — python/node/static —
  not the compute platform).
- **No new wizard question.** CPU/memory is auto-derived (employee never sees it).
- **No** migration of Bedrock from direct-IAM to the LiteLLM gateway virtual-key model.
  That is a separate refactor. We encode "Bedrock reachable only via the AI gateway" at
  the **network egress allowlist** layer only, leaving the IAM Bedrock statement intact.
- **No** raw infra artifacts in the **employee** view — per Design Doc §1.1/§2
  ("The non-technical user never sees any of this").

## Architecture (from Design Doc §2 + Runtime Network Topology page)

```
Route 53 → CloudFront + WAF → ALB (internal) → ECS Fargate task (per-app)
ECS task --egress--> Egress Proxy (allowlist)  → External APIs
ECS task --egress--> AI Gateway (LiteLLM) → VPC Endpoint → Bedrock
App subnet: NO route to Internet Gateway          ← structural invariant
Per-app SG: inbound from ALB SG only; egress only to proxy + AI gateway + RDS proxy
Live URL: {slug}.apps.internal
```

Per-app isolation atom stays the **per-app task role** (assumed by ECS tasks) **plus**
the **per-app security group**. The execution role (ECR pull, log push) is
platform-shared base infra (Design Doc §7 — DevOps owns the cluster foundation), so
deploy.yaml *references* it; only the per-app **task role** is generated here.

## Changes — backend

### New `app/compute.py`
Fargate task-size blocks, derived from `repo.runtime`. Mirrors `catalog.py` shape.
All combos are Fargate-valid.

| runtime | cpu (units) | memory (MiB) | label |
|---|---|---|---|
| static | 256 | 512 | 0.25 vCPU / 0.5 GB |
| node | 512 | 1024 | 0.5 vCPU / 1 GB |
| python | 1024 | 2048 | 1 vCPU / 2 GB |
| *default/unknown* | 512 | 1024 | 0.5 vCPU / 1 GB |

`task_size(runtime: str) -> dict` → `{cpu, memory, cpuLabel, memoryLabel}`.

### `app/artifacts.py`
- **`trust_policy`**: principal `tasks.apprunner.amazonaws.com` → `ecs-tasks.amazonaws.com`;
  Sid `AppRunnerTaskAssume` → `EcsTaskAssume`; `aws:SourceArn` →
  `arn:aws:ecs:{region}:{account}:task/{cluster}/*` (cluster from settings) + keep
  `aws:SourceAccount`. (App-level fencing now lives in permissions policy + per-app SG.)
- **New `security_groups(sub) -> str`** (JSON), derived from slug + `repo.port`, not widenable:
  ```json
  {
    "albSg":  { "scheme": "internal",
                "ingress": [{ "from": "com.amazonaws.global.cloudfront.origin-facing",
                              "protocol": "tcp", "port": 443 }] },
    "taskSg": { "ingress": [{ "from": "albSg", "protocol": "tcp", "port": <app-port> }],
                "egress":  [{ "to": "egress-proxy-sg", "note": "allowlisted outbound only" },
                            { "to": "ai-gateway-sg",   "note": "Bedrock via gateway — no public path" },
                            { "to": "rds-proxy-sg" }],
                "egressDefault": "deny",
                "internetGatewayRoute": false }
  }
  ```
- **`deploy_config`**: `type: apprunner` → `ecs-fargate`; container cpu/memory from
  `compute.task_size(sub.repo.runtime)` (units, not `"1 vCPU"`); add ECS service block —
  `desiredCount`, `deploymentCircuitBreaker: { enable: true, rollback: true }`,
  `albTargetGroup`, `subnets: private-app`, `securityGroup: taskSg`. Keep the existing
  two-line `iam:` block (`taskRole: { trustPolicy: ./iam-trust-policy.json,
  permissions: ./iam-permissions.json }`) and add `executionRole: platform-shared` +
  `securityGroups: ./security-groups.json`. Keep env / guardrails / observability.
- **`generate_artifacts`**: add 5th artifact. Order: `iam-trust-policy.json`,
  `iam-permissions.json`, `security-groups.json`, `deploy.yaml`, `secrets-bootstrap.sh`.

### `app/manifest.py`
`runtime.type` → `ecs-fargate`; cpu/memory from `compute.task_size`; add `network`
block (`ingress: private`, `egress: allowlist [egress-proxy, ai-gateway, rds-proxy]`,
`internetGatewayRoute: false`) so the manifest stays the single source of truth.

### `app/settings.py` + `config.py`
Add `ecs_cluster: str = "vibeapp-apps"`. Flip `apps_domain` default
`apps.alice.io` → `apps.internal` (Design Doc live-URL convention) — propagates to
`liveUrl` everywhere via one setting.

## Changes — backend tests (must stay 100% coverage)

- `test_artifacts.py`:
  - trust principal assert → `ecs-tasks.amazonaws.com`; SourceArn contains the cluster.
  - "four named artifacts" → **five**, set includes `security-groups.json`.
  - **New adversarial SG test** (peer of the malicious-app-name test): `taskSg.ingress`
    never contains `0.0.0.0/0`; no egress entry is `0.0.0.0/0`; `egressDefault == "deny"`;
    `internetGatewayRoute is False`; ingress port == `repo.port`; ingress `from == "albSg"`.
  - deploy.yaml contains `type: ecs-fargate`, cpu/memory from the block, circuit breaker.
- **New `test_compute.py`**: `task_size` per runtime + default; assert each combo is
  a valid Fargate cpu/memory pair.
- Update `test_manifest.py` if present (runtime type, cpu/mem, network block).
- Update any test asserting `apps.alice.io` → `apps.internal`.

## Changes — frontend

- **`employee/EmployeeFlow.tsx` `StepDone`**: replace the raw-artifact "Peek under the
  hood" block with a plain-language **"What we handled for you"** card — derived from
  submission data (private space, `$<budget>/mo` cap, security guardrails on, reachable
  only inside Alice). **No JSON/SG/config.** Drop the `artifacts.map` raw render and the
  employee `peek` state. Timeline live URL → `{slug}.apps.internal`.
- **`admin/AdminConsole.tsx`**:
  - Runtime KV `· AWS App Runner` → `· AWS ECS Fargate`.
  - Provisioning spinner `…AWS App Runner…` → `…ECS Fargate…`.
  - Artifacts tab renders the API list → the 5th (`security-groups.json`) flows in
    automatically; verify.
  - "What gets created" summary: add a **Network** row (per-app SG · internal ALB ·
    egress allowlist) — admin-appropriate.

## Changes — frontend tests (~99%)

- `employee.test.tsx`: the peek-reveals-`iam-trust-policy.json` assertion (lines ~83-85)
  → assert the plain-language summary text appears (e.g. "Private space", "spending"),
  and that no raw artifact filename is shown to the employee.
- `admin.test.tsx`: "App Runner" → "ECS Fargate"; artifacts tab now lists 5 files.

## E2E demo scripts (must update — they reference the removed peek)

`e2e/record.mjs` (line ~56) and `e2e/shots.mjs` (line ~42) both click
**"Peek under the hood"**. Removing it breaks both. Update `record.mjs` to the new
employee Done page (screenshot the plain-language summary; the technical artifacts are
shown in the **admin** Artifacts tab scroll instead).

## Verify + record

1. `docker compose up --build -d` (port 8090; backend chown fix already applied).
2. Backend `uv run pytest --cov=app` → 100%. Frontend `npm run typecheck` + `npm run coverage`.
3. Playwright MCP: full employee flow (paste mdn repo → scan → details → safety →
   submit → plain-language Done) + admin (submissions → Artifacts tab shows 5 incl
   `security-groups.json` → Approve → Live).
4. Record video via updated `e2e/record.mjs` with `E2E_BASE=http://localhost:8090`.

## Success criteria

- 5 artifacts; trust policy assumable by `ecs-tasks.amazonaws.com`; deploy.yaml is
  `ecs-fargate` with auto-derived cpu/memory blocks.
- `security-groups.json` exists and passes the adversarial test (no public inbound, no
  open egress, no IGW route).
- Employee Done page shows **zero** technical config; admin Artifacts tab shows all five.
- Backend 100% coverage, frontend ~99%, Playwright MCP flow green, demo video recorded.
