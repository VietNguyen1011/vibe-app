import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { CodeBlock, highlight } from "../components/CodeBlock";
import { useApprove, usePatchSubmission, useSubmission, useSubmissions } from "../api/queries";
import type {
  CostProjection,
  ModelOption,
  Status,
  Submission,
  SubmissionDetail,
  ValidationCheck,
} from "../types";

const APPS_BUCKET = "alice-internal-apps";

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  review: { label: "Needs review", cls: "badge-review" },
  provisioning: { label: "Provisioning", cls: "badge-prov" },
  live: { label: "Live", cls: "badge-live" },
  failed: { label: "Failed", cls: "badge-failed" },
};

type Tab = "summary" | "manifest" | "validation" | "artifacts" | "cost";

export function AdminConsole({ models, onToast }: { models: ModelOption[]; onToast: (m: string) => void }) {
  const { data: submissions = [] } = useSubmissions();
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("summary");

  const sel = submissions.find((s) => s.id === selId) ?? submissions[0];
  const { data: detail } = useSubmission(sel?.id);

  // Keep a valid selection as the queue changes.
  useEffect(() => {
    if (submissions.length && !submissions.find((s) => s.id === selId)) {
      setSelId(submissions[0]?.id);
    }
  }, [submissions, selId]);

  const approve = useApprove();
  const patch = usePatchSubmission();

  const liveCount = submissions.filter((s) => s.status === "live").length;
  const reviewCount = submissions.filter((s) => s.status === "review").length;
  const totalSpend = submissions.reduce((a, s) => a + (s.spendThisMonth || 0), 0);

  async function onApprove(s: Submission) {
    await approve.mutateAsync(s.id);
    onToast(`Provisioning ${s.slug}…`);
  }
  async function onPatch(id: string, status: Status, toast: string) {
    await patch.mutateAsync({ id, status });
    onToast(toast);
  }

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "26px clamp(18px,4vw,40px) 80px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
        <Stat icon="rocket" label="Apps live" value={liveCount} />
        <Stat icon="eye" label="Awaiting review" value={reviewCount} accent={reviewCount > 0} />
        <Stat icon="dollar" label="Spend this month" value={`$${totalSpend}`} sub="across all apps" />
        <Stat icon="shield" label="Guardrail blocks (7d)" value="14" sub="prompt-injection + budget" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 22, alignItems: "start" }} className="lp-admin-grid">
        <div className="card" style={{ overflow: "hidden", position: "sticky", top: 80 }}>
          <div style={{ padding: "15px 18px", borderBottom: "var(--hair) solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>Submissions</span>
            <span className="chip" style={{ padding: "3px 9px", fontSize: 12 }}>{submissions.length}</span>
          </div>
          <ul style={{ maxHeight: "64vh", overflowY: "auto", listStyle: "none", margin: 0, padding: 0 }}>
            {submissions.map((s) => {
              const m = STATUS_META[s.status];
              const on = s.id === sel?.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => {
                      setSelId(s.id);
                      setTab("summary");
                    }}
                    aria-current={on ? "true" : undefined}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "block",
                      padding: "14px 18px",
                      border: "none",
                      borderLeft: "3px solid " + (on ? "var(--accent)" : "transparent"),
                      borderBottom: "var(--hair) solid var(--border)",
                      background: on ? "var(--accent-wash)" : "transparent",
                      transition: ".12s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.appName}</span>
                      <span className={"badge " + m.cls}>{m.label}</span>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 3, fontFamily: "var(--font-mono)" }}>{s.ownerEmail.split("@")[0]} · {s.submittedAt}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {sel && <AdminDetail sel={sel} detail={detail} models={models} tab={tab} setTab={setTab} onApprove={onApprove} onPatch={onPatch} />}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, accent }: { icon: IconName; label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ width: 42, height: 42, borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", flex: "none", background: accent ? "var(--accent)" : "var(--accent-wash)", color: accent ? "var(--accent-ink)" : "var(--accent)" }}>
        <Icon name={icon} size={20} />
      </span>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1 }}>{value}</div>
        <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 4 }}>{label}{sub && <span style={{ color: "var(--faint)" }}> · {sub}</span>}</div>
      </div>
    </div>
  );
}

function modelLabel(models: ModelOption[], id: string): ModelOption {
  return (
    models.find((m) => m.id === id) ?? { id, label: id, blurb: "", modelId: id, inPer1k: 0, outPer1k: 0, recommended: false }
  );
}

