# ECS Fargate Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Note:** this repo is NOT a git repository — skip the per-task `git commit` steps; verify with the test command instead.

**Goal:** Swap the emitted compute from App Runner to ECS Fargate and add a generated, adversarially-tested per-app network-control artifact (`security-groups.json`), while stripping all technical config from the employee view.

**Architecture:** Backend pure modules (`compute`, `artifacts`, `manifest`) derive everything from the slug + scanned runtime; the per-app task role + per-app security group are the isolation atoms. Frontend: employee sees plain-language reassurance only; admin sees all five artifacts.

**Tech Stack:** FastAPI (Python 3.12, uv, pytest 100% cov), React 18 + TS strict (vitest ~99%), Playwright (MCP test + `e2e/record.mjs` video).

---

## File structure

**Backend**
- Create `backend/app/compute.py` — Fargate task-size blocks, `task_size(runtime)`.
- Modify `backend/app/artifacts.py` — ECS trust principal; new `security_groups()`; ECS `deploy_config`; 5th artifact.
- Modify `backend/app/manifest.py` — runtime type `ecs-fargate`, cpu/mem block, `network` block.
- Modify `backend/app/settings.py` — add `ecs_cluster`; flip `apps_domain` → `apps.internal`.
- Create `backend/tests/test_compute.py`.
- Modify `backend/tests/test_artifacts.py` — principal, 5 artifacts, SG adversarial, ECS deploy.
- Possibly modify `backend/tests/test_settings.py` (if it pins `apps_domain`).

**Frontend**
- Modify `frontend/src/types.ts` — drop `showPeek`.
- Modify `frontend/src/components/TweaksPanel.tsx` — drop `showPeek` default + toggle.
- Modify `frontend/src/employee/EmployeeFlow.tsx` — replace raw-artifact peek with plain-language card; drop `peek` state; live URL `.apps.internal`.
- Modify `frontend/src/admin/AdminConsole.tsx` — Fargate strings; add Network summary row.
- Modify `frontend/src/test/employee.test.tsx` — update peek assertion.

**E2E**
- Modify `frontend/e2e/record.mjs` — remove the "Peek under the hood" step; screenshot the plain-language card.

---

## Task 1: Fargate task-size blocks (`compute.py`)

**Files:**
- Create: `backend/app/compute.py`
- Test: `backend/tests/test_compute.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_compute.py
"""Fargate task-size blocks — auto-derived from the scanned language runtime.
The employee never picks compute; the platform maps runtime -> a valid Fargate combo."""

from app.compute import VALID_FARGATE, task_size


def test_python_maps_to_one_vcpu_two_gb():
    s = task_size("python")
    assert s["cpu"] == 1024 and s["memory"] == 2048
    assert s["cpuLabel"] == "1 vCPU" and s["memoryLabel"] == "2 GB"


def test_static_is_smallest_block():
    s = task_size("static")
    assert (s["cpu"], s["memory"]) == (256, 512)


def test_node_block():
    s = task_size("node")
    assert (s["cpu"], s["memory"]) == (512, 1024)


def test_unknown_runtime_falls_back_to_safe_default():
    s = task_size("rust-something")
    assert (s["cpu"], s["memory"]) == (512, 1024)


def test_every_block_is_a_valid_fargate_combo():
    for runtime in ("static", "node", "python", "anything"):
        s = task_size(runtime)
        assert s["memory"] in VALID_FARGATE[s["cpu"]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_compute.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.compute'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/compute.py
"""Fargate task-size selection.

ECS Fargate (like App Runner) only accepts fixed CPU/memory combinations. The
employee never chooses compute — the platform derives a sensible, valid block from
the scanned language runtime. This keeps the wizard at five friendly questions.

CPU is in Fargate units (1024 = 1 vCPU); memory in MiB.
"""

from __future__ import annotations

# A subset of the Fargate-valid CPU -> allowed-memory matrix (enough for our blocks).
VALID_FARGATE: dict[int, set[int]] = {
    256: {512, 1024, 2048},
    512: {1024, 2048, 3072, 4096},
    1024: {2048, 3072, 4096, 5120, 6144, 7168, 8192},
    2048: {4096, 5120, 6144, 7168, 8192},
}

# runtime (from scanner) -> (cpu units, memory MiB)
_BLOCKS: dict[str, tuple[int, int]] = {
    "static": (256, 512),
    "node": (512, 1024),
    "python": (1024, 2048),
}
_DEFAULT = (512, 1024)

_LABEL = {256: "0.25 vCPU", 512: "0.5 vCPU", 1024: "1 vCPU", 2048: "2 vCPU"}


def task_size(runtime: str) -> dict:
    """Resolve a language runtime to a valid Fargate task size block."""
    cpu, memory = _BLOCKS.get(runtime, _DEFAULT)
    return {
        "cpu": cpu,
        "memory": memory,
        "cpuLabel": _LABEL[cpu],
        "memoryLabel": f"{memory // 1024} GB" if memory % 1024 == 0 else f"{memory} MB",
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_compute.py -q`
Expected: PASS (5 passed).

