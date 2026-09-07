// E2E test for the Investments tab's "Total gain/loss" and "Today's
// gain/loss" stat tiles becoming clickable, breaking down the aggregate
// into its per-holding contributions — the same "click a stat, see what
// makes it up" StatDetailPanel pattern the Dashboard/Accounts tabs already
// use for their own stat tiles.
//
// `prev_close_date` must be *today's actual date* for `day_gain_loss` to
// be populated at all (list_holdings only reports it when a holding's
// price was updated today — see core/src/store.rs's list_holdings) —
// seeded via Python's `datetime.date.today()`, not a hardcoded date.
//
// Run with: node e2e/feature48_investment_gain_breakdown.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0')")
account_id = cur.lastrowid
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class, prev_close, prev_close_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (account_id, "VTI", "Vanguard Total Stock", "50", "255.00", "10000.00", "Stocks", "250.00", today),
)
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class, prev_close, prev_close_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (account_id, "BND", "Vanguard Total Bond", "100", "72.00", "7500.00", "Bonds", "73.50", today),
)
`);

const app = await launchApp({ dbDir });
try {
  const investmentsNav = await app.browser.$("button*=Investments");
  await investmentsNav.click();

  const dayStat = await app.browser.$("button*=Today's gain/loss");
  await dayStat.waitForExist({ timeout: 10000 });
  // VTI: 50 * (255.00 - 250.00) = +$250.00; BND: 100 * (72.00 - 73.50) = -$150.00; net +$100.00.
  const dayStatText = await dayStat.getText();
  console.log("Today's gain/loss tile:", dayStatText);
  if (!dayStatText.includes("$100.00")) {
    throw new Error(`expected the Today's gain/loss tile to show +$100.00, got:\n${dayStatText}`);
  }

  await dayStat.click();
  const panel = await app.browser.$(".stat-detail-panel");
  await panel.waitForExist({ timeout: 5000 });
  let panelText = await panel.getText();
  console.log("day gain/loss breakdown panel:", panelText);
  if (!panelText.includes("What makes up Today's gain/loss")) {
    throw new Error(`expected the panel title to name Today's gain/loss, got:\n${panelText}`);
  }
  if (!panelText.includes("VTI") || !panelText.includes("250.00")) {
    throw new Error(`expected VTI's +$250.00 contribution in the breakdown, got:\n${panelText}`);
  }
  if (!panelText.includes("BND") || !panelText.includes("150.00")) {
    throw new Error(`expected BND's -$150.00 contribution in the breakdown, got:\n${panelText}`);
  }

  // Switching to the other gain/loss tile while the panel is open must
  // swap its content, not just leave the first breakdown showing.
  const totalStat = await app.browser.$("button*=Total gain/loss");
  await totalStat.click();
  await app.browser.waitUntil(
    async () => (await (await app.browser.$(".stat-detail-panel")).getText()).includes("What makes up Total gain/loss"),
    { timeout: 5000, timeoutMsg: "expected the panel to switch to the Total gain/loss breakdown" },
  );
  panelText = await (await app.browser.$(".stat-detail-panel")).getText();
  console.log("total gain/loss breakdown panel:", panelText);
  // VTI: 50 * 255.00 - 10000.00 = +$2,750.00; BND: 100 * 72.00 - 7500.00 = -$300.00.
  if (!panelText.includes("VTI") || !panelText.includes("2,750.00")) {
    throw new Error(`expected VTI's +$2,750.00 total gain in the breakdown, got:\n${panelText}`);
  }
  if (!panelText.includes("BND") || !panelText.includes("300.00")) {
    throw new Error(`expected BND's -$300.00 total loss in the breakdown, got:\n${panelText}`);
  }

  // Clicking the same tile again closes the panel — StatDetailPanel stays
  // mounted for a brief closing-transition window (see
  // useDelayedVisibility.ts), so wait past that before checking it's gone.
  await totalStat.click();
  await app.browser.waitUntil(
    async () => (await app.browser.$$(".stat-detail-panel")).length === 0,
    { timeout: 2000, timeoutMsg: "expected the breakdown panel to close after clicking its tile again" },
  );

  console.log("FEATURE 48 E2E TEST PASSED");
} finally {
  await app.close();
}
