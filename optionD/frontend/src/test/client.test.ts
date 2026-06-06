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
});
