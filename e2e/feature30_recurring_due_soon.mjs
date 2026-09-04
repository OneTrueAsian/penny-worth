// E2E smoke test for the Recurring tab's "Due soon" badge: seeds one item
// due within 3 days and one due further out, confirming only the near one
// gets the badge — same 3-day window the native bill notification already
// uses. `next_date` is always today-or-later (a lapsed anchor rolls
// forward automatically — see `next_occurrence` in core/src/store.rs), so
// there's no "overdue" state to test; only "due soon" exists.
//
// Run with: node e2e/feature30_recurring_due_soon.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

// Anchor dates are relative to the real wall-clock date, not hardcoded —
// a fixed absolute date (e.g. "2026-09-03") only stays "2 days from now"
// on the one day this test was written on; run it any later and the
// anchor has already lapsed, so `next_occurrence` correctly rolls it
// forward to next month and the "due soon" assertion below fails for
// reasons that have nothing to do with the feature under test.
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
due_soon = (today + datetime.timedelta(days=2)).isoformat()
due_later = (today + datetime.timedelta(days=24)).isoformat()
cur.execute(
    "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Rent', NULL, '-1500.00', 'monthly', ?)",
    (due_soon,),
)
cur.execute(
    "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Car Insurance', NULL, '-80.00', 'monthly', ?)",
    (due_later,),
)
`);

const app = await launchApp({ dbDir });
try {
  const recurringNav = await app.browser.$("button*=Recurring");
  await recurringNav.click();

  const rentRow = await app.browser.$("//tr[td[contains(.,'Rent')]]");
  await rentRow.waitForExist({ timeout: 10000 });
  const rentText = await rentRow.getText();
  console.log("Rent row (due in 2 days):", rentText);
  if (!rentText.includes("Due soon")) {
    throw new Error(`expected the "Due soon" badge on Rent (due in 2 days), got:\n${rentText}`);
  }

  const insuranceRow = await app.browser.$("//tr[td[contains(.,'Car Insurance')]]");
  const insuranceText = await insuranceRow.getText();
  console.log("Car Insurance row (due in 24 days):", insuranceText);
  if (insuranceText.includes("Due soon")) {
    throw new Error(`expected no "Due soon" badge on Car Insurance (due in 24 days), got:\n${insuranceText}`);
  }

  console.log("FEATURE 30 E2E TEST PASSED");
} finally {
  await app.close();
}
