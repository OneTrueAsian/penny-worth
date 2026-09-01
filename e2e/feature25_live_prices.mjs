// E2E smoke test for the opt-in live stock prices feature: confirms the
// Settings tab's "Live stock prices" card starts in the off/manual state,
// saving an API key flips it to the enabled state, and disabling clears it
// back — all purely local persistence (`set_live_price_api_key`), so this
// deliberately never calls `refresh_live_prices` or hits the real Alpha
// Vantage API. The live network path (autofill on symbol entry, the
// scheduled refresh, and the rate-limit error path) needs a real API key
// and is a manual-test-only path — see the plan's Known Risks section.
//
// Run with: node e2e/feature25_live_prices.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");

const app = await launchApp({ dbDir });
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const livePricesCard = await app.browser.$("//div[contains(@class,'card')][.//span[text()='Live stock prices']]");
  await livePricesCard.waitForExist({ timeout: 10000 });
  const beforeText = await livePricesCard.getText();
  console.log("live prices card before enabling:", beforeText);
  if (!beforeText.includes("Off by default")) {
    throw new Error(`expected the disabled/manual-only state by default, got:\n${beforeText}`);
  }

  const apiKeyInput = await livePricesCard.$("input");
  await apiKeyInput.setValue("demo-test-key");
  const saveButton = await livePricesCard.$("button*=Save");
  await saveButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Refresh now"), {
    timeout: 10000,
    timeoutMsg: "expected the card to switch to the enabled state after saving an API key",
  });
  const afterEnableText = await livePricesCard.getText();
  console.log("live prices card after enabling:", afterEnableText);
  if (!afterEnableText.includes("Last refreshed")) {
    throw new Error(`expected a "Last refreshed" line once enabled, got:\n${afterEnableText}`);
  }

  const disableButton = await livePricesCard.$("button*=Disable");
  await disableButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Off by default"), {
    timeout: 10000,
    timeoutMsg: "expected the card to return to the disabled/manual-only state after disabling",
  });
  console.log("live prices disabled successfully, back to manual-only state");

  console.log("FEATURE 25 E2E TEST PASSED");
} finally {
  await app.close();
}
