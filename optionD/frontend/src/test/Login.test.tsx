import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Login } from "../auth/Login";

const USERS = [
  { email: "maya.chen@alice.io", name: "Maya Chen", team: "trust-intel", role: "employee" },
  { email: "priya.nair@alice.io", name: "Priya Nair", team: "platform", role: "admin" },
];

afterEach(() => vi.restoreAllMocks());

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Login onLogin={() => {}} />
    </QueryClientProvider>
  );
}

describe("Login", () => {
  it("renders the dev SSO identities from the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(USERS), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    renderLogin();
    await waitFor(() => expect(screen.getByText("Maya Chen")).toBeInTheDocument());
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Platform admin")).toBeInTheDocument();
  });
});
