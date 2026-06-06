import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Steps, BigCheck } from "../components/Misc";
import { CodeBlock } from "../components/CodeBlock";
import { useCreateSubmission, useScan, useValidate } from "../api/queries";
import type {
  CostProjection,
  ModelOption,
  RepoScan,
  SecretSlot,
  SubmissionDetail,
  SubmissionInput,
  Tweaks,
  User,
  ValidationCheck,
} from "../types";

const TEAMS = ["trust-intel", "research", "adversarial", "product", "marketing", "data"];
const EXAMPLE_REPOS = [
  "github.com/alice-internal/claims-triage",
  "github.com/alice-internal/standup-summarizer",
  "github.com/alice-internal/vendor-risk-bot",
];

function humanize(slug: string): string {
  return (slug || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EmployeeFlowProps {
  t: Tweaks;
  user: User;
  models: ModelOption[];
  onSubmit: () => void;
}

export function EmployeeFlow({ t, user, models, onSubmit }: EmployeeFlowProps) {
  const [step, setStep] = useState(0);
  const [repoUrl, setRepoUrl] = useState("");
  const [scanError, setScanError] = useState("");
  const [repo, setRepo] = useState<RepoScan | null>(null);
  const [appName, setAppName] = useState("");
  const [description, setDescription] = useState("");
  const ownerEmail = user.email;
  const [team, setTeam] = useState(user.team);
  const [modelId, setModelId] = useState("sonnet");
  const [budget, setBudget] = useState(200);
  const [secrets, setSecrets] = useState<SecretSlot[]>([]);
  const [checks, setChecks] = useState<ValidationCheck[]>([]);
  const [cost, setCost] = useState<CostProjection | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [peek, setPeek] = useState(false);

  const scan = useScan();
  const validate = useValidate();
  const create = useCreateSubmission();

  const stepNames = ["Connect", "Details", "Safety check", "Done"];

  const buildInput = (): SubmissionInput => ({
    repoUrl: repoUrl.startsWith("http") ? repoUrl : "https://" + repoUrl,
    repo: repo as RepoScan,
    appName,
    description,
    ownerEmail,
    team,
    modelId,
    budget,
    secrets: secrets.map((s) => ({ key: s.key, set: s.set, platformManaged: s.platformManaged })),
  });

  // Live cost preview while editing details.
  useEffect(() => {
    if (step !== 1 || !repo) return;
    let cancelled = false;
    validate
      .mutateAsync(buildInput())
      .then((r) => !cancelled && setCost(r.cost))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, modelId, budget, appName, description, team]);

  async function doScan() {
    if (!repoUrl.trim()) return;
    setScanError("");
    try {
      const r = await scan.mutateAsync(repoUrl);
      setRepo(r);
      setAppName(humanize(r.name));
      setDescription("");
      setSecrets(
        r.detectedSecrets.map((s) => ({
          key: s.key,
          value: "",
          set: false,
          platformManaged: s.platformManaged,
          reason: s.reason,
        }))
      );
      setTimeout(() => setStep(1), 700);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Couldn't scan that repo.");
    }
  }

  async function goSafety() {
    setStep(2);
    try {
      const r = await validate.mutateAsync(buildInput());
      setChecks(r.validation);
    } catch {
      setChecks([]);
    }
  }

  async function submit() {
    const d = await create.mutateAsync(buildInput());
    setDetail(d);
    onSubmit();
    setStep(3);
  }

  function reset() {
    setStep(0);
    setRepoUrl("");
    setRepo(null);
    setAppName("");
    setDescription("");
    setSecrets([]);
    setModelId("sonnet");
    setBudget(200);
    setPeek(false);
    setDetail(null);
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(20px,4vw,44px) 20px 90px" }}>
      {step < 3 && (
        <div style={{ marginBottom: 30 }} className="rise">
          <Steps steps={stepNames} current={step} />
        </div>
      )}

      {step === 0 && (
        <StepConnect repoUrl={repoUrl} setRepoUrl={setRepoUrl} scanning={scan.isPending} scanError={scanError} doScan={doScan} />
      )}
      {step === 1 && repo && (
        <StepDetails
          t={t}
          repo={repo}
          models={models}
          appName={appName}
          setAppName={setAppName}
          description={description}
          setDescription={setDescription}
          ownerEmail={ownerEmail}
          team={team}
          setTeam={setTeam}
          modelId={modelId}
          setModelId={setModelId}
          budget={budget}
          setBudget={setBudget}
          secrets={secrets}
          setSecrets={setSecrets}
          cost={cost}
          onBack={() => setStep(0)}
          onNext={goSafety}
        />
      )}
      {step === 2 && (
        <StepSafety checking={validate.isPending} checks={checks} onBack={() => setStep(1)} onSubmit={submit} submitting={create.isPending} />
      )}
      {step === 3 && detail && <StepDone t={t} detail={detail} peek={peek} setPeek={setPeek} onReset={reset} />}
    </div>
  );
}

/* ---------- Step 0: Connect ---------- */
interface StepConnectProps {
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  scanning: boolean;
  scanError: string;
  doScan: () => void;
}
function StepConnect({ repoUrl, setRepoUrl, scanning, scanError, doScan }: StepConnectProps) {
  return (
    <div className="rise">
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent)", marginBottom: 14 }}>
          <Icon name="sparkles" size={20} />
          <span className="mono-label" style={{ color: "var(--accent)" }}>From prompt to production</span>
        </div>
        <h1 style={{ fontSize: "clamp(30px,5vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.08, textWrap: "balance" }}>
          Let's get your app live.
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 17, marginTop: 12, maxWidth: 480, marginInline: "auto", textWrap: "pretty" }}>
          Point us at the repo Claude Code made for you. We'll take a look and set everything up safely — nothing goes live until you say so.
        </p>
      </div>

      <div className="card" style={{ padding: "var(--pad)", position: "relative", overflow: "hidden" }}>
        {scanning && <ScanOverlay />}
        <label className="field-label" htmlFor="repo-url">Your GitHub repo</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 280px" }}>
            <Icon name="github" size={19} style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              id="repo-url"
              className="input input-mono"
              style={{ paddingLeft: 44 }}
              placeholder="github.com/alice-internal/my-app"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doScan()}
              aria-describedby="repo-help"
            />
          </div>
          <button className="btn btn-primary" onClick={doScan} disabled={!repoUrl.trim() || scanning}>
            <Icon name="search" size={18} /> Scan my repo
          </button>
        </div>
        <p className="field-help" id="repo-help">We only read your code to understand what it needs. We never run it here.</p>
        {scanError && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="alert" size={15} /> {scanError}
          </p>
        )}

        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--faint)", whiteSpace: "nowrap" }}>Try one:</span>
          {EXAMPLE_REPOS.map((r) => (
            <button key={r} className="chip" style={{ cursor: "pointer" }} onClick={() => setRepoUrl(r)}>
              <Icon name="box" size={13} /> {r.split("/").pop()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 26, marginTop: 24, color: "var(--muted)", fontSize: 13.5, flexWrap: "wrap" }}>
        {([["lock", "Private to Alice"], ["shield", "Guardrails built in"], ["clock", "Live in ~an hour"]] as const).map(([ic, tx]) => (
          <span key={tx} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon name={ic} size={15} /> {tx}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScanOverlay() {
  const lines = ["Reading your code…", "Found a Streamlit app 🐍", "Spotted 3 keys it needs", "Checking for safety…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, lines.length - 1)), 460);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0, background: "color-mix(in srgb, var(--surface) 92%, transparent)", backdropFilter: "blur(2px)", zIndex: 5, display: "grid", placeItems: "center" }} role="status" aria-live="polite">
      <div style={{ textAlign: "center" }}>
        <div style={{ position: "relative", width: 140, height: 90, margin: "0 auto 18px", border: "var(--hair) solid var(--border-strong)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--code-bg)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "var(--accent)", boxShadow: "0 0 12px var(--accent)", animation: "lp-scan 1.1s ease-in-out infinite alternate" }} />
          {[14, 26, 38, 50, 62].map((y, k) => (
            <div key={y} style={{ position: "absolute", left: 14, top: y, height: 5, width: `${40 + ((k * 37) % 50)}%`, background: "var(--border-strong)", borderRadius: 3 }} />
          ))}
        </div>
        <p style={{ fontWeight: 700, fontSize: 16 }}>{lines[i]}</p>
      </div>
    </div>
  );
}

/* ---------- Step 1: Details ---------- */
interface StepDetailsProps {
  t: Tweaks;
  repo: RepoScan;
  models: ModelOption[];
  appName: string;
  setAppName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  ownerEmail: string;
  team: string;
  setTeam: (v: string) => void;
  modelId: string;
  setModelId: (v: string) => void;
  budget: number;
  setBudget: (v: number) => void;
  secrets: SecretSlot[];
  setSecrets: (v: SecretSlot[]) => void;
  cost: CostProjection | null;
  onBack: () => void;
  onNext: () => void;
}
function StepDetails(p: StepDetailsProps) {
  const detected: Array<[Parameters<typeof Icon>[0]["name"], string]> = [
    ["box", `${p.repo.framework} app`],
    ["doc", p.repo.entrypoint],
    ["key", `${p.repo.detectedSecrets.length} keys needed`],
  ];
  const valid = p.appName.trim().length >= 3 && p.description.trim().length > 2;
  return (
    <div className="rise">
      <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>Here's what we found.</h2>
      <p style={{ color: "var(--muted)", marginTop: 6 }}>We filled in what we could. Tweak anything that looks off.</p>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "18px 0 24px" }}>
        {detected.map(([ic, tx]) => (
          <span key={tx} className="chip chip-accent"><Icon name={ic} size={14} /> {tx}</span>
        ))}
      </div>

      <div className="card" style={{ padding: "var(--pad)", display: "grid", gap: "var(--gap)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap)" }} className="lp-2col">
          <div>
            <label className="field-label" htmlFor="app-name">What's it called?</label>
            <input id="app-name" className="input" value={p.appName} onChange={(e) => p.setAppName(e.target.value)} placeholder="My helpful app" />
          </div>
          <div>
            <label className="field-label" htmlFor="owner">Who should we ping if it breaks?</label>
            <input id="owner" className="input" value={p.ownerEmail} disabled style={{ opacity: 0.75 }} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="desc">What does it do? <span style={{ color: "var(--faint)", fontWeight: 500 }}>One line is plenty.</span></label>
          <input id="desc" className="input" value={p.description} onChange={(e) => p.setDescription(e.target.value)} placeholder="e.g. Sorts incoming reports by how urgent they are" />
        </div>
        <div>
          <label className="field-label" id="team-label">Which team is this for?</label>
          <div role="radiogroup" aria-labelledby="team-label" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TEAMS.map((tm) => (
              <button
                key={tm}
                role="radio"
                aria-checked={p.team === tm}
                className="chip"
                onClick={() => p.setTeam(tm)}
                style={{
                  cursor: "pointer",
                  borderColor: p.team === tm ? "var(--accent)" : "var(--border)",
                  color: p.team === tm ? "var(--accent)" : "var(--text-2)",
                  background: p.team === tm ? "var(--accent-wash)" : "var(--surface-2)",
                }}
              >
                {tm}
              </button>
            ))}
          </div>
        </div>

        <hr className="hr" />

        {/* Model picker */}
        <div>
          <label className="field-label" id="model-label">
            <Icon name="brain" size={16} style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--accent)" }} />Which AI brain does it use?
          </label>
          <div role="radiogroup" aria-labelledby="model-label" style={{ display: "grid", gap: 10 }}>
            {p.models.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={p.modelId === m.id}
                onClick={() => p.setModelId(m.id)}
                style={{
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 15px",
                  borderRadius: "var(--radius-sm)",
                  border: "var(--hair) solid " + (p.modelId === m.id ? "var(--accent)" : "var(--border-strong)"),
                  background: p.modelId === m.id ? "var(--accent-wash)" : "var(--surface-2)",
                  transition: ".14s",
                }}
              >
                <span style={{ width: 20, height: 20, borderRadius: "50%", flex: "none", border: "2px solid " + (p.modelId === m.id ? "var(--accent)" : "var(--border-strong)"), display: "grid", placeItems: "center" }}>
                  {p.modelId === m.id && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent)" }} />}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {m.label}
                    {m.recommended && <span className="chip chip-ok" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}>Recommended</span>}
                  </span>
                  <span style={{ display: "block", color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{m.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div>
          <label className="field-label" htmlFor="budget">
            <Icon name="dollar" size={16} style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--accent)" }} />Monthly spending limit
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <input id="budget" type="range" min={20} max={1000} step={20} value={p.budget} onChange={(e) => p.setBudget(+e.target.value)} style={{ flex: 1, accentColor: "var(--accent)", height: 6 }} aria-valuetext={`$${p.budget} per month`} />
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 17, minWidth: 84, textAlign: "right" }}>
              ${p.budget}<span style={{ color: "var(--muted)", fontSize: 13 }}>/mo</span>
            </span>
          </div>
          <p className="field-help">
            We'll gently pause your app before it goes over — and email you first. You can change this anytime.
            {p.cost && (
              <span> Based on similar apps, expect around <strong style={{ color: "var(--text-2)" }}>${p.cost.monthly}/mo</strong>.</span>
            )}
          </p>
        </div>

        {/* Secrets */}
        {p.t.showSecrets && (
          <>
            <hr className="hr" />
            <div>
              <label className="field-label">
                <Icon name="lock" size={16} style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--accent)" }} />Keys &amp; connections
              </label>
              <p className="field-help" style={{ marginTop: 0, marginBottom: 12 }}>
                Your app needs a few secret keys to work. We'll keep them locked in a vault — paste them once and forget about them.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {p.secrets.map((s, i) => (
                  <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 168, fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
                      {s.key}
                      <span style={{ display: "block", color: "var(--faint)", fontWeight: 400, fontSize: 11.5 }}>{s.reason}</span>
                    </div>
                    {s.platformManaged ? (
                      <span className="chip chip-ok" style={{ flex: 1, justifyContent: "flex-start" }}>
                        <Icon name="check" size={13} /> Handled for you — no action needed
                      </span>
                    ) : (
                      <input
                        className="input input-mono"
                        type="password"
                        placeholder="paste value"
                        aria-label={`Value for ${s.key}`}
                        value={s.value ?? ""}
                        onChange={(e) => {
                          const n = [...p.secrets];
                          n[i] = { ...s, value: e.target.value, set: !!e.target.value };
                          p.setSecrets(n);
                        }}
                        style={{ flex: "1 1 180px", height: 44 }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={p.onBack}><Icon name="arrowLeft" size={17} /> Back</button>
        <button className="btn btn-primary" onClick={p.onNext} disabled={!valid}>Run safety check <Icon name="arrowRight" size={17} /></button>
      </div>
    </div>
  );
}

/* ---------- Step 2: Safety check ---------- */
interface StepSafetyProps {
  checking: boolean;
  checks: ValidationCheck[];
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}
function StepSafety({ checking, checks, onBack, onSubmit, submitting }: StepSafetyProps) {
  return (
    <div className="rise">
      <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>A quick safety check.</h2>
      <p style={{ color: "var(--muted)", marginTop: 6 }}>We make sure your app is private, scoped, and won't surprise anyone. This is automatic.</p>

      <div className="card" style={{ padding: "var(--pad)", marginTop: 22 }}>
        {checking ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 4px" }} role="status">
            <div className="spinner" /> <span style={{ fontWeight: 600 }}>Running checks…</span>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 2 }}>
            {checks.map((c, i) => (
              <div key={c.id} className="rise" style={{ animationDelay: `${i * 70}ms`, display: "flex", alignItems: "flex-start", gap: 13, padding: "13px 4px", borderBottom: i < checks.length - 1 ? "var(--hair) solid var(--border)" : "none" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: c.warn ? "var(--warn-wash)" : "var(--ok-wash)", color: c.warn ? "var(--warn)" : "var(--ok)" }}>
                  <Icon name={c.warn ? "shield" : "check"} size={15} strokeWidth={2.2} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650, fontSize: 15 }}>{c.friendly}</div>
                  {c.warn && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>We took care of it automatically — your app only sees its own data.</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!checking && (
        <div className="card pop" style={{ padding: "18px 20px", marginTop: 16, display: "flex", alignItems: "center", gap: 14, background: "var(--ok-wash)", border: "none" }}>
          <Icon name="shield" size={22} style={{ color: "var(--ok)" }} />
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 15 }}>All clear — you're good to launch.</strong>
            <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 1 }}>Prompt-injection shield and personal-info scanning are on by default.</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onBack}><Icon name="arrowLeft" size={17} /> Back</button>
        <button className="btn btn-primary" onClick={onSubmit} disabled={checking || submitting}><Icon name="rocket" size={18} /> Submit for launch</button>
      </div>
    </div>
  );
}

/* ---------- Step 3: Done ---------- */
interface StepDoneProps {
  t: Tweaks;
  detail: SubmissionDetail;
  peek: boolean;
  setPeek: (v: boolean) => void;
  onReset: () => void;
}
function StepDone({ t, detail, peek, setPeek, onReset }: StepDoneProps) {
  const { submission, artifacts } = detail;
  const timeline: Array<[Parameters<typeof Icon>[0]["name"], string, string, string]> = [
    ["check", "Submitted", "Your app and its safety setup are packaged.", "done"],
    ["user", "Platform team gives it a look", "A quick human check — most clear within the hour.", "active"],
    ["rocket", "Live URL lands in your inbox", `${submission.slug}.apps.alice.io`, "todo"],
  ];
  return (
    <div className="rise" style={{ textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><BigCheck /></div>
      <h1 style={{ fontSize: "clamp(28px,5vw,38px)", fontWeight: 800, letterSpacing: "-.03em" }}>You're all set!</h1>
      <p style={{ color: "var(--muted)", fontSize: 17, marginTop: 10, maxWidth: 460, marginInline: "auto" }}>
        We've prepared everything <strong style={{ color: "var(--text-2)" }}>{submission.appName}</strong> needs to go live — safely. Here's what happens next.
      </p>

      <div className="card" style={{ padding: "var(--pad)", marginTop: 26, textAlign: "left" }}>
        {timeline.map(([ic, title, sub, st], i) => (
          <div key={title} style={{ display: "flex", gap: 15, paddingBottom: i < timeline.length - 1 ? 22 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: st === "done" ? "var(--ok)" : st === "active" ? "var(--accent)" : "var(--surface-2)", color: st === "todo" ? "var(--muted)" : "#fff", border: st === "todo" ? "var(--hair) solid var(--border-strong)" : "none" }}>
                <Icon name={ic} size={17} strokeWidth={2.1} />
              </span>
              {i < timeline.length - 1 && <span style={{ width: 2, flex: 1, background: "var(--border-strong)", marginTop: 4, minHeight: 22 }} />}
            </div>
            <div style={{ paddingTop: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>
                {title} {st === "active" && <span className="chip chip-accent" style={{ marginLeft: 6, padding: "2px 9px", fontSize: 11 }}>In progress</span>}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 2, fontFamily: ic === "rocket" ? "var(--font-mono)" : "inherit" }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>

      {t.showPeek && (
        <div style={{ marginTop: 16, textAlign: "left" }}>
          <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => setPeek(!peek)} aria-expanded={peek}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              <Icon name="eye" size={18} /> Peek under the hood <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>— for the curious</span>
            </span>
            <Icon name="chevronDown" size={18} style={{ transform: peek ? "rotate(180deg)" : "none", transition: ".2s" }} />
          </button>
          {peek && (
            <div className="rise" style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <p style={{ color: "var(--muted)", fontSize: 13.5 }}>You never have to touch these — but here's exactly what we generated for the platform team. Least-privilege by default.</p>
              {artifacts.map((a) => (
                <div key={a.file}>
                  <CodeBlock file={a.file} lang={a.lang} body={a.body} />
                  <p style={{ color: "var(--faint)", fontSize: 12.5, margin: "6px 2px 0" }}>{a.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 26 }}>
        <button className="btn btn-ghost" onClick={onReset}><Icon name="plus" size={17} /> Submit another app</button>
      </div>
    </div>
  );
}
