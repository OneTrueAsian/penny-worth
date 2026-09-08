// E2E test for pinning a widget scoped to one specific account, bucket, or
// investment account (rather than only the fixed, always-aggregate
// widgets) — the new "Pin a specific item" group in the "+ Add widget"
// modal. Covers: picking an item via the inline dropdown adds the right
// card to the Dashboard with the right numbers; the pinned widget survives
// the normal Customize-mode remove control unchanged; and deleting the
// last holding behind a pinned investment-account widget prunes it from
// the saved layout instead of leaving a dead entry.
//
// Run with: node e2e/feature54_parameterized_dashboard_widgets.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Chase Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO buckets (name, target_amount, account_id) VALUES ('Vacation Fund', '1000.00', ?)", (checking_id,))
bucket_id = cur.lastrowid
cur.execute(
    "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?, '2026-08-01', '250.00', 'Seed')",
    (bucket_id,),
)
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Fidelity 401k', 'investment', '0')")
fidelity_id = cur.lastrowid
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'VTI', 'Vanguard Total Stock', 10, 100.00, 900.00, 'US Stocks')",
    (fidelity_id,),
)
`);

const app = await launchApp({ dbDir });
try {
  async function currentLayout() {
    return app.browser.execute(() => JSON.parse(localStorage.getItem("meadow-dashboard-grid-layout")));
  }

  async function enterCustomizeMode() {
    const customizeButton = await app.browser.$(".dashboard-toolbar button");
    await customizeButton.waitForExist({ timeout: 10000 });
    await customizeButton.click();
  }

  async function pinItem(label, optionText) {
    const addTile = await app.browser.$(".add-tile");
    await addTile.waitForExist({ timeout: 5000 });
    await addTile.click();

    const row = await app.browser.$(`//li[contains(@class,'category-manage-row')][span[text()='${label}']]`);
    await row.waitForExist({ timeout: 5000 });
    const select = await row.$("select");
    await select.selectByVisibleText(optionText);
    const addButton = await row.$("button=Add");
    await addButton.click();

    const modalActions = await app.browser.$(".modal-actions");
    const doneButton = await modalActions.$("button=Done");
    await doneButton.click();
  }

  await enterCustomizeMode();

  // Pin the account, the bucket, and the investment account, one at a time.
  await pinItem("Account", "Chase Checking");
  let layout = await currentLayout();
  const accountWidgetId = layout.find((item) => /^account:\d+$/.test(item.i))?.i;
  if (!accountWidgetId) throw new Error(`expected an "account:<id>" entry in the layout, got ${JSON.stringify(layout)}`);
  console.log("pinned account widget:", accountWidgetId);

  await pinItem("Bucket", "Vacation Fund");
  layout = await currentLayout();
  const bucketWidgetId = layout.find((item) => /^bucket:\d+$/.test(item.i))?.i;
  if (!bucketWidgetId) throw new Error(`expected a "bucket:<id>" entry in the layout, got ${JSON.stringify(layout)}`);
  console.log("pinned bucket widget:", bucketWidgetId);

  await pinItem("Investment account", "Fidelity 401k");
  layout = await currentLayout();
  if (!layout.some((item) => item.i === "investment:Fidelity 401k")) {
    throw new Error(`expected "investment:Fidelity 401k" in the layout, got ${JSON.stringify(layout)}`);
  }
  console.log("pinned investment widget: investment:Fidelity 401k");

  // Pinned account/bucket/investment widgets are sized and styled like a
  // stat tile (Net Worth, Cash, ...) — plain ".stat", not the full report
  // ".card" — so each one's name lives in a ".stat-label" span, found here
  // via a word-boundary class match (an unqualified contains(@class,'stat')
  // would also match ".stat-label"/".stat-value" etc. on the way up).
  function statWidgetFor(name) {
    return app.browser.$(
      `//span[contains(concat(' ', normalize-space(@class), ' '), ' stat-label ')][text()='${name}']` +
        "/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' stat ')][1]",
    );
  }

  // The account widget shows the right name and balance.
  const accountCard = await statWidgetFor("Chase Checking");
  await accountCard.waitForExist({ timeout: 10000 });
  const accountCardText = await accountCard.getText();
  if (!accountCardText.includes("$1,000.00")) {
    throw new Error(`expected the Chase Checking widget to show $1,000.00, got: ${accountCardText}`);
  }
  // .stat-delta is plain text ("Balance"), .stat-label is styled
  // text-transform: uppercase ("CHASE CHECKING") — match case-insensitively.
  if (!/balance/i.test(accountCardText)) {
    throw new Error(`expected the Chase Checking widget to label its figure "Balance" (not a debt account), got: ${accountCardText}`);
  }
  console.log("Account widget shows the right balance:", accountCardText.replace(/\s+/g, " "));

  // The bucket widget shows the right saved/target and progress.
  const bucketCard = await statWidgetFor("Vacation Fund");
  await bucketCard.waitForExist({ timeout: 5000 });
  const bucketCardText = await bucketCard.getText();
  if (!bucketCardText.includes("$250.00") || !bucketCardText.includes("$1,000.00")) {
    throw new Error(`expected the Vacation Fund widget to show $250.00 of $1,000.00, got: ${bucketCardText}`);
  }
  console.log("Bucket widget shows the right saved/target:", bucketCardText.replace(/\s+/g, " "));

  // The investment widget shows the account's total value and gain/loss.
  const investmentCard = await statWidgetFor("Fidelity 401k");
  await investmentCard.waitForExist({ timeout: 5000 });
  const investmentCardText = await investmentCard.getText();
  if (!investmentCardText.includes("$1,000.00")) {
    throw new Error(`expected the Fidelity 401k widget to show a $1,000.00 total value, got: ${investmentCardText}`);
  }
  if (!investmentCardText.includes("$100.00")) {
    throw new Error(`expected the Fidelity 401k widget to show a $100.00 gain, got: ${investmentCardText}`);
  }
  console.log("Investment widget shows the right total value and gain:", investmentCardText.replace(/\s+/g, " "));

  // Already-pinned items drop out of their dropdown's options — Chase
  // Checking should be gone, but Fidelity 401k (never pinned as a plain
  // "account:" widget, only as an "investment:" one) should still be there.
  const addTileAgain = await app.browser.$(".add-tile");
  await addTileAgain.click();
  const accountRowAgain = await app.browser.$("//li[contains(@class,'category-manage-row')][span[text()='Account']]");
  await accountRowAgain.waitForExist({ timeout: 5000 });
  const remainingOptions = await accountRowAgain.$$("select option");
  const optionTexts = [];
  for (const option of remainingOptions) {
    optionTexts.push(await option.getText());
  }
  if (optionTexts.includes("Chase Checking")) {
    throw new Error(`expected "Chase Checking" to drop out of the Account dropdown once pinned, got options: ${optionTexts}`);
  }
  if (!optionTexts.includes("Fidelity 401k")) {
    throw new Error(`expected "Fidelity 401k" (never pinned as a plain account widget) to remain, got options: ${optionTexts}`);
  }
  console.log("Already-pinned Chase Checking correctly drops out of the Account picker; Fidelity 401k remains");
  const modalActionsAgain = await app.browser.$(".modal-actions");
  await (await modalActionsAgain.$("button=Done")).click();

  // The normal Customize-mode remove (✕) control works unchanged on a
  // parameterized widget — it's plain string-id equality under the hood,
  // no special-casing needed, but worth confirming directly.
  const bucketWidgetControls = await app.browser.$(
    `//span[contains(concat(' ', normalize-space(@class), ' '), ' stat-label ')][text()='Vacation Fund']` +
      "/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' stat ')][1]/parent::div",
  );
  const removeButton = await bucketWidgetControls.$(".dashboard-widget-controls button:last-child");
  // The sticky topbar overlaps whatever WebDriver's default scroll-into-view
  // lands on top of the viewport — center it instead so the real click point
  // isn't hidden behind the header (same root cause the driver reported:
  // "Other element would receive the click: <header class='topbar'>").
  await app.browser.execute((el) => el.scrollIntoView({ block: "center" }), removeButton);
  await removeButton.click();
  layout = await currentLayout();
  if (layout.some((item) => item.i === bucketWidgetId)) {
    throw new Error(`expected "${bucketWidgetId}" to be removed via the ✕ control, but it's still in the layout`);
  }
  console.log("Customize mode's remove control works on a parameterized (bucket) widget");

  // Deleting the last holding behind the pinned investment widget prunes
  // that dead reference from the saved layout instead of leaving it there.
  const investmentsNav = await app.browser.$("button*=Investments");
  await investmentsNav.click();
  // ".", not "text()", since the symbol ("VTI") sits in a nested
  // <div class="account-name-cell">, not a direct text child of the <td>.
  const holdingRow = await app.browser.$("//tr[td[contains(., 'VTI')]]");
  await holdingRow.waitForExist({ timeout: 10000 });
  await (await holdingRow.$("button=Delete")).click();
  await (await holdingRow.$(".btn-danger")).click();

  await app.browser.waitUntil(
    async () => {
      const l = await currentLayout();
      return !l.some((item) => item.i === "investment:Fidelity 401k");
    },
    { timeout: 10000, timeoutMsg: "expected the dead investment:Fidelity 401k entry to be pruned from the layout" },
  );
  console.log("Deleting the account's last holding pruned the pinned investment widget from the saved layout");

  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();
  const goneWidget = await app.browser.$(
    `//span[contains(concat(' ', normalize-space(@class), ' '), ' stat-label ')][text()='Fidelity 401k']`,
  );
  if (await goneWidget.isExisting()) {
    throw new Error("expected the Fidelity 401k widget to no longer render on the Dashboard after pruning");
  }
  console.log("Pruned widget no longer renders on the Dashboard");

  console.log("FEATURE 54 E2E TEST PASSED");
} finally {
  await app.close();
}
