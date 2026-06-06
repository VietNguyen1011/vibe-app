// 1m15s vibeapp demo — full lifecycle: GitHub connect → private repo → wizard →
// admin approve → live app + cost/lifecycle view.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const OUT  = "../docs/videos";
mkdirSync(OUT, { recursive: true });
const p  = (page, ms = 700) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const ctx     = await browser.newContext({
  viewport:    { width: 1280, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 900 } },
});
const page = await ctx.newPage();

try {
  /* ── pre-flight: reset GitHub state via the API ─────────────── */
  const API = process.env.E2E_API || "http://localhost:8077";
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "maya.chen@alice.io" }),
  }).catch(() => null);
  if (loginRes?.ok) {
    const { token } = await loginRes.json();
    await fetch(`${API}/api/github/disconnect`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  /* ── 0-4s · Login screen ─────────────────────────────────────── */
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText("Sign in").waitFor();
  await p(page, 5000);                        // HOLD login screen — read identities + SSO

  /* ── 4-10s · Maya login → Connect step ──────────────────────── */
  await page.getByRole("button", { name: /Maya Chen/ }).click();
  await page.getByText("Let's get your app live.").waitFor();
  await p(page, 3500);                        // hold on tagline + Connect GitHub button

  /* ── 10-18s · Authorize → repo picker ───────────────────────── */
  await page.getByRole("button", { name: /Connect GitHub/ }).click();
  await page.getByText(/Connected as/).waitFor({ timeout: 10000 });
  await p(page, 8000);                        // HOLD: connected chip + private 🔒 badges

  /* ── 18-30s · Pick → scan → Details ─────────────────────────── */
  await page.getByText("alice-internal/claims-triage").click();
  await page.getByText("Here's what we found.").waitFor({ timeout: 8000 });
  await p(page, 2500);                        // detected chips — Streamlit/app.py/1 key
  await page.evaluate(() => window.scrollBy(0, 380));
  await p(page, 2500);                        // model picker visible
  await page.evaluate(() => window.scrollBy(0, 260));
  await p(page, 2500);                        // budget + "$104/mo" estimate

  /* ── 30-37s · Safety check ───────────────────────────────────── */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#desc").fill("Sorts incoming abuse reports by severity");
  await p(page, 600);
  await page.getByRole("button", { name: /Run safety check/ }).click();
  await page.getByText(/All clear/).waitFor({ timeout: 8000 });
  await p(page, 2800);                        // HOLD all checks + green banner

  /* ── 37-44s · Done + Peek artifacts ─────────────────────────── */
  await page.getByRole("button", { name: /Submit for launch/ }).click();
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await p(page, 1600);
  await page.getByRole("button", { name: /Peek under the hood/ }).click();
  await p(page, 1800);                        // animation settle
  await page.getByText("iam-trust-policy.json").first().waitFor({ timeout: 12000 });
  await p(page, 6000);                        // HOLD on IAM JSON highlighted

  /* ── 44-50s · Sign out → Priya admin console ────────────────── */
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.getByText("Sign in").waitFor();
  await p(page, 1000);
  await page.getByRole("button", { name: /Priya Nair/ }).click();
  await page.getByText("Submissions").waitFor({ timeout: 8000 });
  await p(page, 2500);                        // stat strip + queue visible
  await page.getByRole("button", { name: /Claims Triage/ }).first().click();
  await p(page, 1200);

  /* ── 50-57s · Artifacts tab — scroll 4 files ─────────────────── */
  await page.getByRole("tab", { name: "Artifacts" }).click();
  await p(page, 2500);
  await page.evaluate(() => window.scrollBy(0, 380));
  await p(page, 2500);                        // iam-permissions
  await page.evaluate(() => window.scrollBy(0, 380));
  await p(page, 2500);                        // deploy.yaml
  await page.evaluate(() => window.scrollBy(0, 380));
  await p(page, 2500);                        // secrets-bootstrap

  /* ── 57-62s · Summary → Approve → PROVISIONING → LIVE ───────── */
  await page.getByRole("tab", { name: "Summary" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await p(page, 900);
  await page.getByRole("button", { name: /Approve & provision/ }).click();
  await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 9000 });
  await p(page, 2000);                        // HOLD on LIVE badge + URL chip

  /* ── navigate TO the live app in the main viewport ─────────── */
  // Intercept the fake domain on the main page so the video shows it loading.
  const liveUrl = "https://claims-triage.apps.alice.io/";
  await page.route(liveUrl + "**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html lang="en">
<head><meta charset="utf-8"><title>Claims Triage Helper</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#f2efe9;color:#1d1b19;min-height:100vh}
/* top bar */
.topbar{background:#fff;border-bottom:1px solid rgba(29,27,25,.1);padding:14px 32px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10}
.logo{width:32px;height:32px;background:#6c5ce7;border-radius:10px;display:grid;place-items:center}
.logo svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}
.appname{font-weight:800;font-size:17px;letter-spacing:-.02em}
.live-chip{margin-left:auto;display:inline-flex;align-items:center;gap:6px;background:#e8f6ee;color:#1f9d63;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700}
.dot{width:7px;height:7px;border-radius:50%;background:#1f9d63;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
/* layout */
.layout{display:grid;grid-template-columns:1fr 420px;gap:0;height:calc(100vh - 61px)}
/* report queue */
.queue{background:#faf8f4;padding:24px;overflow-y:auto;border-right:1px solid rgba(29,27,25,.1)}
.queue h2{font-size:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#837d75;margin-bottom:16px}
.report{background:#fff;border:1px solid rgba(29,27,25,.1);border-radius:14px;padding:16px 18px;margin-bottom:10px;cursor:pointer;transition:.14s;display:flex;align-items:flex-start;gap:12px}
.report.active{border-color:#6c5ce7;background:#f5f3ff}
.report:hover:not(.active){background:#faf8f4}
.sev{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:12px;font-weight:800;flex:none}
.sev.crit{background:#fbe9e7;color:#d2483f}
.sev.high{background:#fbf1dd;color:#c47d12}
.sev.med{background:#e8f6ee;color:#1f9d63}
.report-title{font-weight:700;font-size:14px;margin-bottom:3px}
.report-meta{font-size:12px;color:#837d75}
/* detail */
.detail{background:#fff;padding:28px;overflow-y:auto;display:flex;flex-direction:column;gap:20px}
.detail h3{font-size:18px;font-weight:800;letter-spacing:-.01em}
.detail-body{font-size:14px;color:#4f4b46;line-height:1.6;background:#faf8f4;border-radius:12px;padding:16px}
.ai-section label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#837d75;display:block;margin-bottom:10px}
.ai-bubble{background:#f5f3ff;border:1px solid rgba(108,92,231,.2);border-radius:12px;padding:16px;font-size:13.5px;line-height:1.6;color:#1d1b19}
.ai-meta{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(29,27,25,.1);background:#faf8f4;color:#4f4b46}
.chip.crit{background:#fbe9e7;color:#d2483f;border-color:transparent}
.chip.ok{background:#e8f6ee;color:#1f9d63;border-color:transparent}
.actions{display:flex;gap:10px;margin-top:4px}
.btn{height:40px;padding:0 18px;border-radius:999px;border:none;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer}
.btn-primary{background:#6c5ce7;color:#fff}
.btn-ghost{background:#faf8f4;color:#1d1b19;border:1px solid rgba(29,27,25,.16)}
.mono{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#837d75}
</style></head>
<body>
<div class="topbar">
  <div class="logo"><svg viewBox="0 0 24 24"><path d="M12 3l6 4v10l-6 4-6-4V7z"/><path d="M12 3v18M6 7l6 4 6-4"/></svg></div>
  <span class="appname">Claims Triage Helper</span>
  <span class="mono" style="color:#aaa399">trust-intel · Claude 3.5 Sonnet</span>
  <span class="live-chip"><span class="dot"></span>Live</span>
</div>
<div class="layout">
  <div class="queue">
    <h2>Incoming Reports — 06 Jun 2026</h2>

    <div class="report active">
      <div class="sev crit">CRIT</div>
      <div>
        <div class="report-title">Account takeover — bulk credential stuffing</div>
        <div class="report-meta">report #4821 · submitted 3 min ago · 247 affected accounts</div>
      </div>
    </div>

    <div class="report">
      <div class="sev high">HIGH</div>
      <div>
        <div class="report-title">Coordinated phishing campaign via internal DMs</div>
        <div class="report-meta">report #4820 · submitted 11 min ago · 14 users targeted</div>
      </div>
    </div>

    <div class="report">
      <div class="sev high">HIGH</div>
      <div>
        <div class="report-title">Automated scraping of restricted intel feed</div>
        <div class="report-meta">report #4819 · submitted 28 min ago · rate-limit bypass</div>
      </div>
    </div>

    <div class="report">
      <div class="sev med">MED</div>
      <div>
        <div class="report-title">Repeated policy-violation attempts on AI assistant</div>
        <div class="report-meta">report #4818 · submitted 1 hr ago · jailbreak patterns</div>
      </div>
    </div>

    <div class="report">
      <div class="sev med">MED</div>
      <div>
        <div class="report-title">Unusual data export by contractor account</div>
        <div class="report-meta">report #4817 · submitted 2 hr ago · 820 MB exported</div>
      </div>
    </div>
  </div>

  <div class="detail">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span class="sev crit" style="width:auto;padding:3px 12px;border-radius:999px;font-size:12px">CRITICAL</span>
        <span class="mono">report #4821</span>
      </div>
      <h3>Account takeover — bulk credential stuffing</h3>
    </div>
    <div class="detail-body">
      Between 02:14 and 02:31 UTC, automated login attempts were observed against 1,840
      accounts using credential lists from a known breach dataset. 247 accounts had
      successful logins from unusual geolocations (VPS IPs, AS14061). Affected accounts
      show session anomalies: new device fingerprint, immediate bulk data reads, and API
      token generation within seconds of login.
    </div>

    <div class="ai-section">
      <label>AI triage — Claude 3.5 Sonnet</label>
      <div class="ai-bubble">
        <strong>Severity: Critical.</strong> This matches a textbook credential-stuffing attack
        with a high success rate (~13%). The VPS IP range (AS14061 / DigitalOcean) is
        consistent with automated tooling. Recommend immediate forced re-auth on all 247
        compromised accounts, revoke all sessions and API tokens created after 02:14 UTC,
        and enable step-up MFA for the affected cohort. Escalate to the incident response
        team; this likely warrants a customer notification within 72 hours under Alice's
        breach policy.
      </div>
      <div class="ai-meta">
        <span class="chip crit">🔴 Immediate action</span>
        <span class="chip">Incident response</span>
        <span class="chip">MFA step-up</span>
        <span class="chip ok">PII scan: clean</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary">Escalate to IR team</button>
      <button class="btn btn-ghost">Mark as reviewing</button>
    </div>
  </div>
</div>
</body></html>`,
    });
  });
  await page.goto(liveUrl);
  await p(page, 6000);                        // HOLD on the live app UI
  await page.goBack();
  await page.getByText("Submissions").waitFor({ timeout: 5000 });
  await p(page, 800);

  /* ── 68-80s · Cost & guardrails + lifecycle ──────────────────── */
  await page.getByRole("tab", { name: /Cost/ }).click();
  await p(page, 4000);                        // HOLD cost panel (spend, LLM pricing)
  await page.evaluate(() => window.scrollBy(0, 300));
  await p(page, 2500);                        // LLM token pricing rows
  await page.getByRole("tab", { name: "Summary" }).click();
  await page.evaluate(() => window.scrollTo(0, 9999));
  await p(page, 5000);                        // Retire app = lifecycle complete
  await p(page, 1000);

} finally {
  await ctx.close();   // flush video
  await browser.close();
}
console.log("1min clip done");
