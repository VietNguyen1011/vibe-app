import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Steps, BigCheck, Toast } from "../components/Misc";
import { Icon } from "../components/Icon";
import { CodeBlock } from "../components/CodeBlock";
import { Login } from "../auth/Login";

afterEach(() => vi.restoreAllMocks());

describe("Steps", () => {
  it("marks done / active / todo", () => {
    render(<Steps steps={["A", "B", "C"]} current={1} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    // current step carries aria-current
    expect(document.querySelector('[aria-current="step"]')).toBeTruthy();
  });
});

describe("Icon", () => {
  it("renders a labelled (img role) icon with a title", () => {
    render(<Icon name="rocket" title="Launch" />);
    expect(screen.getByRole("img", { name: "Launch" })).toBeInTheDocument();
  });
  it("renders decorative icon hidden from a11y tree", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("BigCheck", () => {
  it("renders an svg", () => {
    const { container } = render(<BigCheck />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("Toast", () => {
  it("shows a message then calls onDone after the timeout", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<Toast msg="Saved" onDone={onDone} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2700));
    expect(onDone).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("renders nothing when empty", () => {
    const { container } = render(<Toast msg="" onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CodeBlock", () => {
  it("copies the body to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlock file="x.json" lang="json" body='{"a":1}' />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith('{"a":1}');
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});

describe("Login error path", () => {
  it("shows an alert when sign-in fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/dev-users"))
        return new Response(JSON.stringify([{ email: "u@alice.io", name: "U Ser", team: "research", role: "employee" }]), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "unauthorized", detail: "Unknown SSO identity" }), { status: 401 });
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Login onLogin={() => {}} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /U Ser/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown SSO identity");
  });
});
