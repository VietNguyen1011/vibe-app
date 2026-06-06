// Records a watchable end-to-end demo of vibeapp as a Playwright video (.webm).
// Run: node e2e/record.mjs   (needs backend + vite dev server running)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const OUT = "../docs/videos";
mkdirSync(OUT, { recursive: true });

const pause = (p, ms = 800) => p.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 900 } },
});
const page = await context.newPage();

try {
  // ---- Sign in as an employee (Maya) ----
  await page.goto(BASE);
  await page.getByText("Sign in").waitFor();
  await pause(page, 1000);
  await page.getByRole("button", { name: /Maya Chen/ }).click();

  // ---- Connect: type a REAL public repo and scan it (live GitHub read) ----
  await page.getByText("Let's get your app live.").waitFor();
  await pause(page, 700);
  await page.getByRole("button", { name: /or paste a public URL instead/ }).click();
  await pause(page, 400);
  await page.getByRole("textbox", { name: "Public repository URL" }).pressSequentially(
    "https://github.com/mdn/beginner-html-site-styled",
    { delay: 18 }
  );
  await pause(page, 500);
  await page.getByRole("button", { name: /^Scan$/ }).click();

  // ---- Details: detection comes from the real repo (Static site / index.html) ----
  await page.getByText("Here's what we found.").waitFor({ timeout: 15000 });
  await pause(page, 1400); // let the detected chips read
  await page.locator("#desc").fill("Sorts incoming reports by how urgent they are");
  await pause(page, 600);
  // pick Haiku to show the model picker reacting
  await page.getByRole("radio", { name: /Claude 3.5 Haiku/ }).click();
  await pause(page, 500);
  await page.getByRole("radio", { name: /Claude 3.5 Sonnet/ }).click();
  await pause(page, 700);
  await page.getByRole("button", { name: /Run safety check/ }).click();

  // ---- Safety check ----
  await page.getByText(/All clear/).waitFor({ timeout: 8000 });
  await pause(page, 1100);
  await page.getByRole("button", { name: /Submit for launch/ }).click();

  // ---- Done + peek under the hood ----
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await pause(page, 900);
  await page.getByText(/What we handled for you/i).waitFor({ timeout: 4000 });
  await pause(page, 1600); // let the plain-language summary read

  // ---- Sign out, sign in as the platform admin (Priya) ----
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.getByText("Sign in").waitFor();
  await pause(page, 700);
  await page.getByRole("button", { name: /Priya Nair/ }).click();

  // ---- Admin: open the just-submitted app, view artifacts, approve ----
  await page.getByText("Submissions").waitFor({ timeout: 8000 });
  await pause(page, 900);
  await page.getByRole("button", { name: /Beginner Html Site Styled/ }).first().click();
  await pause(page, 700);
  await page.getByRole("tab", { name: "Artifacts" }).click();
  await pause(page, 1500);
  await page.getByRole("tab", { name: "Summary" }).click();
  await pause(page, 500);
  await page.getByRole("button", { name: /Approve & provision/ }).click();

  // ---- Watch it go live ----
  await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 9000 });
  await pause(page, 1600);
} finally {
  await context.close(); // flush the video
  await browser.close();
}
console.log("done");