---

## Task 2: ECS trust policy

**Files:**
- Modify: `backend/app/artifacts.py:30-51` (`trust_policy`)
- Modify: `backend/app/settings.py` (add `ecs_cluster`)
- Modify: `backend/app/config.py` (export `ECS_CLUSTER`)
- Test: `backend/tests/test_artifacts.py:25-30`

- [ ] **Step 1: Update the failing test first**

Replace `test_trust_policy_scoped_to_this_app_only` in `backend/tests/test_artifacts.py`:

```python
def test_trust_policy_assumable_only_by_ecs_tasks(sample_submission):
    pol = json.loads(trust_policy(sample_submission))
    stmt = pol["Statement"][0]
    assert stmt["Principal"]["Service"] == "ecs-tasks.amazonaws.com"
    src_arn = stmt["Condition"]["ArnLike"]["aws:SourceArn"]
    assert ":task/" in src_arn and "vibeapp-apps" in src_arn
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd backend && uv run pytest tests/test_artifacts.py::test_trust_policy_assumable_only_by_ecs_tasks -q`
Expected: FAIL — principal is still `tasks.apprunner.amazonaws.com`.

- [ ] **Step 3: Add the setting**

In `backend/app/settings.py`, under "AWS placement" add:

```python
    ecs_cluster: str = "vibeapp-apps"
```

And flip the domain:

```python
    apps_domain: str = "apps.internal"
```

In `backend/app/config.py` add after `APPS_BUCKET`:

```python
ECS_CLUSTER = _s.ecs_cluster
```

- [ ] **Step 4: Rewrite `trust_policy`**

In `backend/app/artifacts.py`, update the import block to include `ECS_CLUSTER`, then replace `trust_policy`:

```python
def trust_policy(sub: Submission) -> str:
    slug = sub.slug
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "EcsTaskAssume",
                    "Effect": "Allow",
                    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                    "Condition": {
                        "StringEquals": {"aws:SourceAccount": AWS_ACCOUNT},
                        "ArnLike": {
                            "aws:SourceArn": f"arn:aws:ecs:{AWS_REGION}:{AWS_ACCOUNT}:task/{ECS_CLUSTER}/*"
                        },
                    },
                }
            ],
        },
        indent=2,
    )
```

- [ ] **Step 5: Run trust + settings tests**

Run: `cd backend && uv run pytest tests/test_artifacts.py::test_trust_policy_assumable_only_by_ecs_tasks tests/test_settings.py -q`
Expected: PASS. If `test_settings.py` pins `apps_domain == "apps.alice.io"`, update that literal to `"apps.internal"`.

---

## Task 3: `security-groups.json` artifact + adversarial test

