// E2E test for the Ledger's "Needs a category" stat and its category
// filter dropdown: previously the dropdown only listed real, named
// categories plus "All categories" — there was no way to isolate the
// transactions the "Needs a category" stat counts, and the stat itself
// was a plain, non-interactive <div>. Covers both the new "Uncategorized"
// dropdown option and the stat now acting as a toggle shortcut for it.
//
// Run with: node e2e/feature49_ledger_uncategorized_filter.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '2026-09-05', 'Pizza Night', -33.09, 'Dining Out', 'user', 'fp1')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '2026-09-06', 'Speedway 47096', -35.39, NULL, NULL, 'fp2')",
    (checking_id,),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Ledger");
  await ledgerNav.click();

  const uncategorizedStat = await app.browser.$("//button[contains(@class,'stat')][.//span[text()='Needs a category']]");
  await uncategorizedStat.waitForExist({ timeout: 10000 });
  const statValue = await (await uncategorizedStat.$(".stat-value")).getText();
  if (statValue !== "1") {
    throw new Error(`expected the "Needs a category" stat to read 1, got "${statValue}"`);
  }

  const categorySelect = await app.browser.$(".ledger-filters select");
  const ledgerPage = await app.browser.$(".page");

  // Selecting "Uncategorized" from the dropdown should show only Speedway
  // 47096 (the NULL-category row), not Pizza Night.
  await categorySelect.selectByVisibleText("Uncategorized");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night");
    },
    { timeout: 5000, timeoutMsg: 'expected the "Uncategorized" filter to show only the uncategorized transaction' },
  );
  console.log('dropdown "Uncategorized" option correctly isolates the one uncategorized transaction');

  // Back to "All categories" — both rows should reappear.
  await categorySelect.selectByVisibleText("All categories");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && text.includes("Pizza Night");
    },
    { timeout: 5000, timeoutMsg: "expected clearing the category filter to show both transactions again" },
  );

  // Clicking the stat itself should apply the same filter as a shortcut.
  await uncategorizedStat.click();
  await app.browser.waitUntil(async () => (await categorySelect.getValue()) === "__uncategorized__", {
    timeout: 5000,
    timeoutMsg: 'expected clicking the "Needs a category" stat to set the category filter to Uncategorized',
  });
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night");
    },
    { timeout: 5000, timeoutMsg: "expected the stat-driven filter to show only the uncategorized transaction" },
  );
  console.log('clicking the "Needs a category" stat correctly filters the ledger');

  // Clicking it again toggles back to "all".
  await uncategorizedStat.click();
  await app.browser.waitUntil(async () => (await categorySelect.getValue()) === "all", {
    timeout: 5000,
    timeoutMsg: "expected clicking the stat a second time to clear the filter back to all categories",
  });

  console.log("FEATURE 49 E2E TEST PASSED");
} finally {
  await app.close();
}
