import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";
import { tokenStore } from "../api/client";

function mockFetch(role: "employee" | "admin") {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/auth/me"))
      return json({ email: "u@alice.io", name: "Test User", team: "research", role });
    if (url.endsWith("/api/auth/dev-users"))
      return json([{ email: "u@alice.io", name: "Test User", team: "research", role }]);
    if (url.endsWith("/api/auth/login")) return json({ token: "tok", user: { email: "u@alice.io", name: "Test User", team: "research", role } });
    if (url.endsWith("/api/auth/logout")) return new Response(null, { status: 204 });
    if (url.endsWith("/api/models")) return json([]);
    if (url.endsWith("/api/submissions")) return json([]);
    return json({});
  }));
}

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><App /></QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  tokenStore.set("");
});

describe("App", () => {
  it("shows the login screen when no session", async () => {
    mockFetch("employee");
    renderApp();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("resumes an admin session and shows the view switch", async () => {
    tokenStore.set("tok");
    mockFetch("admin");
    renderApp();
    expect(await screen.findByRole("group", { name: "Switch view" })).toBeInTheDocument();
    // employee has no switch — verified in the next test
  });

  it("resumes an employee session without the admin switch, then logs out", async () => {
    tokenStore.set("tok");
    mockFetch("employee");
    renderApp();
    expect(await screen.findByText("Let's get your app live.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Switch view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("logs in from the login screen", async () => {
    mockFetch("admin");
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Test User/ }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Switch view" })).toBeInTheDocument());
  });

  it("clears the ?github=connected marker from the URL after the callback", async () => {
    window.history.replaceState({}, "", "/?github=connected");
    tokenStore.set("tok");
    mockFetch("employee");
    renderApp();
    expect(await screen.findByText("Let's get your app live.")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });
});
