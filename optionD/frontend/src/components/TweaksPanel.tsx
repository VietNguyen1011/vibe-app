import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "./Icon";
import type { Tweaks } from "../types";

const STORAGE_KEY = "vibeapp.tweaks";

export const TWEAK_DEFAULTS: Tweaks = {
  look: "soft",
  accent: "#6c5ce7",
  dark: false,
  contrast: "normal",
  density: "cozy",
  showSecrets: true,
};

export const ACCENTS = ["#6c5ce7", "#2f6df0", "#10a36b", "#e8603c", "#d6418f"];

type SetTweak = <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => void;

// Single source of truth for tweak values; persists to localStorage so the demo
// remembers the reviewer's chosen look between reloads.
export function useTweaks(): [Tweaks, SetTweak] {
  const [t, setT] = useState<Tweaks>(() => {
    try {
      return { ...TWEAK_DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return TWEAK_DEFAULTS;
    }
  });
  const setTweak: SetTweak = (key, val) => setT((prev) => ({ ...prev, [key]: val }));

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-look", t.look);
    r.setAttribute("data-density", t.density);
    r.setAttribute("data-contrast", t.contrast);
    r.style.setProperty("--accent", t.accent);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      /* storage may be unavailable */
    }
  }, [t]);

  return [t, setTweak];
}

const PANEL_STYLE: CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 70,
  zIndex: 90,
  width: 280,
  maxHeight: "calc(100vh - 110px)",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  background: "var(--surface)",
  border: "var(--hair) solid var(--border-strong)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-pop)",
};

function Section({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--faint)",
        marginTop: 4,
      }}
    >
      {label}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        style={{ display: "flex", gap: 4, background: "var(--surface-2)", padding: 3, borderRadius: "var(--radius-sm)", border: "var(--hair) solid var(--border)" }}
      >
        {options.map((o) => {
          const on = o === value;
          return (
            <button
              key={o}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o)}
              style={{
                flex: 1,
                border: 0,
                borderRadius: "calc(var(--radius-sm) - 3px)",
                padding: "7px 6px",
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: "capitalize",
                background: on ? "var(--accent)" : "transparent",
                color: on ? "var(--accent-ink)" : "var(--muted)",
                transition: ".14s",
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        style={{
          position: "relative",
          width: 38,
          height: 22,
          border: 0,
          borderRadius: 999,
          background: value ? "var(--accent)" : "var(--border-strong)",
          transition: ".15s",
          flex: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,.3)",
            transform: value ? "translateX(16px)" : "none",
            transition: ".15s",
          }}
        />
      </button>
    </div>
  );
}

function Accent({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Accent</div>
      <div role="radiogroup" aria-label="Accent color" style={{ display: "flex", gap: 8 }}>
        {ACCENTS.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              role="radio"
              aria-checked={on}
              aria-label={c}
              onClick={() => onChange(c)}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: c,
                border: on ? "2px solid var(--text)" : "2px solid transparent",
                boxShadow: "0 0 0 1px var(--border)",
                display: "grid",
                placeItems: "center",
              }}
            >
              {on && <Icon name="check" size={15} style={{ color: "#fff" }} strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TweaksPanel({ t, setTweak }: { t: Tweaks; setTweak: SetTweak }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="tweaks-panel"
        style={{ position: "fixed", right: 16, bottom: 16, zIndex: 91 }}
      >
        <Icon name="settings" size={16} /> Tweaks
      </button>
      {open && (
        <div id="tweaks-panel" role="dialog" aria-label="Look & feel tweaks" style={PANEL_STYLE} className="rise">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 14 }}>Tweaks</strong>
            <button className="btn btn-quiet btn-sm" aria-label="Close tweaks" onClick={() => setOpen(false)}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <Section label="Look & feel" />
          <Segmented label="Style" value={t.look} options={["soft", "crisp", "playful"] as const} onChange={(v) => setTweak("look", v)} />
          <Accent value={t.accent} onChange={(v) => setTweak("accent", v)} />
          <Toggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
          <Toggle label="High contrast" value={t.contrast === "high"} onChange={(v) => setTweak("contrast", v ? "high" : "normal")} />
          <Segmented label="Density" value={t.density} options={["cozy", "compact"] as const} onChange={(v) => setTweak("density", v)} />
          <Section label="Flow steps" />
          <Toggle label="Keys & connections" value={t.showSecrets} onChange={(v) => setTweak("showSecrets", v)} />
        </div>
      )}
    </>
  );
}
