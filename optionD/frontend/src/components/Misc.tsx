import { Fragment, useEffect } from "react";
import { Icon } from "./Icon";

// ---------- progress steps ----------
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="steps" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Progress">
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <li className="step-bar" data-on={i <= current ? "true" : "false"} aria-hidden="true" />}
          <li
            className="step-dot"
            data-on={i < current ? "done" : i === current ? "active" : "todo"}
            aria-current={i === current ? "step" : undefined}
          >
            <div className="step-num">{i < current ? <Icon name="check" size={15} /> : i + 1}</div>
            <span className="step-label">{s}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

// ---------- animated success check ----------
export function BigCheck({ size = 76 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" style={{ display: "block" }} aria-hidden="true">
      <circle cx="26" cy="26" r="24" fill="var(--ok-wash)" />
      <path
        d="M16 27l7 7 14-15"
        fill="none"
        stroke="var(--ok)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ strokeDasharray: 40, animation: "lp-check .6s .15s ease both" }}
      />
    </svg>
  );
}

// ---------- toast ----------
export function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pop"
      style={{
        position: "fixed",
        bottom: 26,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 80,
        background: "var(--text)",
        color: "var(--bg)",
        padding: "12px 20px",
        borderRadius: "var(--radius-pill)",
        fontSize: 14,
        fontWeight: 600,
        boxShadow: "var(--shadow-pop)",
        display: "flex",
        alignItems: "center",
        gap: 9,
      }}
    >
      <Icon name="check" size={16} /> {msg}
    </div>
  );
}
