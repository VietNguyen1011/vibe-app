// Typed fetch wrapper over the Vibeapp FastAPI backend.

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const TOKEN_KEY = "vibeapp.token";

// Persist to localStorage when available; fall back to memory (tests / SSR).
let memoryToken = "";
const hasLocalStorage = (() => {
  try {
    return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
})();

export const tokenStore = {
  get(): string {
    return hasLocalStorage ? localStorage.getItem(TOKEN_KEY) ?? "" : memoryToken;
  },
  set(v: string): void {
    memoryToken = v;
    if (!hasLocalStorage) return;
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...opts, headers });

  if (res.status === 401) tokenStore.set("");

  if (!res.ok) {
    let code = "error";
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      code = body.error ?? code;
      detail = body.detail ?? detail;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, code, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
