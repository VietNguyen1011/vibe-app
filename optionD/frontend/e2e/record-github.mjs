// Records the GitHub App connect flow as a Playwright video.
// Login → Connect GitHub → authorize → pick a PRIVATE repo → scan → details →
// safety → submit → admin approve → live. Needs backend + vite up.
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
  // Sign in as an employee
  await page.goto(BASE);
  await page.getByText("Sign in").waitFor();
  await pause(page, 900);
  await page.getByRole("button", { name: /Maya Chen/ }).click();

  // Connect step — the new GitHub App flow
  await page.getByText("Let's get your app live.").waitFor();
  await pause(page, 900);
  await page.getByRole("button", { name: /Connect GitHub/ }).click();

  // authorize → callback → back to the SPA, now connected with a repo picker
  await page.getByText(/Connected as/).waitFor({ timeout: 10000 });
  await pause(page, 1300);

  // pick a PRIVATE repo (read via the installation token)
  await page.getByText("alice-internal/claims-triage").click();

  // Details (detected from the connected repo)
  await page.getByText("Here's what we found.").waitFor({ timeout: 8000 });
  await pause(page, 1100);
  await page.locator("#desc").fill("Sorts incoming reports by how urgent they are");
  await pause(page, 600);
  await page.getByRole("button", { name: /Run safety check/ }).click();

  await page.getByText(/All clear/).waitFor({ timeout: 8000 });
  await pause(page, 1000);
  await page.getByRole("button", { name: /Submit for launch/ }).click();
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await pause(page, 1200);

  // Admin approves → live
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.getByText("Sign in").waitFor();
  await page.getByRole("button", { name: /Priya Nair/ }).click();
  await page.getByText("Submissions").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: /Claims Triage/ }).first().click();
  await page.getByRole("tab", { name: "Artifacts" }).click();
  await pause(page, 1200);
  await page.getByRole("tab", { name: "Summary" }).click();
  await page.getByRole("button", { name: /Approve & provision/ }).click();
  await page.getByText("Live", { exact: true }).first().waitFor({ timeout: 9000 });
  await pause(page, 1600);
} finally {
  await context.close();
  await browser.close();
}
console.log("github recording done");