**Files:**
- Modify: `backend/app/artifacts.py` (add `security_groups`, wire into `generate_artifacts`)
- Test: `backend/tests/test_artifacts.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_artifacts.py`:

```python
from app.artifacts import security_groups  # add to existing import block


def test_security_groups_no_public_inbound_no_open_egress(sample_submission):
    sg = json.loads(security_groups(sample_submission))
    task = sg["taskSg"]
    # Inbound only from the ALB SG, on the app port — never the open internet.
    assert task["ingress"] == [
        {"from": "albSg", "protocol": "tcp", "port": sample_submission.repo.port}
    ]
    assert all(rule["from"] != "0.0.0.0/0" for rule in task["ingress"])
    # Egress is deny-by-default with an explicit allowlist — never 0.0.0.0/0.
    assert task["egressDefault"] == "deny"
    assert all(rule["to"] != "0.0.0.0/0" for rule in task["egress"])
    allow = {rule["to"] for rule in task["egress"]}
    assert allow == {"egress-proxy-sg", "ai-gateway-sg", "rds-proxy-sg"}
    # The structural invariant: app subnet has no route to an internet gateway.
    assert task["internetGatewayRoute"] is False


def test_alb_is_internal(sample_submission):
    sg = json.loads(security_groups(sample_submission))
    assert sg["albSg"]["scheme"] == "internal"
```

Also extend the artifact-set test:

```python
def test_generates_five_named_artifacts(sample_submission):
    files = {a.file for a in generate_artifacts(sample_submission)}
    assert files == {
        "iam-trust-policy.json",
        "iam-permissions.json",
        "security-groups.json",
        "deploy.yaml",
        "secrets-bootstrap.sh",
    }
```

Delete the old `test_generates_four_named_artifacts`.

- [ ] **Step 2: Run, watch fail**

Run: `cd backend && uv run pytest tests/test_artifacts.py -q`
Expected: FAIL — `security_groups` undefined; five-artifact set mismatch.

- [ ] **Step 3: Implement `security_groups`**

Add to `backend/app/artifacts.py` (after `permissions_policy`):

```python
def security_groups(sub: Submission) -> str:
    """Per-app network boundary — the inbound/outbound control App Runner can't express.

    Inbound: the task is reachable only from the internal ALB, on its own port. Outbound:
    deny-by-default with an allowlist to the egress proxy, the AI gateway (Bedrock has no
    public path), and the RDS proxy. The app subnet has no route to an internet gateway —
    that is the structural egress invariant from the platform design. Derived from the
    slug/port; a tenant cannot widen it. Tests assert these properties.
    """
    return json.dumps(
        {
            "albSg": {
                "scheme": "internal",
                "ingress": [
                    {
                        "from": "com.amazonaws.global.cloudfront.origin-facing",
                        "protocol": "tcp",
                        "port": 443,
                    }
                ],
            },
            "taskSg": {
                "ingress": [
                    {"from": "albSg", "protocol": "tcp", "port": sub.repo.port}
                ],
                "egress": [
                    {"to": "egress-proxy-sg", "note": "allowlisted outbound only"},
                    {"to": "ai-gateway-sg", "note": "Bedrock via gateway — no public path"},
                    {"to": "rds-proxy-sg", "note": "data tier via proxy"},
                ],
                "egressDefault": "deny",
                "internetGatewayRoute": False,
            },
        },
        indent=2,
    )
```

- [ ] **Step 4: Wire into `generate_artifacts`**

In `backend/app/artifacts.py`, add the artifact between permissions and deploy:

```python
        Artifact(
            file="security-groups.json",
            lang="json",
            body=security_groups(sub),
            label="Network security groups",
            note="Inbound from the internal ALB only; egress deny-by-default to an allowlist. No internet-gateway route.",
        ),
```

- [ ] **Step 5: Run all artifact tests**

