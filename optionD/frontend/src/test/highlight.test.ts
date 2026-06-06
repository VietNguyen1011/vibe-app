import { describe, expect, it } from "vitest";
import { highlight } from "../components/CodeBlock";

function balanced(html: string): boolean {
  const open = (html.match(/<span/g) || []).length;
  const close = (html.match(/<\/span>/g) || []).length;
  return open === close;
}

describe("highlight", () => {
  it("escapes angle brackets", () => {
    expect(highlight("a < b > c", "json")).not.toContain("< b");
    expect(highlight("a < b", "json")).toContain("&lt;");
  });

  it("produces well-formed spans for json", () => {
    const out = highlight('{"k": "v", "n": 3, "b": true}', "json");
    expect(balanced(out)).toBe(true);
    expect(out).toContain('class="tok-key"');
    expect(out).toContain('class="tok-str"');
  });

  it("produces well-formed spans for yaml", () => {
    const out = highlight("name: demo\n# comment\nport: 8080", "yaml");
    expect(balanced(out)).toBe(true);
    expect(out).toContain('class="tok-comment"');
  });

  it("passes through yaml lines that aren't key: value pairs", () => {
    const out = highlight("- just a list item\nplainline", "yaml");
    expect(balanced(out)).toBe(true);
    expect(out).toContain("plainline");
  });

  it("produces well-formed spans for bash", () => {
    const out = highlight('#!/bin/bash\nfor KEY in a b; do\n  echo "$KEY"\ndone', "bash");
    expect(balanced(out)).toBe(true);
  });

  it("highlights json literals (true/false/null) and numbers", () => {
    const out = highlight('{"a": true, "b": false, "c": null, "n": -2.5}', "json");
    expect(balanced(out)).toBe(true);
    expect(out).toContain('class="tok-num"'); // bool + number branches
  });

  it("escapes an unknown language verbatim (no tokens)", () => {
    const out = highlight("plain <text> & more", "text");
    expect(out).toBe("plain &lt;text&gt; &amp; more");
    expect(out).not.toContain("<span");
  });
});
