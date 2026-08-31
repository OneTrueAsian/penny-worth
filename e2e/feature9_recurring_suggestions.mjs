// E2E smoke test for auto-detected recurring suggestions: seeds three
// monthly "Netflix" charges (no existing recurring row for it), confirms
// the Recurring tab's "Suggested" section surfaces it, then exercises both
// "Add" (promotes it into the real recurring table and the suggestion
// disappears) and, on a second detected merchant, "Dismiss" (also removes
// it from suggestions, without creating a recurring row).
//
// Run with: node e2e/feature9_recurring_suggestions.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
for date in ("2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
        (checking_id, date, "Netflix", "-15.49", "Subscriptions", f"{checking_id}|{date}|netflix|-15.49"),
    )
for date in ("2026-05-10", "2026-06-10", "2026-07-10"):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
        (checking_id, date, "Spotify", "-9.99", "Subscriptions", f"{checking_id}|{date}|spotify|-9.99"),
    )
`);

const app = await launchApp({ dbDir });
try {
  const recurringNav = await app.browser.$("button*=Recurring");
  await recurringNav.click();

  const suggestedCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Suggested']]",
  );
  await suggestedCard.waitForExist({ timeout: 10000 });
  let cardText = await suggestedCard.getText();
  console.log("suggested card (initial):", cardText);
  if (!cardText.includes("Netflix") || !cardText.includes("Spotify")) {
    throw new Error(`expected both Netflix and Spotify suggested, got:\n${cardText}`);
  }

  // Add the Netflix suggestion -> should land in the real recurring table
  // and drop out of Suggested.
  const netflixRow = await app.browser.$("//tr[.//div[text()='Netflix']]");
  await netflixRow.waitForExist({ timeout: 5000 });
  const netflixAddBtn = await netflixRow.$("button=Add");
  await netflixAddBtn.click();

  await app.browser.waitUntil(
    async () => {
      const text = await suggestedCard.getText().catch(() => "");
      return !text.includes("Netflix");
    },
    { timeout: 10000, timeoutMsg: "expected Netflix to drop out of Suggested after Add" },
  );

  // Both the Suggested section and the active list render a `table.ledger`
  // — disambiguate via the "Next due" header, unique to the active table
  // (Suggested has "Seen" instead).
  const activeTable = await app.browser.$("//table[contains(@class,'ledger')][.//th[text()='Next due']]");
  const activeText = await activeTable.getText();
  console.log("active recurring table after add:", activeText);
  if (!activeText.includes("Netflix")) throw new Error(`expected Netflix in the active recurring table, got:\n${activeText}`);

  // Dismiss the Spotify suggestion -> drops out of Suggested, and must NOT
  // appear in the active table (dismissal isn't the same as adding).
  const spotifyRow = await app.browser.$("//tr[.//div[text()='Spotify']]");
  await spotifyRow.waitForExist({ timeout: 5000 });
  const spotifyDismissBtn = await spotifyRow.$("button=Dismiss");
  await spotifyDismissBtn.click();

  await app.browser.waitUntil(
    async () => {
      const exists = await suggestedCard.isExisting();
      if (!exists) return true; // whole card unmounts once candidates is empty
      const text = await suggestedCard.getText().catch(() => "");
      return !text.includes("Spotify");
    },
    { timeout: 10000, timeoutMsg: "expected Spotify to drop out of Suggested after Dismiss" },
  );

  const activeTextAfterDismiss = await activeTable.getText();
  if (activeTextAfterDismiss.includes("Spotify")) {
    throw new Error(`Spotify should NOT be in the active recurring table after a dismiss, got:\n${activeTextAfterDismiss}`);
  }

  console.log("FEATURE 9 E2E TEST PASSED");
} finally {
  await app.close();
}