Run: `cd backend && uv run pytest tests/test_artifacts.py -q`
Expected: PASS.

---

## Task 4: ECS Fargate `deploy.yaml`

**Files:**
- Modify: `backend/app/artifacts.py:98-138` (`deploy_config`)
- Test: `backend/tests/test_artifacts.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_artifacts.py`:

```python
from app.artifacts import deploy_config  # add to import block
from app.compute import task_size


def test_deploy_is_ecs_fargate_with_block_sizing_and_circuit_breaker(sample_submission):
    y = deploy_config(sample_submission)
    assert "type: ecs-fargate" in y
    size = task_size(sample_submission.repo.runtime)
    assert f"cpu: {size['cpu']}" in y and f"memory: {size['memory']}" in y
    assert "deploymentCircuitBreaker" in y and "rollback: true" in y
    assert "securityGroups: ./security-groups.json" in y
    assert "apprunner" not in y
```

- [ ] **Step 2: Run, watch fail**

Run: `cd backend && uv run pytest tests/test_artifacts.py::test_deploy_is_ecs_fargate_with_block_sizing_and_circuit_breaker -q`
Expected: FAIL — still `type: apprunner`.

- [ ] **Step 3: Rewrite `deploy_config`**

In `backend/app/artifacts.py`, add `from app.compute import task_size` to the imports, then replace the `runtime:` lines (currently the App Runner block at ~113-120) so the `lines` list reads:

```python
    size = task_size(sub.repo.runtime)
    lines = [
        "# deploy.yaml — generated by Vibeapp. Hand off to the provisioner as-is.",
        "apiVersion: vibeapp.alice.io/v1",
        "kind: AppDeployment",
        "metadata:",
        f"  name: {slug}",
        f"  owner: {sub.owner_email}",
        f"  team: {sub.team}",
        "source:",
        f"  repo: {_bare_repo(sub.repo_url)}",
        f"  ref: {sub.repo.ref}",
        f"  commit: {sub.repo.commit}",
        "runtime:",
        "  type: ecs-fargate",
        f"  cluster: {ECS_CLUSTER}",
        "  task:",
        f"    cpu: {size['cpu']}        # {size['cpuLabel']}",
        f"    memory: {size['memory']}     # {size['memoryLabel']}",
        f"    port: {sub.repo.port}",
        "    healthCheck: { path: /healthz, interval: 10 }",
        "  service:",
        "    desiredCount: 1",
        "    deploymentCircuitBreaker: { enable: true, rollback: true }",
        "    subnets: private-app",
        "    securityGroup: taskSg",
        "    albTargetGroup: { scheme: internal, port: 443 }",
        "iam:",
        "  taskRole:",
        "    trustPolicy: ./iam-trust-policy.json",
        "    permissions: ./iam-permissions.json",
        "  executionRole: platform-shared",
        "securityGroups: ./security-groups.json",
        "env:",
        "  - { name: APP_ENV, value: production }",
        f"  - {{ name: MODEL_ID, value: {model.model_id} }}",
        f"  - {{ name: OBS_MCP_ENDPOINT, value: {OBS_MCP_ENDPOINT} }}",
        "guardrails:",
        f"  modelAllowlist: [{model.model_id}]",
        f"  monthlyBudgetUsd: {sub.budget}",
        "  piiScan: true",
        "  promptInjectionShield: true",
        f"  humanInLoop: {str(sub.budget >= HUMAN_IN_LOOP_BUDGET_USD).lower()}",
        "observability:",
        "  tracing: true",
        f"  attribution: {{ app: {slug}, owner: {sub.owner_email} }}",
    ]
    return "\n".join(lines)
```

Add `ECS_CLUSTER` to the `from app.config import (...)` block.

- [ ] **Step 4: Run artifact tests**

Run: `cd backend && uv run pytest tests/test_artifacts.py -q`
Expected: PASS.

---

## Task 5: Manifest runtime + network block

