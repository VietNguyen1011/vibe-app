import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminConsole } from "../admin/AdminConsole";
import type { ModelOption, RepoScan, Submission, SubmissionDetail } from "../types";

const MODELS: ModelOption[] = [
  { id: "sonnet", label: "Claude 3.5 Sonnet", blurb: "", modelId: "anthropic.x", inPer1k: 0.003, outPer1k: 0.015, recommended: true },
];
const repo = (commit: string): RepoScan => ({
  url: "https://github.com/o/r", owner: "o", name: "r", ref: "main", commit,
  runtime: "python", framework: "Streamlit", dockerfile: true, entrypoint: "app.py", port: 8501,
  detectedSecrets: [], findings: [],
});
const sub = (id: string, status: Submission["status"], over: Partial<Submission> = {}): Submission => ({
  id, repoUrl: "https://github.com/o/" + id, repo: repo("abc1234"), appName: id, slug: id,
  description: "d", ownerEmail: "maya.chen@alice.io", team: "research", modelId: "sonnet",
  budget: 200, secrets: [], status, submittedAt: "now", spendThisMonth: 0, ...over,
});
const detail = (s: Submission): SubmissionDetail => ({
  submission: s, manifest: { kind: "AppDeployment" },
  artifacts: [{ file: "iam-trust-policy.json", lang: "json", body: "{}", label: "IAM", note: "n" }],
  validation: [
    { id: "repo", ok: true, warn: false, friendly: "We can reach your repo", technical: "t" },
    { id: "s3", ok: true, warn: true, friendly: "Scoped to its own space", technical: "t2" },
  ],
  cost: { monthly: 104, perCall: 0.01, callsPerDay: 240 },
});

const LIST = [
  sub("review-app", "review"),
  sub("live-app", "live", { liveUrl: "live-app.apps.internal" }),
  sub("prov-app", "provisioning"),
];

function mockFetch(approve = vi.fn()) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/submissions") && (!init || init.method === undefined || init.method === "GET")) return json(LIST);
    const m = url.match(/\/api\/submissions\/([^/]+)$/);
    if (m && init?.method === "PATCH") return json({ ...sub(m[1]!, "review") });
    if (m) return json(detail(LIST.find((s) => s.id === m[1]) ?? LIST[0]!));
    if (url.includes("/approve")) { approve(); return json({ ...sub("review-app", "provisioning") }); }
    return json({});
  }));
}

function renderAdmin(onToast = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AdminConsole models={MODELS} onToast={onToast} />
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("AdminConsole", () => {
  it("shows the queue + stats and walks every detail tab", async () => {
    mockFetch();
    renderAdmin();
    expect(await screen.findByText("Apps live")).toBeInTheDocument();
    // detail for the first (review) app loads
    expect(await screen.findByRole("button", { name: /Approve & provision/ })).toBeInTheDocument();
    for (const tab of ["Manifest", "Validation", "Artifacts", "Cost & guardrails", "Summary"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
    }
    expect(await screen.findByText(/What gets created/)).toBeInTheDocument();
  });

  it("approves a submission and toasts", async () => {
    const approve = vi.fn();
    const onToast = vi.fn();
    mockFetch(approve);
    renderAdmin(onToast);
    fireEvent.click(await screen.findByRole("button", { name: /Approve & provision/ }));
    await waitFor(() => expect(approve).toHaveBeenCalled());
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Provisioning")));
  });

  it("shows retire on a live app", async () => {
    mockFetch();
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: /live-app/ }));
    expect(await screen.findByRole("button", { name: /Retire app/ })).toBeInTheDocument();
  });

  it("shows the ECS Fargate provisioning state in the action bar", async () => {
    mockFetch();
    renderAdmin();
    fireEvent.click(await screen.findByRole("button", { name: /prov-app/ }));
    expect(await screen.findByText(/Provisioning on AWS ECS Fargate/)).toBeInTheDocument();
  });

  it("requests changes on a review app and toasts", async () => {
    const onToast = vi.fn();
    mockFetch();
    renderAdmin(onToast);
    fireEvent.click(await screen.findByRole("button", { name: /Request changes/ }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Changes requested")));
  });

  it("retires a live app and toasts", async () => {
    const onToast = vi.fn();
    mockFetch();
    renderAdmin(onToast);
    fireEvent.click(await screen.findByRole("button", { name: /live-app/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Retire app/ }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("retired")));
  });
});
