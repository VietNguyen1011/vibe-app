// Captures README screenshots of the current vibeapp UI. Needs backend + vite up.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const OUT = "../docs/screenshots";
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const pause = (p, ms = 500) => p.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  // 1. Login
  await page.goto(BASE);
  await page.getByText("Sign in").waitFor();
  await pause(page, 400);
  await shot(page, "01-login");

  // Employee: scan a real repo
  await page.getByRole("button", { name: /Maya Chen/ }).click();
  await page.getByText("Let's get your app live.").waitFor();
  await pause(page, 400);
  await shot(page, "02-employee-connect");

  await page.locator("#repo-url").fill("https://github.com/mdn/beginner-html-site-styled");
  await page.getByRole("button", { name: /Scan my repo/ }).click();
  await page.getByText("Here's what we found.").waitFor({ timeout: 15000 });
  await pause(page, 800);
  await shot(page, "03-employee-details");

  await page.locator("#desc").fill("A friendly little site for the team");
  await page.getByRole("button", { name: /Run safety check/ }).click();
  await page.getByText(/All clear/).waitFor({ timeout: 8000 });
  await pause(page, 600);
  await shot(page, "04-safety-check");

  await page.getByRole("button", { name: /Submit for launch/ }).click();
  await page.getByText("You're all set!").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: /Peek under the hood/ }).click();
  await pause(page, 900);
  await shot(page, "05-done-peek");

  // Admin: artifacts + approve
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.getByText("Sign in").waitFor();
  await page.getByRole("button", { name: /Priya Nair/ }).click();
  await page.getByText("Submissions").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: /Beginner Html Site Styled/ }).first().click();
  await page.getByRole("tab", { name: "Artifacts" }).click();
  await pause(page, 800);
  await shot(page, "06-admin-artifacts");

  // Dark + high-contrast via Tweaks
  await page.getByRole("button", { name: /Tweaks/ }).click();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.getByRole("switch", { name: "High contrast" }).click();
  await pause(page, 500);
  await page.getByRole("button", { name: "Close tweaks" }).click();
  await pause(page, 400);
  await shot(page, "07-admin-dark-contrast");
} finally {
  await context.close();
  await browser.close();
}
console.log("shots done");
