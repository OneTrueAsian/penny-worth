// E2E test for the Dashboard's "Quick actions" panel: each of its 4
// buttons reuses an existing, already-tested trigger (the same dialogs/
// navigation the Ledger and Accounts tabs' own buttons already drive) —
// this only proves the new entry points are wired to the right one.
//
// Run with: node e2e/feature55_dashboard_quick_actions.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  // Dashboard is the default tab on launch.
  const quickActions = await app.browser.$(".quick-actions");
  await quickActions.waitForExist({ timeout: 10000 });

  const addTransactionBtn = await quickActions.$("button*=Add transaction");
  await addTransactionBtn.click();
  let modalTitle = await app.browser.$(".modal-title");
  await modalTitle.waitForExist({ timeout: 5000 });
  let titleText = await modalTitle.getText();
  if (!titleText.includes("Add transaction")) throw new Error(`expected the "Add transaction" dialog, got "${titleText}"`);
  await app.browser.keys(["Escape"]);
  await modalTitle.waitForExist({ timeout: 5000, reverse: true });
  console.log("+ Add transaction -> opened the Add transaction dialog - OK");

  const addAccountBtn = await quickActions.$("button*=Add account");
  await addAccountBtn.click();
  modalTitle = await app.browser.$(".modal-title");
  await modalTitle.waitForExist({ timeout: 5000 });
  titleText = await modalTitle.getText();
  if (!titleText.includes("New account")) throw new Error(`expected the "New account" dialog, got "${titleText}"`);
  await app.browser.keys(["Escape"]);
  await modalTitle.waitForExist({ timeout: 5000, reverse: true });
  console.log("+ Add account -> opened the New account dialog - OK");

  const setBudgetBtn = await quickActions.$("button*=Set budget");
  await setBudgetBtn.click();
  let title = await app.browser.$(".view-title");
  await title.waitForExist({ timeout: 5000 });
  let titleNow = await title.getText();
  if (titleNow !== "Budget") throw new Error(`expected "Set budget" to navigate to the Budget tab, got "${titleNow}"`);
  console.log("Set budget -> navigated to Budget - OK");

  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();
  const updateGoalsBtn = await (await app.browser.$(".quick-actions")).$("button*=Update goals");
  await updateGoalsBtn.click();
  title = await app.browser.$(".view-title");
  await title.waitForExist({ timeout: 5000 });
  titleNow = await title.getText();
  if (titleNow !== "Goals") throw new Error(`expected "Update goals" to navigate to the Goals tab, got "${titleNow}"`);
  console.log("Update goals -> navigated to Goals - OK");

  console.log("FEATURE 55 E2E TEST PASSED");
} finally {
  await app.close();
}
