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
};
