import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmployeeFlow } from "../employee/EmployeeFlow";
import { TWEAK_DEFAULTS } from "../components/TweaksPanel";
import type { ModelOption, RepoScan, SubmissionDetail, User } from "../types";

const USER: User = { email: "maya.chen@alice.io", name: "Maya Chen", team: "trust-intel", role: "employee" };
const MODELS: ModelOption[] = [
  { id: "sonnet", label: "Claude 3.5 Sonnet", blurb: "smart", modelId: "anthropic.x", inPer1k: 0.003, outPer1k: 0.015, recommended: true },
  { id: "haiku", label: "Claude 3.5 Haiku", blurb: "fast", modelId: "anthropic.y", inPer1k: 0.0008, outPer1k: 0.004, recommended: false },
];
const REPO: RepoScan = {
  url: "https://github.com/o/r", owner: "o", name: "demo-app", ref: "main", commit: "abc1234",
  runtime: "static", framework: "Static site", dockerfile: false, entrypoint: "index.html", port: 80,
  detectedSecrets: [], findings: [{ level: "ok", text: "ok" }],
};
const DETAIL: SubmissionDetail = {
  submission: { id: "sub-x", repoUrl: "https://github.com/o/r", repo: REPO, appName: "Demo App", slug: "demo-app",
    description: "d", ownerEmail: USER.email, team: "research", modelId: "sonnet", budget: 200, secrets: [],
    status: "review", submittedAt: "just now", spendThisMonth: 0 },
  manifest: { kind: "AppDeployment" },
  artifacts: [{ file: "iam-trust-policy.json", lang: "json", body: '{"a":1}', label: "IAM trust", note: "n" }],
  validation: [
    { id: "repo", ok: true, warn: false, friendly: "We can reach your repo", technical: "t" },
    { id: "s3", ok: true, warn: true, friendly: "We scoped your app to its own private space", technical: "t" },
  ],
  cost: { monthly: 104, perCall: 0.01, callsPerDay: 240 },
};

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/github/status")) return json({ connected: false, account: null });
    if (url.endsWith("/api/scan")) return json(REPO);
    if (url.endsWith("/api/validate")) return json({ validation: DETAIL.validation, cost: DETAIL.cost });
    if (url.endsWith("/api/submissions") && init?.method === "POST") return json(DETAIL, 201);
    return json({});
  }));
}

// The wizard tests use the "paste a public URL" fallback; the GitHub-connect path
// has its own suite in github.test.tsx.
async function scanViaPaste(url: string) {
  fireEvent.click(await screen.findByRole("button", { name: /paste a public URL/ }));
  fireEvent.change(screen.getByPlaceholderText(/github.com/), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: /^Scan$/ }));
}

function renderFlow(onSubmit = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EmployeeFlow t={{ ...TWEAK_DEFAULTS }} user={USER} models={MODELS} onSubmit={onSubmit} />
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("EmployeeFlow", () => {
  it("runs the full wizard: scan → details → safety → done → summary", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    renderFlow(onSubmit);

    // Connect (via the paste fallback)
    await scanViaPaste("https://github.com/o/r");

    // Details (after scan + 700ms settle)
    expect(await screen.findByText("Here's what we found.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Static site app")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Sorts incoming reports/), { target: { value: "does a thing" } });
    fireEvent.click(screen.getByRole("radio", { name: /Claude 3.5 Haiku/ }));
    fireEvent.click(screen.getByRole("button", { name: /Run safety check/ }));

    // Safety
    expect(await screen.findByText(/All clear/, {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Submit for launch/ }));

    // Done
    expect(await screen.findByText("You're all set!", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalled();

    // Employee sees a plain-language summary — no raw technical artifacts.
    expect(await screen.findByText(/What we handled for you/i)).toBeInTheDocument();
    expect(screen.getByText(/Private space just for your app/i)).toBeInTheDocument();
    expect(screen.queryByText("iam-trust-policy.json")).not.toBeInTheDocument();

    // Submit another resets to Connect
    fireEvent.click(screen.getByRole("button", { name: /Submit another app/ }));
    expect(await screen.findByText("Let's get your app live.")).toBeInTheDocument();
  });

  it("renders the secrets section with platform-managed + user-entered keys", async () => {
    const repoWithSecrets: RepoScan = {
      ...REPO, runtime: "python", framework: "Streamlit", entrypoint: "app.py", port: 8501,
      detectedSecrets: [
        { key: "ANTHROPIC_API_KEY", reason: "found", platformManaged: true },
        { key: "SLACK_WEBHOOK_URL", reason: "found", platformManaged: false },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/github/status")) return json({ connected: false, account: null });
      if (url.endsWith("/api/scan")) return json(repoWithSecrets);
      if (url.endsWith("/api/validate")) return json({ validation: DETAIL.validation, cost: DETAIL.cost });
      return json({});
    }));
    renderFlow();
    await scanViaPaste("https://github.com/o/r");
    expect(await screen.findByText("Here's what we found.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Keys & connections")).toBeInTheDocument();
    expect(screen.getByText(/Handled for you/)).toBeInTheDocument(); // platform-managed
    const slackInput = screen.getByLabelText("Value for SLACK_WEBHOOK_URL");
    fireEvent.change(slackInput, { target: { value: "https://hooks.slack/x" } });
    expect(slackInput).toHaveValue("https://hooks.slack/x");
  });

  it("surfaces a scan error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/github/status"))
        return new Response(JSON.stringify({ connected: false, account: null }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "not_found", detail: "nope" }), { status: 404 });
    }));
    renderFlow();
    await scanViaPaste("https://github.com/o/r");
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });

  it("shows the scanning overlay while a scan is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.endsWith("/api/github/status"))
        return Promise.resolve(new Response(JSON.stringify({ connected: false, account: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/api/scan")) return new Promise(() => {}); // never resolves — keeps it pending
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));
    renderFlow();
    await scanViaPaste("https://github.com/o/r");
    expect(await screen.findByText(/Reading your code/i)).toBeInTheDocument();
  });

  it("lands on the safety step even when validation fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/github/status")) return json({ connected: false, account: null });
      if (url.endsWith("/api/scan")) return json(REPO);
      if (url.endsWith("/api/validate")) return json({ error: "server_error", detail: "down" }, 500);
      return json({});
    }));
    renderFlow();
    await scanViaPaste("https://github.com/o/r");
    expect(await screen.findByText("Here's what we found.", {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Sorts incoming reports/), { target: { value: "does a thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Run safety check/ }));
    // validate rejected → goSafety's catch ran (setChecks([])) without crashing the flow.
    expect(await screen.findByText("A quick safety check.", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
