// E2E test for the Dashboard's customization system: Customize mode's
// remove (✕) control actually drops a widget and flips the Layout dropdown
// to "Custom (unsaved)", and the "+ Add widget" modal can add a
// pinned-report widget back (the same action a report page's own "Pin to
// Dashboard" button performs — see feature40).
//
// Run with: node e2e/feature39_dashboard_customize.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  // Default layout, default preset.
  let presetValue = await app.browser.execute(() => document.querySelector(".dashboard-toolbar select").value);
  if (presetValue !== "default") throw new Error(`expected the Layout dropdown to start on "default", got "${presetValue}"`);

  const customizeButton = await app.browser.$(".dashboard-toolbar button");
  await customizeButton.waitForExist({ timeout: 10000 });
  await customizeButton.click();

  const removeButtons = await app.browser.$$(".dashboard-widget-controls button:last-child");
  if (removeButtons.length === 0) throw new Error("expected at least one widget remove (✕) control in Customize mode");
  const widgetCountBefore = removeButtons.length;
  await removeButtons[4].click(); // remove "runway" — 5th control in the default layout, after the 4 stat cards

  const layoutAfterRemove = await app.browser.execute(() =>
    JSON.parse(localStorage.getItem("meadow-dashboard-layout")),
  );
  if (layoutAfterRemove.includes("runway")) {
    throw new Error(`expected "runway" to be removed from the layout, got ${JSON.stringify(layoutAfterRemove)}`);
  }
  console.log("removed a widget — layout is now", layoutAfterRemove);

  presetValue = await app.browser.execute(() => document.querySelector(".dashboard-toolbar select").value);
  if (presetValue !== "custom") throw new Error(`expected the Layout dropdown to flip to "custom", got "${presetValue}"`);
  console.log("Layout dropdown correctly shows Custom (unsaved)");

  const remainingWidgets = await app.browser.$$(".dashboard-widget-controls");
  if (remainingWidgets.length !== widgetCountBefore - 1) {
    throw new Error(`expected ${widgetCountBefore - 1} widgets left, found ${remainingWidgets.length}`);
  }

  // "+ Add widget…" (in the toolbar, next to Done) — add back a
  // pinned-report widget not in the default layout. The toolbar sits
  // above every widget, so it's always on-screen with the content
  // scrolled to the top — but the prior remove-button click scrolled the
  // inner `.main` pane down to reach a widget further below, leaving the
  // toolbar's button above the visible area. Scroll back to the top
  // directly rather than `scrollIntoView`, which can land an element this
  // close to the top underneath the sticky header instead of past it.
  await app.browser.execute(() => document.querySelector(".main")?.scrollTo(0, 0));
  const toolbar = await app.browser.$(".dashboard-toolbar");
  const addWidgetButton = await toolbar.$("button*=Add widget");
  await addWidgetButton.click();

  await app.browser.execute(() => {
    const row = Array.from(document.querySelectorAll(".category-manage-row")).find((r) =>
      r.textContent.includes("Allocation"),
    );
    row.querySelector("button").click();
  });
  const modalActions = await app.browser.$(".modal-actions");
  const doneButton = await modalActions.$("button=Done");
  await doneButton.click();

  const layoutAfterAdd = await app.browser.execute(() => JSON.parse(localStorage.getItem("meadow-dashboard-layout")));
  if (!layoutAfterAdd.includes("allocation")) {
    throw new Error(`expected "allocation" to be added to the layout, got ${JSON.stringify(layoutAfterAdd)}`);
  }
  console.log("added the Allocation widget via the modal — layout is now", layoutAfterAdd);

  const allocationWidget = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Allocation']");
  await allocationWidget.waitForExist({ timeout: 5000 });

  console.log("FEATURE 39 E2E TEST PASSED");
} finally {
  await app.close();
}