interface AdminDetailProps {
  sel: Submission;
  detail: SubmissionDetail | undefined;
  models: ModelOption[];
  tab: Tab;
  setTab: (t: Tab) => void;
  onApprove: (s: Submission) => void;
  onPatch: (id: string, status: Status, toast: string) => void;
}
function AdminDetail({ sel, detail, models, tab, setTab, onApprove, onPatch }: AdminDetailProps) {
  const model = modelLabel(models, sel.modelId);
  const m = STATUS_META[sel.status];
  const tabs: Array<[Tab, string]> = [
    ["summary", "Summary"],
    ["manifest", "Manifest"],
    ["validation", "Validation"],
    ["artifacts", "Artifacts"],
    ["cost", "Cost & guardrails"],
  ];

  return (
    <div className="card rise" style={{ overflow: "hidden" }}>
      <div style={{ padding: "var(--pad)", borderBottom: "var(--hair) solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>{sel.appName}</h2>
              <span className={"badge " + m.cls}>{m.label}</span>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 5 }}>{sel.description || "No description provided."}</p>
            <a href={sel.repoUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
              <Icon name="github" size={15} /> {sel.repoUrl.replace(/^https?:\/\//, "")} <Icon name="external" size={13} />
            </a>
          </div>
          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
            <div>owner&nbsp;&nbsp;<span style={{ color: "var(--text-2)" }}>{sel.ownerEmail}</span></div>
            <div>team&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "var(--text-2)" }}>{sel.team}</span></div>
            <div>commit&nbsp;<span style={{ color: "var(--text-2)" }}>{sel.repo.commit}</span></div>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Submission detail" style={{ display: "flex", gap: 4, padding: "0 var(--pad)", borderBottom: "var(--hair) solid var(--border)", overflowX: "auto" }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              border: "none",
              background: "none",
              padding: "14px 14px 12px",
              fontSize: 14,
              fontWeight: 650,
              whiteSpace: "nowrap",
              color: tab === id ? "var(--text)" : "var(--muted)",
              borderBottom: "2px solid " + (tab === id ? "var(--accent)" : "transparent"),
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: "var(--pad)" }}>
        {!detail ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)" }} role="status">
            <div className="spinner" /> Loading…
          </div>
        ) : (
          <>
            {tab === "summary" && <TabSummary sel={sel} model={model} cost={detail.cost} />}
            {tab === "manifest" && (
              <div>
                <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 14 }}>The validated app manifest. This is the single source of truth — every artifact below is derived from it.</p>
                <CodeBlock file="vibeapp.manifest.json" lang="json" body={JSON.stringify(detail.manifest, null, 2)} />
              </div>
            )}
            {tab === "validation" && <TabValidation checks={detail.validation} />}
            {tab === "artifacts" && <TabArtifacts artifacts={detail.artifacts} />}
            {tab === "cost" && <TabCost sel={sel} model={model} cost={detail.cost} />}
          </>
        )}
      </div>

      <div style={{ padding: "16px var(--pad)", borderTop: "var(--hair) solid var(--border)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {sel.status === "review" && (
          <>
            <button className="btn btn-primary" onClick={() => onApprove(sel)}><Icon name="check" size={18} /> Approve &amp; provision</button>
            <button className="btn btn-ghost" onClick={() => onPatch(sel.id, "review", "Changes requested — owner notified")}><Icon name="chevronRight" size={16} /> Request changes</button>
            <div style={{ flex: 1 }} />
            <span style={{ color: "var(--muted)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="shield" size={15} /> Approving hands the artifacts to the DevOps provisioner.</span>
          </>
        )}
        {sel.status === "provisioning" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontWeight: 650 }}><span className="spinner" /> Provisioning on AWS App Runner…</span>
        )}
        {sel.status === "live" && (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 700, color: "var(--ok)" }}><Icon name="check" size={18} /> Live</span>
            <a className="btn btn-ghost btn-sm" href={"https://" + sel.liveUrl} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{sel.liveUrl} <Icon name="external" size={14} /></a>
            <div style={{ flex: 1 }} />
            <button className="btn btn-quiet btn-sm" onClick={() => onPatch(sel.id, "review", "App retired — moved back to review")}>Retire app</button>
          </>
        )}
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "var(--hair) solid var(--border)" }}>
      <div className="mono-label">{k}</div>
      <div style={{ marginTop: 5, fontWeight: 600, fontSize: 14.5, fontFamily: mono ? "var(--font-mono)" : "inherit", wordBreak: "break-word" }}>{v}</div>
    </div>
  );
}

