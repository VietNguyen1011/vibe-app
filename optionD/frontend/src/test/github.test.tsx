import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmployeeFlow } from "../employee/EmployeeFlow";
import { TWEAK_DEFAULTS } from "../components/TweaksPanel";
import type { ModelOption, RepoRef, RepoScan, User } from "../types";

const USER: User = { email: "maya.chen@alice.io", name: "Maya Chen", team: "trust-intel", role: "employee" };
const MODELS: ModelOption[] = [
  { id: "sonnet", label: "Claude 3.5 Sonnet", blurb: "", modelId: "anthropic.x", inPer1k: 0.003, outPer1k: 0.015, recommended: true },
];
const REPOS: RepoRef[] = [
  { fullName: "alice-internal/claims-triage", private: true, defaultBranch: "main" },
  { fullName: "alice-internal/public-docs", private: false, defaultBranch: "main" },
];
const SCAN: RepoScan = {
  url: "https://github.com/alice-internal/claims-triage", owner: "alice-internal", name: "claims-triage",
  ref: "main", commit: "abc1234", runtime: "python", framework: "Streamlit", dockerfile: true,
  entrypoint: "app.py", port: 8501, detectedSecrets: [], findings: [{ level: "ok", text: "Private repo" }],
};

function mock(connected: boolean, onConnect = vi.fn()) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/github/status")) return json({ connected, account: connected ? "alice-internal" : null });
    if (url.endsWith("/api/github/repos")) return json(REPOS);
    if (url.endsWith("/api/github/connect")) { onConnect(); return json({ authorizeUrl: "/api/github/callback?state=x" }); }
    if (url.endsWith("/api/scan")) return json(SCAN);
    if (url.endsWith("/api/validate")) return json({ validation: [], cost: { monthly: 50, perCall: 0.01, callsPerDay: 240 } });
    return json({});
  }));
}

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EmployeeFlow t={{ ...TWEAK_DEFAULTS }} user={USER} models={MODELS} onSubmit={vi.fn()} />
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("GitHub connect (StepConnect)", () => {
  it("shows Connect GitHub when not connected and calls connect", async () => {
    const onConnect = vi.fn();
    mock(false, onConnect);
    // jsdom can't navigate; swallow the href assignment
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: /Connect GitHub/ }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
  });

  it("lists repos (with a private badge) once connected and scans the picked repo", async () => {
    mock(true);
    renderFlow();
    expect(await screen.findByText(/Connected as alice-internal/)).toBeInTheDocument();
    expect(await screen.findByText(/private/)).toBeInTheDocument();
    fireEvent.click(await screen.findByText("alice-internal/claims-triage"));
    expect(await screen.findByText("Here's what we found.", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
