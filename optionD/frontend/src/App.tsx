import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "./components/Icon";
import { Toast } from "./components/Misc";
import { TweaksPanel, useTweaks } from "./components/TweaksPanel";
import { Login } from "./auth/Login";
import { EmployeeFlow } from "./employee/EmployeeFlow";
import { AdminConsole } from "./admin/AdminConsole";
import { tokenStore } from "./api/client";
import { useLogout, useMe, useModels } from "./api/queries";
import type { LoginResponse, User } from "./types";

export default function App() {
  const [t, setTweak] = useTweaks();
  const [view, setView] = useState<"employee" | "admin">("employee");
  const [toast, setToast] = useState("");

  // Resume an existing session, then expose the user. `useMe` is enabled only when
  // a token is present; on 401 the client clears the token.
  const hasToken = !!tokenStore.get();
  const meQuery = useMe(hasToken);
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    if (meQuery.data) {
      setUser(meQuery.data);
      // On session resume, land on the view that fits the role.
      setView(meQuery.data.role === "admin" ? "admin" : "employee");
    }
  }, [meQuery.data]);

  const logout = useLogout();
  const { data: models = [] } = useModels();
  const qc = useQueryClient();

  // Returning from the GitHub callback: refresh connection status, drop the marker.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      qc.invalidateQueries({ queryKey: ["github"] });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [qc]);

  function handleLogin(res: LoginResponse) {
    setUser(res.user);
    setView(res.user.role === "admin" ? "admin" : "employee");
  }

  async function handleLogout() {
    await logout.mutateAsync().catch(() => {});
    setUser(null);
    setView("employee");
  }

  const authResolved = !hasToken || meQuery.isFetched;
  if (!authResolved) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }} role="status">
        <div className="spinner" />
      </div>
    );
  }
  if (!user) return <Login onLogin={handleLogin} />;

  const isAdmin = user.role === "admin";

  return (
    <div className="lp-root">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="lp-topbar">
        <div className="lp-wordmark">
          <span className="lp-logo"><Icon name="rocket" size={19} strokeWidth={2} /></span>
          vibeapp
        </div>
        <span className="chip" style={{ padding: "4px 10px", fontSize: 11.5 }}>internal · alice</span>
        <div className="lp-spacer" />

        {/* An admin may switch between the two views; an employee only sees their own. */}
        {isAdmin && (
          <div className="lp-persona" role="group" aria-label="Switch view">
            <span style={{ fontSize: 12, color: "var(--faint)", padding: "0 4px 0 8px", fontWeight: 600, whiteSpace: "nowrap" }}>View as</span>
            <button className="seg" aria-pressed={view === "employee"} onClick={() => setView("employee")}>
              <Icon name="user" size={15} /> <span>Employee</span>
            </button>
            <button className="seg" aria-pressed={view === "admin"} onClick={() => setView("admin")}>
              <Icon name="settings" size={15} /> <span>Platform admin</span>
            </button>
          </div>
        )}

        <UserMenu user={user} onLogout={handleLogout} />
      </header>

      <main className="lp-main" id="main">
        {view === "admin" && isAdmin ? (
          <AdminConsole models={models} onToast={setToast} />
        ) : (
          <EmployeeFlow t={t} user={user} models={models} onSubmit={() => setToast("Sent to the platform team")} />
        )}
      </main>

      <Toast msg={toast} onDone={() => setToast("")} />
      <TweaksPanel t={t} setTweak={setTweak} />
    </div>
  );
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const initials = user.name.split(" ").map((p) => p[0]).join("").slice(0, 2);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 32, height: 32, borderRadius: "50%", flex: "none", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12.5 }} aria-hidden="true">
          {initials}
        </span>
        <span style={{ lineHeight: 1.1 }}>
          <span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>{user.name}</span>
          <span style={{ display: "block", color: "var(--faint)", fontSize: 11.5, fontFamily: "var(--font-mono)" }}>{user.team}</span>
        </span>
      </div>
      <button className="btn btn-quiet btn-sm" onClick={onLogout} aria-label="Sign out" title="Sign out">
        <Icon name="external" size={15} /> Sign out
      </button>
    </div>
  );
}
