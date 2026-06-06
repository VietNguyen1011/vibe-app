import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDevUsers, useLogin } from "../api/queries";
import type { LoginResponse } from "../types";

// Dev SSO sign-in. One click per known identity. In production this screen would
// redirect to the corporate IdP; here it stands in so the slice runs offline.
export function Login({ onLogin }: { onLogin: (res: LoginResponse) => void }) {
  const { data: users = [], error } = useDevUsers();
  const login = useLogin();
  const [busy, setBusy] = useState<string>("");

  async function signIn(email: string) {
    setBusy(email);
    try {
      const res = await login.mutateAsync(email);
      onLogin(res);
    } catch {
      setBusy("");
    }
  }

  const errMsg = error instanceof Error ? error.message : login.error instanceof Error ? login.error.message : "";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card rise" style={{ width: "100%", maxWidth: 440, padding: "var(--pad)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
          <span className="lp-logo"><Icon name="rocket" size={19} strokeWidth={2} /></span>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-.02em" }}>vibeapp</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", marginTop: 14 }}>Sign in</h1>
        <p style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 6 }}>
          Use your Alice account. This is an internal tool — your identity decides what you can see and own.
        </p>

        <button className="btn btn-ghost" disabled style={{ width: "100%", marginTop: 20, justifyContent: "center", opacity: 0.7 }}>
          <Icon name="lock" size={17} /> Continue with Alice SSO
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <hr className="hr" style={{ flex: 1 }} />
          <span className="mono-label">dev sign-in</span>
          <hr className="hr" style={{ flex: 1 }} />
        </div>

        <div style={{ display: "grid", gap: 10 }} role="list" aria-label="Dev identities">
          {users.map((u) => (
            <button
              key={u.email}
              className="card"
              onClick={() => signIn(u.email)}
              disabled={!!busy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "12px 14px",
                textAlign: "left",
                boxShadow: "none",
                background: "var(--surface-2)",
                cursor: "pointer",
              }}
            >
              <span style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800 }}>
                {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 14.5 }}>{u.name}</span>
                <span style={{ display: "block", color: "var(--muted)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{u.email}</span>
              </span>
              <span className={"chip " + (u.role === "admin" ? "chip-accent" : "")} style={{ fontSize: 11.5 }}>
                {u.role === "admin" ? "Platform admin" : "Employee"}
              </span>
              {busy === u.email && <div className="spinner" />}
            </button>
          ))}
        </div>

        {errMsg && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="alert" size={15} /> {errMsg}
          </p>
        )}
      </div>
    </div>
  );
}
