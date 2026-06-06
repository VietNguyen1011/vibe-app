import { useState } from "react";
import { Icon } from "./Icon";

type Lang = "json" | "yaml" | "bash";

// Tiny single-pass syntax highlighter — always emits well-formed markup.
export function highlight(code: string, lang: Lang | string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const w = (cls: string, t: string) => `<span class="${cls}">${t}</span>`;
  if (lang === "json") {
    return esc(code).replace(
      /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      (m, key, colon, str, bool, num) => {
        if (key !== undefined) return w("tok-key", key) + colon;
        if (str !== undefined) return w("tok-str", str);
        if (bool !== undefined) return w("tok-num", bool);
        if (num !== undefined) return w("tok-num", num);
        return m;
      }
    );
  }
  if (lang === "yaml") {
    return esc(code)
      .split("\n")
      .map((line) => {
        if (/^\s*#/.test(line)) return w("tok-comment", line);
        const m = line.match(/^(\s*-?\s*)([\w.-]+)(:)(.*)$/);
        if (!m) return line;
        const rest = m[4]!.replace(/^( +)(\S.*)$/, (_mm, sp, val) => sp + w("tok-str", val));
        return m[1]! + w("tok-key", m[2]!) + m[3]! + rest;
      })
      .join("\n");
  }
  if (lang === "bash") {
    return esc(code)
      .split("\n")
      .map((line) => {
        if (/^\s*#/.test(line)) return w("tok-comment", line);
        return line.replace(
          /("(?:[^"\\]|\\.)*")|\b(for|do|done|set|in|aws|echo)\b/g,
          (_m, str, kw) => (str !== undefined ? w("tok-str", str) : w("tok-key", kw))
        );
      })
      .join("\n");
  }
  return esc(code);
}

interface CodeBlockProps {
  file: string;
  lang: Lang;
  body: string;
}

export function CodeBlock({ file, lang, body }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(body).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="code">
      <div className="code-head">
        <Icon name="doc" size={15} style={{ color: "var(--muted)" }} />
        <span className="code-name">{file}</span>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-quiet btn-sm"
          onClick={copy}
          style={{ gap: 6 }}
          aria-label={copied ? `Copied ${file}` : `Copy ${file} to clipboard`}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-body" tabIndex={0} dangerouslySetInnerHTML={{ __html: highlight(body, lang) }} />
    </div>
  );
}
