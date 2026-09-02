// E2E smoke test for manual asset tracking ("Property & Valuables"):
// creates a real estate asset from the Reports tab, confirms it's listed
// with its value folded into the Total Assets / Net Worth stats, edits its
// value, then deletes it and confirms the stats settle back down.
//
// Run with: node e2e/feature11_assets.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();

  const addAssetBtn = await app.browser.$("button*=Add property or valuable");
  await addAssetBtn.waitForExist({ timeout: 10000 });
  await addAssetBtn.click();

  const nameInput = await app.browser.$(`//input[@placeholder='e.g. "Home"']`);
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue("Home");
  const valueInput = await app.browser.$('input[placeholder="Current value"]');
  await valueInput.setValue("350000");
  const saveBtn = await app.browser.$("button=Save");
  await saveBtn.click();

  const propertySection = await app.browser.$(
    "//h2[contains(., 'Property & Valuables')]/following-sibling::table[1]",
  );
  await propertySection.waitForExist({ timeout: 10000 });
  let sectionText = await propertySection.getText();
  console.log("property section after add:", sectionText);
  if (!sectionText.includes("Home") || !sectionText.includes("$350,000.00")) {
    throw new Error(`expected Home at $350,000.00, got:\n${sectionText}`);
  }

  // Total Assets / Net Worth stats live on the Accounts tab now (1000
  // checking + 350000 home = 351000 net worth).
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();
  const netWorthStat = await app.browser.$("//span[text()='Net Worth']/parent::button");
  await netWorthStat.waitForExist({ timeout: 5000 });
  let netWorthText = await netWorthStat.getText();
  console.log("net worth stat after add:", netWorthText);
  if (!netWorthText.includes("$351,000.00")) {
    throw new Error(`expected Net Worth to include the $350,000 asset, got:\n${netWorthText}`);
  }

  // Back to Reports to edit the value — scoped to the table row containing
  // "Home" specifically.
  await reportsNav.click();
  const valueCellXPath = "//tr[.//div[text()='Home']]//span[contains(@class,'amount-editable')]";
  const valueCell = await app.browser.$(valueCellXPath);
  await valueCell.waitForExist({ timeout: 5000 });
  await valueCell.click();

  // setValue()'s internal clear-then-type sequence is unreliable against
  // this controlled React input in this WebView2/tauri-driver combo (the
  // element genuinely exists per getPageSource, but setValue reports "not
  // found") — click to focus, select-all, then type over it instead.
  const editInputXPath = "//tr[.//div[text()='Home']]//input[contains(@class,'amount-edit-input')]";
  const editInput = await app.browser.$(editInputXPath);
  await editInput.waitForExist({ timeout: 5000 });
  await editInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("400000");
  await app.browser.keys("Enter");

  await app.browser.waitUntil(
    async () => (await propertySection.getText()).includes("$400,000.00"),
    { timeout: 10000, timeoutMsg: "expected the edited value $400,000.00 to appear" },
  );

  // Delete it and confirm it's gone, with the stat back down to just cash.
  const deleteBtn = await app.browser.$("//table[.//th[text()='Value']]//button[text()='Delete']");
  await deleteBtn.click();
  const confirmDeleteBtn = await app.browser.$("//table[.//th[text()='Value']]//button[text()='Delete']");
  await confirmDeleteBtn.waitForExist({ timeout: 5000 });
  await confirmDeleteBtn.click();

  await app.browser.waitUntil(
    async () => (await propertySection.getText()).includes("No property or valuables tracked yet"),
    { timeout: 10000, timeoutMsg: "expected the asset to be gone after delete" },
  );

  await accountsNav.click();
  await netWorthStat.waitForExist({ timeout: 5000 });
  const netWorthAfterDelete = await netWorthStat.getText();
  console.log("net worth stat after delete:", netWorthAfterDelete);
  if (!netWorthAfterDelete.includes("$1,000.00")) {
    throw new Error(`expected Net Worth back down to $1,000.00, got:\n${netWorthAfterDelete}`);
  }

  console.log("FEATURE 11 E2E TEST PASSED");
} finally {
  await app.close();
}
