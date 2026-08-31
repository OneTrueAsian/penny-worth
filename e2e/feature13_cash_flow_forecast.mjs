// E2E smoke test for cash-flow forecasting: seeds a checking account (with
// no transaction history, so the trailing-average slope is flat — see
// core/src/store.rs's cash_flow_forecast for the calculation itself, which
// has its own dedicated unit tests) and confirms the Cash Flow tab's
// Forecast card renders and that switching the day-range selector
// (30 -> 60 days) changes the projected chart data.
//
// Run with: node e2e/feature13_cash_flow_forecast.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();

  const forecastCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Forecast']]",
  );
  await forecastCard.waitForExist({ timeout: 10000 });

  // The chart is an SVG with a polyline for the balance line — just
  // confirm it rendered with real points (not stuck on "Loading…").
  await app.browser.waitUntil(
    async () => !(await forecastCard.getText()).includes("Loading"),
    { timeout: 10000, timeoutMsg: "expected the forecast chart to finish loading" },
  );
  const polyline = await forecastCard.$("polyline");
  await polyline.waitForExist({ timeout: 5000 });
  const pointsBefore = await polyline.getAttribute("points");
  console.log("30-day forecast polyline point count:", pointsBefore.trim().split(/\s+/).length);
  if (pointsBefore.trim().split(/\s+/).length < 20) {
    throw new Error(`expected ~31 points for a 30-day forecast, got too few: ${pointsBefore}`);
  }

  // Switch to 60 days and confirm the chart changes (more points). Plain
  // webdriverio text selector, not XPath text()= — the button's JSX is
  // `{d} days`, which renders as two separate text nodes ("60" and
  // " days"), and XPath's text() only matches a single text node.
  const sixtyDaysBtn = await app.browser.$("button=60 days");
  await sixtyDaysBtn.click();

  await app.browser.waitUntil(
    async () => {
      const p = await forecastCard.$("polyline");
      const pts = await p.getAttribute("points");
      return pts.trim().split(/\s+/).length > pointsBefore.trim().split(/\s+/).length;
    },
    { timeout: 10000, timeoutMsg: "expected the forecast chart to gain points after switching to 60 days" },
  );

  console.log("FEATURE 13 E2E TEST PASSED");
} finally {
  await app.close();
}
