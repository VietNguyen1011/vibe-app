import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, tokenStore } from "../api/client";

afterEach(() => {
  vi.restoreAllMocks();
  tokenStore.set("");
});

describe("request", () => {
  it("returns parsed json on ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    await expect(request<{ status: string }>("/health")).resolves.toEqual({ status: "ok" });
  });

  it("throws ApiError with detail on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found", detail: "nope" }), { status: 404 })
    ));
    await expect(request("/missing")).rejects.toMatchObject({ status: 404, code: "not_found", message: "nope" } as Partial<ApiError>);
  });

  it("clears the token on 401", async () => {
    tokenStore.set("stale-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(request("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBe("");
  });

  it("returns undefined on 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request("/auth/logout")).resolves.toBeUndefined();
  });

  it("keeps default code/detail when the error body is not json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 500 })));
    await expect(request("/boom")).rejects.toMatchObject({ status: 500 } as Partial<ApiError>);
  });
});

describe("tokenStore when localStorage is unavailable", () => {
  it("falls back to an in-memory token if accessing localStorage throws at import", async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
    try {
      vi.resetModules();
      const mod = await import("../api/client");
      mod.tokenStore.set("mem-token");
      expect(mod.tokenStore.get()).toBe("mem-token");
    } finally {
      if (orig) Object.defineProperty(globalThis, "localStorage", orig);
      vi.resetModules();
    }
  });
});