**Files:**
- Modify: `backend/app/manifest.py:40-61`
- Test: covered by `backend/tests/test_validation.py` (build_manifest) — add one assertion.

- [ ] **Step 1: Add a failing assertion**

Add to `backend/tests/test_validation.py`:

```python
def test_manifest_runtime_is_fargate_with_network_block(sample_submission):
    m = build_manifest(sample_submission)
    assert m["runtime"]["type"] == "ecs-fargate"
    assert m["network"]["internetGatewayRoute"] is False
    assert "ai-gateway" in m["network"]["egressAllowlist"]
```

- [ ] **Step 2: Run, watch fail**

Run: `cd backend && uv run pytest tests/test_validation.py::test_manifest_runtime_is_fargate_with_network_block -q`
Expected: FAIL — type still `apprunner`, no `network` key.

- [ ] **Step 3: Update `build_manifest`**

In `backend/app/manifest.py`, add `from app.compute import task_size` and replace the `runtime` dict + add a `network` dict:

```python
        "runtime": {
            "type": "ecs-fargate",
            "framework": sub.repo.framework,
            "port": sub.repo.port,
            "cpu": task_size(sub.repo.runtime)["cpu"],
            "memory": task_size(sub.repo.runtime)["memory"],
        },
        "network": {
            "ingress": "private",
            "egressAllowlist": ["egress-proxy", "ai-gateway", "rds-proxy"],
            "internetGatewayRoute": False,
        },
```

(Insert the `network` key right after `runtime`.)

- [ ] **Step 4: Run manifest + full backend**

Run: `cd backend && uv run pytest --cov=app -q`
Expected: PASS, coverage 100%.

---

## Task 6: Employee Done page — plain-language card

**Files:**
- Modify: `frontend/src/types.ts:158` (drop `showPeek`)
- Modify: `frontend/src/components/TweaksPanel.tsx:14,236` (drop default + toggle)
- Modify: `frontend/src/employee/EmployeeFlow.tsx` (StepDone + state)
- Test: `frontend/src/test/employee.test.tsx:83-85`

- [ ] **Step 1: Update the failing test**

In `frontend/src/test/employee.test.tsx`, replace the peek block (lines ~83-85):

