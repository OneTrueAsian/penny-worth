/** One entry per released version — shown once via `WhatsNewDialog` when
 * the installed version differs from what this viewer last saw (tracked in
 * localStorage by App.tsx). Bundled locally rather than fetched from
 * GitHub, so it works fully offline like the rest of the app. Add an entry
 * here as part of cutting each release, condensed from that release's
 * GitHub notes — a version with no entry here just shows nothing. */
export const CHANGELOG: Record<string, string[]> = {
  "1.1.2": [
    "Ledger columns are now sortable — click a header to sort by it, click again to flip direction.",
    "The Ledger's account filter is now a dropdown grouped by account type, with a checkbox per account so you can filter to several at once.",
    "\"Add to Recurring\" — select transactions in the Ledger and turn them directly into recurring items.",
    "Fixed the Dashboard's budget-alerts breakdown showing the wrong categories as over budget.",
  ],
  "1.1.3": [
    "A banner now lets you know when a newer version is available to download, checked once each time you open the app.",
    "The current version now shows in the sidebar, above the theme toggle.",
    "A \"What's new\" summary now appears once per version, whether you just installed for the first time or just updated.",
  ],
  "1.1.4": [
    "Family members — tag any account, transaction, bucket, asset, or recurring item with who it belongs to, then filter the Ledger down to just one person. Manage them from the Ledger tab.",
    "Profiles — add completely separate, independent profiles (their own accounts, transactions, everything) for genuinely separate finances, switchable anytime from the sidebar indicator.",
    "Optional live stock prices for Investments — add a free Alpha Vantage API key in Settings to auto-fill a new holding's price by symbol and keep existing ones current automatically, with a usage tracker that warns you before you hit Alpha Vantage's daily request limit.",
    "The Help page now has a search box that filters the whole page at once as it keeps growing.",
  ],
};
