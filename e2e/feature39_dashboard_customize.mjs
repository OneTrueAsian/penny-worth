// E2E test for the Dashboard's customization system: Customize mode's
// remove (✕) control actually drops a widget and flips the Layout dropdown
// to "Custom (unsaved)", the "+ Add widget" modal can add a pinned-report
// widget back (the same action a report page's own "Pin to Dashboard"
// button performs — see feature40), and — the free-form grid's whole
// point — actually dragging a widget by its handle changes its persisted
// grid position (react-grid-layout/react-draggable respond to real
// pointer events, not the old HTML5 dragstart/drop this system used
// before, so this drives a real W3C pointer-action sequence rather than
// clicking anything).
//
// Run with: node e2e/feature39_dashboard_customize.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  async function currentLayout() {
    return app.browser.execute(() => JSON.parse(localStorage.getItem("meadow-dashboard-grid-layout")));
  }

  // Default layout, default preset.
  let presetValue = await app.browser.execute(() => document.querySelector(".dashboard-toolbar select").value);
  if (presetValue !== "default") throw new Error(`expected the Layout dropdown to start on "default", got "${presetValue}"`);

  const customizeButton = await app.browser.$(".dashboard-toolbar button");
  await customizeButton.waitForExist({ timeout: 10000 });
  await customizeButton.click();

  const removeButtons = await app.browser.$$(".dashboard-widget-controls button:last-child");
  if (removeButtons.length === 0) throw new Error("expected at least one widget remove (✕) control in Customize mode");
  const widgetCountBefore = removeButtons.length;
  // Widgets render in `dashboardLayout`'s own array order (see
  // DashboardView.tsx's `dashboardLayout.map(...)`), so the Nth remove
  // control always corresponds to the Nth entry in the saved layout —
  // looked up by id here rather than a fixed index, since the default
  // layout's exact widget order isn't this test's concern and has already
  // changed once (splitting "Stat cards" into 4 individual widgets moved
  // "runway" from 2nd to 5th).
  const initialLayout = await currentLayout();
  const runwayIndex = initialLayout.findIndex((item) => item.i === "runway");
  if (runwayIndex === -1) throw new Error(`expected "runway" in the default layout, got ${JSON.stringify(initialLayout)}`);
  await removeButtons[runwayIndex].click();

  const layoutAfterRemove = await currentLayout();
  if (layoutAfterRemove.some((item) => item.i === "runway")) {
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

  // "+ Add widget" — add back a pinned-report widget not in the default layout.
  const addTile = await app.browser.$(".add-tile");
  await addTile.click();

  await app.browser.execute(() => {
    const row = Array.from(document.querySelectorAll(".category-manage-row")).find((r) =>
      r.textContent.includes("Allocation"),
    );
    row.querySelector("button").click();
  });
  const modalActions = await app.browser.$(".modal-actions");
  const doneButton = await modalActions.$("button=Done");
  await doneButton.click();

  const layoutAfterAdd = await currentLayout();
  if (!layoutAfterAdd.some((item) => item.i === "allocation")) {
    throw new Error(`expected "allocation" to be added to the layout, got ${JSON.stringify(layoutAfterAdd)}`);
  }
  console.log("added the Allocation widget via the modal — layout is now", layoutAfterAdd);

  const allocationWidget = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Allocation']");
  await allocationWidget.waitForExist({ timeout: 5000 });

  // Dragging a widget by its handle actually repositions it in the
  // persisted grid layout — the core new capability, replacing the old
  // ↑/↓ buttons entirely. Same by-id lookup as the remove-button step
  // above: drag handles render in `dashboardLayout`'s own array order, so
  // "needs_a_look"'s index in the current saved layout is also its index
  // among `.dashboard-widget-drag-handle` elements.
  const beforeDrag = await currentLayout();
  const needsALookIndex = beforeDrag.findIndex((item) => item.i === "needs_a_look");
  if (needsALookIndex === -1) throw new Error(`expected "needs_a_look" in the layout, got ${JSON.stringify(beforeDrag)}`);
  const beforeY = beforeDrag[needsALookIndex].y;

  const dragHandles = await app.browser.$$(".dashboard-widget-drag-handle");
  if (dragHandles.length <= needsALookIndex) {
    throw new Error(`expected a drag handle at index ${needsALookIndex}, found ${dragHandles.length} handles`);
  }
  const needsALookHandle = dragHandles[needsALookIndex];

  // react-draggable (which react-grid-layout's drag handling is built on)
  // just listens for real `mousedown`/`mousemove`/`mouseup` DOM events —
  // dispatching them directly is far more deterministic here than
  // WebDriver's Actions API, which choked on this app's small default
  // window (800x600, see tauri.conf.json: a multi-step pointer move can
  // easily land outside the actual window bounds and gets rejected
  // outright). React doesn't check `event.isTrusted`, so a script-
  // dispatched MouseEvent drives it exactly like a real one — but each
  // dispatch needs a real pause after it, in a separate `execute()` call:
  // firing mousedown/mousemove/mouseup back-to-back in one synchronous
  // batch outraces React's own state commit between them (verified by
  // hand — bunching them up silently drops the drag; spacing them out a
  // beat apart is what makes react-draggable's internal position tracking
  // actually see each step).
  function fireOnHandle(type, x, y) {
    return app.browser.execute(
      (el, type, x, y) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
      },
      needsALookHandle,
      type,
      x,
      y,
    );
  }
  function fireOnDocument(type, x, y) {
    return app.browser.execute(
      (type, x, y) => {
        document.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
      },
      type,
      x,
      y,
    );
  }

  const handleRect = await app.browser.execute((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, needsALookHandle);

  await fireOnHandle("mousedown", handleRect.x, handleRect.y);
  await app.browser.pause(120);
  for (const dy of [60, 200, 400]) {
    await fireOnDocument("mousemove", handleRect.x, handleRect.y + dy);
    await app.browser.pause(120);
  }
  await fireOnDocument("mouseup", handleRect.x, handleRect.y + 400);
  await app.browser.pause(300);

  const afterDrag = await currentLayout();
  const afterY = afterDrag.find((item) => item.i === "needs_a_look").y;
  if (afterY === beforeY) {
    throw new Error(`expected dragging the handle to move needs_a_look (was y=${beforeY}), got ${JSON.stringify(afterDrag)}`);
  }
  console.log(`dragged needs_a_look via its handle — y went from ${beforeY} to ${afterY}`);

  console.log("FEATURE 39 E2E TEST PASSED");
} finally {
  await app.close();
}