```tsx
    // Employee sees a plain-language summary — no raw technical artifacts.
    expect(await screen.findByText(/What we handled for you/i)).toBeInTheDocument();
    expect(screen.getByText(/Private space/i)).toBeInTheDocument();
    expect(screen.queryByText("iam-trust-policy.json")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run, watch fail**

Run: `cd frontend && npx vitest run src/test/employee.test.tsx -t "full flow" 2>&1 | tail -20`
Expected: FAIL — "What we handled for you" not found.

- [ ] **Step 3: Drop `showPeek` from types + tweaks**

`frontend/src/types.ts`: delete the line `showPeek: boolean;`.
`frontend/src/components/TweaksPanel.tsx`: delete `showPeek: true,` (line ~14) and the `<Toggle label="Peek under the hood" ... />` line (~236).

- [ ] **Step 4: Replace the peek block in `StepDone`**

In `frontend/src/employee/EmployeeFlow.tsx`, replace the whole `{t.showPeek && ( ... )}` block (lines ~610-630) with:

```tsx
      <div className="card" style={{ marginTop: 16, padding: "var(--pad)", textAlign: "left" }}>
        <div className="mono-label" style={{ color: "var(--accent)" }}>What we handled for you</div>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {[
            ["lock", "Private space just for your app", "Your own isolated storage, secrets, and identity."],
            ["dollar", `$${submission.budget}/mo spending cap`, "We pause and email you before it goes over."],
            ["shield", "Security guardrails on", "Prompt-injection shield and personal-info scanning by default."],
            ["globe", "Reachable only inside Alice", "No public internet access — staff behind SSO only."],
          ].map(([ic, title, sub]) => (
            <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", flex: "none", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name={ic as Parameters<typeof Icon>[0]["name"]} size={16} /></span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
```

Then remove the now-unused `peek`/`setPeek` from `StepDoneProps`, the `StepDone` signature, the call site (line ~177), the `useState` at line ~55, and the `setPeek(false)` at line ~138. Also drop `artifacts` from the `const { submission, artifacts } = detail;` destructure (line 577) → `const { submission } = detail;`.

> **Icon check:** if `dollar` or `globe` are not valid `IconName`s, substitute existing ones (`zap`/`shield`/`lock`/`check`). Verify against `frontend/src/components/Icon.tsx`.

- [ ] **Step 5: Fix the live URL domain**

In `frontend/src/employee/EmployeeFlow.tsx:581`, change `${submission.slug}.apps.alice.io` → `${submission.slug}.apps.internal`.

- [ ] **Step 6: Run employee tests + typecheck**

Run: `cd frontend && npm run typecheck && npx vitest run src/test/employee.test.tsx 2>&1 | tail -20`
Expected: PASS.

---

## Task 7: Admin — Fargate strings + network row

**Files:**
- Modify: `frontend/src/admin/AdminConsole.tsx:230,256,301`

- [ ] **Step 1: Swap the runtime strings**

`AdminConsole.tsx:301`: `· AWS App Runner` → `· AWS ECS Fargate`.
`AdminConsole.tsx:230`: `Provisioning on AWS App Runner…` → `Provisioning on AWS ECS Fargate…`.

- [ ] **Step 2: Add a Network row to "What gets created"**

In `AdminConsole.tsx`, the `rows` array in `TabSummary` (line ~255), add:

```tsx
    ["shield", "Network", `per-app SG · internal ALB · egress allowlist (no internet-gateway route)`],
```

- [ ] **Step 3: Typecheck + admin tests**

Run: `cd frontend && npm run typecheck && npx vitest run src/test/admin.test.tsx 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 4: Full frontend coverage**

Run: `cd frontend && npm run coverage 2>&1 | tail -25`
Expected: PASS, ~99%.

---

## Task 8: Update the demo recorder

**Files:**
- Modify: `frontend/e2e/record.mjs:54-58` (the "Peek under the hood" step)

- [ ] **Step 1: Replace the peek step**

In `frontend/e2e/record.mjs`, replace:

```js
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await pause(page, 900);
  await page.getByRole("button", { name: /Peek under the hood/ }).click();
  await pause(page, 1500);
```

with:

```js
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await pause(page, 900);
  await page.getByText(/What we handled for you/i).waitFor({ timeout: 4000 });
  await pause(page, 1600); // let the plain-language summary read
```

- [ ] **Step 2: (No run yet — recorded in the verify phase below.)**

---

## Verify + record (final phase)

- [ ] **Backend gate:** `cd backend && uv run pytest --cov=app -q` → 100%.
- [ ] **Frontend gate:** `cd frontend && npm run typecheck && npm run coverage` → ~99%.
- [ ] **Rebuild Docker:** `docker compose up --build -d` (port 8090).
- [ ] **Playwright MCP:** drive employee flow (paste `https://github.com/mdn/beginner-html-site-styled` → scan → details → safety → submit → assert plain-language card, NO raw artifacts) + admin (Artifacts tab shows 5 incl `security-groups.json` → Approve → Live).
- [ ] **Record:** `cd frontend && E2E_BASE=http://localhost:8090 node e2e/record.mjs` → `docs/videos/*.webm`.

## Success criteria

- 5 artifacts; trust → `ecs-tasks.amazonaws.com`; deploy `ecs-fargate` + block sizing + circuit breaker.
- `security-groups.json` passes adversarial test (no public inbound / no open egress / no IGW route).
- Employee Done = zero technical config; admin Artifacts tab = all five.
- Backend 100%, frontend ~99%, Playwright MCP green, video recorded.
