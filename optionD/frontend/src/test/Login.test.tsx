import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("surfaces an error when the dev-users list fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "server_error", detail: "directory down" }), { status: 500 })
    ));
    renderLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("directory down");
  });

  it("surfaces a login error when the sign-in request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/auth/dev-users"))
        return new Response(JSON.stringify(USERS), { status: 200, headers: { "Content-Type": "application/json" } });
      // login POST fails
      return new Response(JSON.stringify({ error: "forbidden", detail: "SSO rejected" }), { status: 403 });
    }));
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: /Maya Chen/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SSO rejected");
  });
});
