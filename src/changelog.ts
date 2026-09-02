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
  "1.1.5": [
    "\"Update now\" downloads the right installer for your system and opens it directly, instead of just linking to GitHub.",
    "Add a transaction to the Ledger by hand — no file import required.",
    "The Ledger's filters are decluttered — Search/Category/Account/Member stay visible, date range and tags now collapse into a \"More filters\" button.",
    "The Dashboard's recent transactions, upcoming bills, and budget summary now click through to the relevant tab.",
    "Cash Flow is now split into Overview / Forecast / Debt Payoff tabs instead of one long scrolling page.",
    "Smaller polish: a \"Due soon\" badge on upcoming recurring bills, labeled fields on the Investments \"Add holding\" form, and a clearer note distinguishing family members from profiles.",
  ],
  "1.1.6": [
    "Bulk-import investment holdings — \"Holdings\" is now a 5th section on the setup-data template (Reports tab), so you can add many stocks at once instead of one at a time.",
    "Two more live-price providers alongside Alpha Vantage: Finnhub (60 requests/minute, no daily cap) and Twelve Data (800 requests/day) — pick whichever fits your portfolio in Settings.",
    "Fixed an account's balance sometimes not reflecting a transaction added the same day its monthly balance rolled forward, until the next day.",
    "Fixed a payment applied to a credit card, loan, or mortgage counting twice — once as the real payment and again as an extra expense in Budget, Cash Flow, and category totals.",
  ],
  "1.1.7": [
    "The sidebar is now organized into groups — Overview, Money, Planning, Insights — with Settings and Help pinned below.",
    "Accounts is now its own page, split out of Reports, with its own Assets/Liabilities/Net Worth stats.",
    "The Ledger's toolbar is decluttered — Manage categories, Manage family members, Categorize uncategorized, and Export CSV now live behind a \"⋯\" menu.",
    "Budget now shows group-summary cards up top, and each budget line has its own progress bar alongside its budgeted/actual/remaining amounts.",
    "The Dashboard's Net Worth/Cash/Debt/Investments cards now show a trend sparkline and a 6-month change; its spending-by-category donut (and Cash Flow's matching one) now shows the total spent in the center.",
    "Recurring now has an Account column, and Suggested items are shown as cards instead of a table.",
    "Settings → Profiles: \"Use existing file…\" points Penny Worth at a pennyworth.db copied over from another computer, instead of only ever starting a new profile empty.",
    "Exporting the Ledger to CSV and re-importing that same file now actually preserves category, tags, and account — including creating any account that doesn't exist yet — instead of losing that data.",
    "Fixed \"Update now\" silently failing to open the downloaded installer.",
    "Fixed a debt payment applied to a credit card, loan, or mortgage still inflating Budget, Cash Flow, and category totals in a few more places the 1.1.6 fix missed.",
    "Smaller fixes: splitting a transaction now shows the split editor under the row you clicked instead of at the bottom of the table, the Dashboard's Upcoming Bills rows line up in two proper columns, and Budget's category dropdowns line up in a straight column.",
  ],
};
