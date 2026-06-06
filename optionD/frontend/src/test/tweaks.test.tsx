import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { TweaksPanel, useTweaks, TWEAK_DEFAULTS } from "../components/TweaksPanel";
import type { Tweaks } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("useTweaks", () => {
  it("applies tweak values to <html> attributes and persists", () => {
    const { result } = renderHook(() => useTweaks());
    act(() => result.current[1]("dark", true));
    act(() => result.current[1]("contrast", "high"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(JSON.parse(localStorage.getItem("vibeapp.tweaks")!).dark).toBe(true);
  });

  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("vibeapp.tweaks", "{not json");
    const { result } = renderHook(() => useTweaks());
    expect(result.current[0].look).toBe(TWEAK_DEFAULTS.look);
  });

  it("tolerates a localStorage that refuses writes", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useTweaks());
    // The persist effect swallows the write error; state still updates.
    act(() => result.current[1]("dark", true));
    expect(result.current[0].dark).toBe(true);
  });
});

describe("TweaksPanel", () => {
  it("opens, toggles a value, and closes", () => {
    const setTweak = vi.fn();
    const t: Tweaks = { ...TWEAK_DEFAULTS };
    render(<TweaksPanel t={t} setTweak={setTweak} />);
    // panel closed initially
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tweaks/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(setTweak).toHaveBeenCalledWith("dark", true);
    fireEvent.click(screen.getByRole("radio", { name: "playful" }));
    expect(setTweak).toHaveBeenCalledWith("look", "playful");
    fireEvent.click(screen.getByRole("radio", { name: "#10a36b" }));
    expect(setTweak).toHaveBeenCalledWith("accent", "#10a36b");
    fireEvent.click(screen.getByRole("button", { name: "Close tweaks" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
