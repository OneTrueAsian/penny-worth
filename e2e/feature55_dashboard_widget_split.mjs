// E2E test for the Dashboard widget split done in response to direct QA
// feedback (see "Dashboard testing findings"): the old combined "Stat
// cards" widget is now 4 independent stat widgets, "Trend & spending" is
// now 2 independent widgets (Net worth trend / Spending by category), and
// "Budget & bills" is now 2 independent widgets (This month's budget /
// Upcoming bills) — each individually selectable, movable, and removable.
// Also covers the two new optional report widgets added in the same pass
// (Income vs. expenses, Today's gain/loss) and the "+ Add widget" modal's
// search box, added once the catalog grew large enough to need one.
//
// Run with: node e2e/feature55_dashboard_widget_split.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, today, "Paycheck", "2000.00", "Income", f"{checking_id}|{today}|paycheck|2000.00"),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, today, "Groceries", "-300.00", "Groceries", f"{checking_id}|{today}|groceries|-300.00"),
)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0')")
brokerage_id = cur.lastrowid
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class, prev_close, prev_close_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (brokerage_id, "VTI", "Vanguard Total Stock", "50", "255.00", "10000.00", "Stocks", "250.00", today),
)
`);

const app = await launchApp({ dbDir });
try {
  async function currentLayout() {
    return app.browser.execute(() => JSON.parse(localStorage.getItem("meadow-dashboard-grid-layout")));
  }

  // The 4 stat cards are their own independent widgets now, not one
  // combined "Stat cards" block — each one's own grid slot contains
  // exactly one ".stat-label", where the old combined widget's single
  // slot would have contained all 4.
  async function statLabelCountInSameSlotAs(label) {
    return app.browser.execute((label) => {
      const span = Array.from(document.querySelectorAll(".stat-label")).find((el) => el.textContent === label);
      const slot = span?.closest(".dashboard-widget-slot");
      return slot ? slot.querySelectorAll(".stat-label").length : -1;
    }, label);
  }

  const initialLayout = await currentLayout();
  for (const id of ["stat_net_worth", "stat_cash", "stat_debt", "stat_investments"]) {
    if (!initialLayout.some((item) => item.i === id)) {
      throw new Error(`expected "${id}" in the default layout, got ${JSON.stringify(initialLayout)}`);
    }
  }
  console.log("Default layout has all 4 stat cards as independent widgets");

  for (const label of ["Net Worth", "Cash", "Debt", "Investments"]) {
    const count = await statLabelCountInSameSlotAs(label);
    if (count !== 1) throw new Error(`expected the "${label}" stat card to be alone in its own widget slot, found ${count} stat labels alongside it`);
  }
  console.log("Each stat card renders in its own widget slot, not bundled with the others");

  // "Trend & spending" and "Budget & bills" are each 2 independent
  // widgets now too.
  for (const title of ["Net worth trend", "Spending by category", "Upcoming bills"]) {
    const el = await app.browser.$(`//span[contains(@class,'reports-section-title')][text()='${title}']`);
    await el.waitForExist({ timeout: 10000 });
  }
  // The budget widget's own header is dynamic ("<month label>'s budget",
  // e.g. "September 2026's budget") — matched by suffix rather than the
  // catalog's static "This month's budget" label. `contains(., ...)`, not
  // `contains(text(), ...)` — the header is two sibling text nodes (the
  // `{report?.month_label ?? "This month"}` expression and the literal
  // "'s budget"), and XPath 1.0's `contains()` only looks at the *first*
  // node in a node-set, so `text()` here would only ever see the first
  // half; `.` uses the element's full string-value instead.
  const budgetHeader = await app.browser.$(`//span[contains(@class,'reports-section-title')][contains(.,"'s budget")]`);
  await budgetHeader.waitForExist({ timeout: 10000 });
  console.log("Net worth trend, Spending by category, This month's budget, and Upcoming bills all render as their own widgets");

  // "+ Add widget" now has a search box (the catalog grew from 10 to 17
  // fixed widgets across 3 groups) — search narrows the list, and an
  // unmatched query says so instead of showing an empty modal.
  const customizeButton = await app.browser.$(".dashboard-toolbar button");
  await customizeButton.waitForExist({ timeout: 10000 });
  await customizeButton.click();
  const addTile = await app.browser.$(".add-tile");
  await addTile.click();

  const searchInput = await app.browser.$(".widget-search-input");
  await searchInput.waitForExist({ timeout: 5000 });
  await searchInput.setValue("zzz-nonexistent-widget");
  const noMatch = await app.browser.$("//p[contains(text(),'No widgets match')]");
  await noMatch.waitForExist({ timeout: 5000 });
  console.log("Search box reports no matches for an unmatched query");

  // Search for the new "Today's gain/loss" report widget and add it.
  await searchInput.setValue("Today's gain");
  const todaysGainRow = await app.browser.$(
    "//li[contains(@class,'category-manage-row')][span[text()=\"Today's gain/loss\"]]",
  );
  await todaysGainRow.waitForExist({ timeout: 5000 });
  await (await todaysGainRow.$("button=Add")).click();
  console.log("Added Today's gain/loss via the search-filtered catalog");

  // Once added, it drops out of the catalog entirely (same convention as
  // an already-pinned account/bucket) rather than lingering as a disabled
  // "Added" row.
  await searchInput.setValue("Today's gain");
  const stillThere = await todaysGainRow.isExisting();
  if (stillThere) throw new Error("expected \"Today's gain/loss\" to drop out of the catalog once added");
  console.log("Today's gain/loss drops out of the catalog once it's on the Dashboard");

  await searchInput.setValue("");
  const modalActions = await app.browser.$(".modal-actions");
  await (await modalActions.$("button=Done")).click();

  // VTI: 50 shares * (255.00 - 250.00 prev close) = +$250.00 (2.00%).
  const todaysGainCard = await app.browser.$(
    "//span[contains(concat(' ', normalize-space(@class), ' '), ' stat-label ')][text()=\"Today's gain/loss\"]" +
      "/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' stat ')][1]",
  );
  await todaysGainCard.waitForExist({ timeout: 10000 });
  const todaysGainText = (await todaysGainCard.getText()).replace(/\s+/g, " ");
  if (!todaysGainText.includes("+$250.00")) throw new Error(`expected Today's gain/loss to show +$250.00, got: ${todaysGainText}`);
  if (!todaysGainText.includes("2.00%")) throw new Error(`expected Today's gain/loss to show 2.00%, got: ${todaysGainText}`);
  console.log("Today's gain/loss widget shows the right figures:", todaysGainText);

  // "Income vs. expenses" is pinned from its home tab (Cash Flow), same
  // as Allocation/Top merchants/Debt payoff/Net worth by member already
  // were before this pass.
  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();
  const incomeCardHead = await app.browser.$("//div[contains(@class,'card-head')][span[text()='Income vs. expenses']]");
  await incomeCardHead.waitForExist({ timeout: 10000 });
  const pinIncomeButton = await incomeCardHead.$("button=Pin to Dashboard");
  await pinIncomeButton.waitForExist({ timeout: 5000 });
  await pinIncomeButton.click();
  const pinnedLabel = await incomeCardHead.$(".pin-widget-pinned");
  await pinnedLabel.waitForExist({ timeout: 5000 });
  console.log("Pinned Income vs. expenses from the Cash Flow tab");

  const layoutAfterPin = await currentLayout();
  if (!layoutAfterPin.some((item) => item.i === "income_vs_expenses")) {
    throw new Error(`expected "income_vs_expenses" in the layout, got ${JSON.stringify(layoutAfterPin)}`);
  }

  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();
  const incomeWidget = await app.browser.$(
    "//div[contains(@class,'card-head')][span[text()='Income vs. expenses']]/parent::div",
  );
  await incomeWidget.waitForExist({ timeout: 10000 });
  const incomeWidgetText = (await incomeWidget.getText()).replace(/\s+/g, " ");
  if (!incomeWidgetText.includes("$2,000.00")) throw new Error(`expected Income vs. expenses to show $2,000.00 income, got: ${incomeWidgetText}`);
  if (!incomeWidgetText.includes("$300.00")) throw new Error(`expected Income vs. expenses to show $300.00 expenses, got: ${incomeWidgetText}`);
  console.log("Income vs. expenses widget shows the right totals:", incomeWidgetText);

  console.log("FEATURE 55 E2E TEST PASSED");
} finally {
  await app.close();
}
