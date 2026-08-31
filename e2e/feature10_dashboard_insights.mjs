// E2E smoke test for the Dashboard's proactive Insights card. Uses the
// "large expense" signal specifically (not the "on pace to exceed budget"
// signal, which is intentionally skipped before day 5 of the month — an
// E2E run can't control the app's real system clock, so a day-of-month-
// dependent fixture would be flaky) — seeds three small baseline "Dining
// Out" charges plus one much larger one, all dated relative to today so
// this passes regardless of what day it's actually run on.
//
// Run with: node e2e/feature10_dashboard_insights.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

cur.execute(
    "INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')"
)
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")

def dated(days_ago, description, amount):
    d = (today - datetime.timedelta(days=days_ago)).isoformat()
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
        (checking_id, d, description, amount, "Dining Out", f"{checking_id}|{d}|{description.lower()}|{amount}"),
    )

dated(150, "Cafe One", "-15.00")
dated(100, "Cafe Two", "-20.00")
dated(50, "Cafe Three", "-25.00")
dated(0, "Fancy Steakhouse", "-500.00")
`);

const app = await launchApp({ dbDir });
try {
  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();

  const insightsCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Insights']]",
  );
  await insightsCard.waitForExist({ timeout: 10000 });
  const cardText = await insightsCard.getText();
  console.log("insights card:", cardText);
  if (!cardText.includes("Fancy Steakhouse")) {
    throw new Error(`expected a large-expense insight mentioning "Fancy Steakhouse", got:\n${cardText}`);
  }
  if (!/info/i.test(cardText)) {
    throw new Error(`expected the insight to carry an "info" severity badge, got:\n${cardText}`);
  }

  console.log("FEATURE 10 E2E TEST PASSED");
} finally {
  await app.close();
}