function TabSummary({ sel, model, cost }: { sel: Submission; model: ModelOption; cost: CostProjection }) {
  const rows: Array<[IconName, string, string]> = [
    ["box", "IAM role", `vibeapp-${sel.slug} — assumable only by this app's runtime`],
    ["database", "S3 prefix", `s3://${APPS_BUCKET}/${sel.slug}/* — isolated from every other app`],
    ["lock", "Secrets namespace", `apps/${sel.slug}/* — ${sel.secrets.length} keys`],
    ["brain", "Bedrock allowlist", `${model.label} only`],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 28 }} className="lp-2col">
      <div>
        <h4 style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>What gets created</h4>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {rows.map(([ic, a, b]) => (
            <div key={a} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)", flex: "none", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name={ic} size={17} /></span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{b}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 22, padding: 18, background: "var(--surface-2)", boxShadow: "none" }}>
          <div className="mono-label" style={{ color: "var(--accent)" }}>Ownership boundary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Vibeapp (us)</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)", fontSize: 13, lineHeight: 1.7 }}>
                <li>Manifest + artifact generation</li>
                <li>Guardrails, allowlists, budgets</li>
                <li>Per-app cost + trace attribution</li>
              </ul>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>DevOps team</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)", fontSize: 13, lineHeight: 1.7 }}>
                <li>The provisioner that applies them</li>
                <li>Shared VPC, base AMIs, the S3 bucket</li>
                <li>On-call for the platform itself</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div>
        <KV k="App id" v={sel.slug} mono />
        <KV k="Runtime" v={`${sel.repo.framework} · AWS App Runner`} />
        <KV k="Model (Bedrock)" v={model.modelId} mono />
        <KV k="Monthly budget" v={`$${sel.budget}`} mono />
        <KV k="Projected spend" v={cost ? `~$${cost.monthly}/mo · ${cost.callsPerDay} calls/day` : "—"} mono />
        <KV k="Human-in-the-loop" v={sel.budget >= 500 ? "Required (budget ≥ $500)" : "Not required"} />
      </div>
    </div>
  );
}

function TabValidation({ checks }: { checks: ValidationCheck[] }) {
  const pass = checks.filter((c) => c.ok && !c.warn).length;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <span className="chip chip-ok"><Icon name="check" size={13} /> {pass} passed</span>
        {checks.some((c) => c.warn) && <span className="chip chip-warn"><Icon name="shield" size={13} /> {checks.filter((c) => c.warn).length} auto-resolved</span>}
      </div>
      <div className="code" style={{ padding: 0 }}>
        {checks.map((c, i) => (
          <div key={c.id} style={{ display: "flex", gap: 13, padding: "13px 16px", borderBottom: i < checks.length - 1 ? "var(--hair) solid var(--border)" : "none", alignItems: "flex-start" }}>
            <Icon name={c.warn ? "shield" : "check"} size={16} strokeWidth={2.2} style={{ color: c.warn ? "var(--warn)" : "var(--ok)", marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{c.friendly}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5, fontFamily: "var(--font-mono)", marginTop: 3 }}>{c.technical}</div>
            </div>
            <span className={"badge " + (c.warn ? "badge-review" : "badge-live")}>{c.warn ? "fixed" : "pass"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabArtifacts({ artifacts }: { artifacts: SubmissionDetail["artifacts"] }) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Generated from the manifest, ready for the provisioner. Vibeapp produces these; the DevOps provisioner consumes them. Nothing here was hand-written.</p>
      {artifacts.map((a) => (
        <div key={a.file}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{a.label}</span>
            <span style={{ display: "block", color: "var(--faint)", fontSize: 12.5, marginTop: 2 }}>{a.note}</span>
          </div>
          <CodeBlock file={a.file} lang={a.lang} body={a.body} />
        </div>
      ))}
    </div>
  );
}

function TabCost({ sel, model, cost }: { sel: Submission; model: ModelOption; cost: CostProjection }) {
  const pct = Math.min(100, Math.round(((sel.spendThisMonth || cost.monthly) / sel.budget) * 100));
  const over = pct >= 80;
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <h4 style={{ fontSize: 14, fontWeight: 800 }}>Budget this month</h4>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}><strong>${sel.spendThisMonth || 0}</strong> <span style={{ color: "var(--muted)" }}>/ ${sel.budget}</span></span>
        </div>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used" style={{ height: 12, borderRadius: 99, background: "var(--surface-2)", border: "var(--hair) solid var(--border)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: over ? "var(--warn)" : "var(--accent)", borderRadius: 99, transition: "width .5s" }} />
        </div>
        <p className="field-help" style={{ marginTop: 8 }}>At 80% Vibeapp emails the owner. At 100% the app pauses automatically — no surprise bills.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <MiniStat label="Token cost / call" value={`$${cost.perCall}`} />
        <MiniStat label="Calls / day" value={cost.callsPerDay} />
        <MiniStat label="Projected" value={`$${cost.monthly}/mo`} />
      </div>

      <div>
        <h4 style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>LLM pricing — {model.label}</h4>
        <div className="code">
          <pre
            className="code-body"
            dangerouslySetInnerHTML={{
              __html: highlight(
                `input    $${model.inPer1k.toFixed(4)} / 1K tokens
output   $${model.outPer1k.toFixed(4)} / 1K tokens
# every call is tagged app=${sel.slug} owner=${sel.ownerEmail.split("@")[0]}
# traces flow to obs.platform.alice.io/mcp across the whole tool-call chain`,
                "bash"
              ),
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: "14px 16px", boxShadow: "none", background: "var(--surface-2)" }}>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)", letterSpacing: "-.02em" }}>{value}</div>
      <div className="mono-label" style={{ marginTop: 4 }}>{label}</div>
    </div>
  );
}
