// E2E test for the modal focus trap (U-1 from the performance/UI review):
// Tab/Shift+Tab must cycle within an open dialog's own focusable elements
// instead of leaking out into the page behind the overlay.
//
// Opens the "New account" dialog (autoFocus on its first field), then:
//  - Shift+Tab from the first field must wrap to the *last* focusable
//    element in the dialog ("Create account"), not escape to the sidebar.
//  - Tab from that last element must wrap back to the first field.
//
// Run with: node e2e/feature44_modal_focus_trap.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();

  const addAccountButton = await app.browser.$("button*=Add account");
  await addAccountButton.waitForExist({ timeout: 10000 });
  await addAccountButton.click();

  const nameInput = await app.browser.$(".modal-panel input");
  await nameInput.waitForExist({ timeout: 5000 });
  const initiallyFocused = await app.browser.execute(() => document.activeElement?.getAttribute("placeholder"));
  console.log("initially focused field placeholder:", initiallyFocused);
  if (!initiallyFocused || !initiallyFocused.includes("Everyday Checking")) {
    throw new Error(`expected the account-name field to have initial focus, got placeholder "${initiallyFocused}"`);
  }

  // Regression check: the focus-trap effect used to depend on `onCancel`,
  // a fresh inline closure the caller recreates on every one of *its* own
  // re-renders — any such re-render while the dialog was open fired the
  // effect's cleanup (which restored focus to whatever was focused before
  // the dialog opened) and then re-ran the mount logic, which stole focus
  // back onto the inert panel div instead of leaving it on the field
  // `autoFocus` put it on. Waiting a beat and re-checking catches that
  // even without pinpointing exactly what triggers the caller's re-render.
  await app.browser.pause(1000);
  const stillFocused = await app.browser.execute(() => document.activeElement?.getAttribute("placeholder"));
  console.log("focused field placeholder after a short wait:", stillFocused);
  if (!stillFocused || !stillFocused.includes("Everyday Checking")) {
    throw new Error(`expected the account-name field to keep initial focus after a short wait, got placeholder "${stillFocused}"`);
  }

  // "Create account" starts disabled (no name typed yet) — a disabled
  // button must never receive focus, so type a name first to bring the
  // full, realistic set of focusable controls into play before testing
  // the wrap-around at either end.
  await nameInput.setValue("Test Account");

  // Shift+Tab from the first field must wrap to the last button, not the sidebar.
  await app.browser.keys(["Shift", "Tab"]);
  await app.browser.keys("Shift"); // release shift
  const afterShiftTab = await app.browser.execute(() => document.activeElement?.textContent?.trim());
  console.log("focused after Shift+Tab from first field:", afterShiftTab);
  if (afterShiftTab !== "Create account") {
    throw new Error(`expected focus to wrap to "Create account", got "${afterShiftTab}"`);
  }

  // Tab forward from the last element must wrap back to the first field.
  await app.browser.keys(["Tab"]);
  const afterTab = await app.browser.execute(() => document.activeElement?.getAttribute("placeholder"));
  console.log("focused after Tab from last element:", afterTab);
  if (!afterTab || !afterTab.includes("Everyday Checking")) {
    throw new Error(`expected focus to wrap back to the name field, got placeholder "${afterTab}"`);
  }

  console.log("FEATURE 44 E2E TEST PASSED");
} finally {
  await app.close();
}
