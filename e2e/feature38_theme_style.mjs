// E2E test for Settings ▸ Appearance's theme picker (Classic/Aurora/
// Midnight Emerald): selecting a reskin sets the `data-palette` attribute
// the CSS keys off of, and swaps the sidebar's Light/Dark/System toggle
// for a static "always dark" note (a dark-only reskin ignoring that
// toggle would otherwise look broken/inert). Switching back to Classic
// must restore both.
//
// Run with: node e2e/feature38_theme_style.mjs

import { launchApp } from "./harness.mjs";

// WebdriverIO's `tag*=text` reverse-text shorthand is unreliable outside a
// bare tag selector (see explore.mjs's header comment for the descendant-
// combinator case) — finding the row by its own text content in the page
// itself sidesteps that entirely.
async function selectTheme(app, label) {
  await app.browser.execute((text) => {
    const row = Array.from(document.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent.includes(text));
    if (!row) throw new Error(`no .feature-toggle-row containing "${text}"`);
    row.querySelector("input").click();
  }, label);
}

const app = await launchApp();
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const appearanceHeading = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Appearance']");
  await appearanceHeading.waitForExist({ timeout: 10000 });

  // Classic (the default): the sidebar toggle is present, no palette set.
  let palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected no data-palette on Classic, got "${palette}"`);
  let toggle = await app.browser.$(".theme-toggle");
  if (!(await toggle.isExisting())) throw new Error("expected the Light/Dark/System toggle to exist on Classic");

  await selectTheme(app, "Aurora");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== "aurora") throw new Error(`expected data-palette="aurora", got "${palette}"`);
  let note = await app.browser.$(".sidebar-theme-note");
  if (!(await note.isExisting())) throw new Error("expected the always-dark note to replace the toggle on Aurora");
  toggle = await app.browser.$(".theme-toggle");
  if (await toggle.isExisting()) throw new Error("expected the Light/Dark/System toggle to be gone on Aurora");
  console.log("Aurora: data-palette set, toggle replaced by note — OK");

  await selectTheme(app, "Midnight Emerald");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== "midnight_emerald") throw new Error(`expected data-palette="midnight_emerald", got "${palette}"`);
  const accent = await app.browser.execute(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  if (accent.toLowerCase() !== "#10b981") throw new Error(`expected Midnight Emerald's --accent to be #10b981, got "${accent}"`);
  console.log("Midnight Emerald: data-palette set, --accent is #10b981 — OK");

  await selectTheme(app, "Classic");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected data-palette to be cleared back to Classic, got "${palette}"`);
  toggle = await app.browser.$(".theme-toggle");
  if (!(await toggle.isExisting())) throw new Error("expected the Light/Dark/System toggle to come back on Classic");
  console.log("Classic: data-palette cleared, toggle restored — OK");

  console.log("FEATURE 38 E2E TEST PASSED");
} finally {
  await app.close();
}
