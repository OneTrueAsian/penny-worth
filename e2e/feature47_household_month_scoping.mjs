// E2E test for Household's "Spending by person"/"Income by person" cards
// now being scoped to a specific month (U-7 from the performance/UI
// review) instead of all-time — previously these mixed an all-time figure
// against the monthly "Budget, by category and person" card on the same
// page. Seeds one member-attributed expense this month and a different
// one last month, then confirms the top card only shows the current
// month's amount, and updates when navigating to the previous month.
//
// Run with: node e2e/feature47_household_month_scoping.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
this_month = today.replace(day=15).isoformat()
prev_month_date = (today.replace(day=1) - datetime.timedelta(days=1)).replace(day=15)
prev_month = prev_month_date.isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
alex_id = cur.lastrowid

cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    (checking_id, this_month, "This Month Purchase", "-77.00", "Shopping", f"{checking_id}|{this_month}|this month purchase|-77.00", alex_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    (checking_id, prev_month, "Last Month Purchase", "-33.00", "Shopping", f"{checking_id}|{prev_month}|last month purchase|-33.00", alex_id),
)
`);

const app = await launchApp({ dbDir });
try {
  const householdNav = await app.browser.$("button*=Household");
  await householdNav.click();

  const spendingCard = await app.browser.$("//h2[contains(.,'Spending by person')]/parent::div");
  await spendingCard.waitForExist({ timeout: 10000 });
  let cardText = await spendingCard.getText();
  console.log("this month's spending-by-person card:", cardText);
  if (!cardText.includes("77.00")) throw new Error(`expected this month's $77.00, got:\n${cardText}`);
  if (cardText.includes("33.00")) throw new Error(`did not expect last month's $33.00 mixed in, got:\n${cardText}`);

  const prevMonthButton = await app.browser.$("button[aria-label='Previous month']");
  await prevMonthButton.click();

  await app.browser.waitUntil(
    async () => (await (await app.browser.$("//h2[contains(.,'Spending by person')]/parent::div")).getText()).includes("33.00"),
    { timeout: 5000, timeoutMsg: "expected the spending-by-person card to update to last month's $33.00" },
  );
  cardText = await (await app.browser.$("//h2[contains(.,'Spending by person')]/parent::div")).getText();
  console.log("last month's spending-by-person card:", cardText);
  if (cardText.includes("77.00")) throw new Error(`did not expect this month's $77.00 after navigating back, got:\n${cardText}`);

  console.log("FEATURE 47 E2E TEST PASSED");
} finally {
  await app.close();
}
