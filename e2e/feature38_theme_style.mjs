// E2E test for Settings ▸ Appearance's theme picker (Slate/Futuristic):
// selecting Futuristic sets the `data-palette` attribute the CSS keys off
// of; switching back to Slate clears it. Both themes follow the header's
// Light/Dark/System toggle now — neither hides it — so this also confirms
// the toggle lives in the header (`.topbar`), not the sidebar, following
// its relocation out of `.sidebar-foot`.
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

  // Exactly two theme options remain (Slate, Futuristic) — catches a
  // leftover Aurora/Midnight Emerald row surviving the removal.
  const optionCount = await app.browser.execute(
    () => document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-row').length,
  );
  if (optionCount !== 2) throw new Error(`expected exactly 2 theme options, found ${optionCount}`);

  // Slate (the default, internal id "classic"): the header toggle is
  // present inside .topbar (not the sidebar), and no palette is set.
  let palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected no data-palette on Slate, got "${palette}"`);
  let toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the Light/Dark/System toggle inside .topbar on Slate");
  let toggleInSidebar = await app.browser.execute(() => !!document.querySelector(".sidebar-foot .theme-toggle"));
  if (toggleInSidebar) throw new Error("expected the toggle to no longer live in .sidebar-foot");
  console.log("Slate: data-palette clear, toggle lives in the header — OK");

  await selectTheme(app, "Futuristic");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== "futuristic") throw new Error(`expected data-palette="futuristic", got "${palette}"`);
  toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the Light/Dark/System toggle to still exist on Futuristic");
  const note = await app.browser.$(".sidebar-theme-note");
  if (await note.isExisting()) throw new Error("expected no always-dark note to exist at all anymore");
  console.log("Futuristic: data-palette set, toggle still present — OK");

  await selectTheme(app, "Slate");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected data-palette to be cleared back to Slate, got "${palette}"`);
  toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the toggle to come back on Slate");
  console.log("Slate: data-palette cleared, toggle restored — OK");

  console.log("FEATURE 38 E2E TEST PASSED");
} finally {
  await app.close();
}
