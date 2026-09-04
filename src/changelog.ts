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
  "1.1.8": [
    "Success, error, and in-progress messages now look different from each other — color, icon, and a dismiss button — instead of one identical line for everything; errors stay up longer since they're more worth actually reading.",
    "Delete confirmations across the app (accounts, transactions, budget lines, recurring items, holdings, buckets, categories, family members, and profiles) now auto-cancel if left alone for a few seconds, and use a clearly different-colored button instead of a same-looking relabeled one.",
    "Dashboard's budget alerts now show the most-over-budget category first, instead of in whatever order categories happen to be listed.",
    "Every dialog can now be closed with Escape, and the sidebar's drag-to-reorder now also works from the keyboard — focus a tab and press Alt+↑/↓.",
    "Fixed the sidebar's group labels (\"OVERVIEW\", \"MONEY\", …) getting clipped instead of hiding when the window is narrow.",
  ],
  "1.1.9": [
    "A first-run checklist on the Dashboard walks new setups through adding an account, a transaction, and a budget, then gets out of the way.",
    "The Dashboard now shows a runway stat — how many months your liquid savings would cover at your recent average spend.",
    "Add Transaction now shows a live \"$X of $Y used\" line for the selected category's budget, and actually flags a non-numeric amount before you can save it.",
    "Flexible Spending categories on the Budget page now show a small trend sparkline of the last few months' actual spend.",
    "Recurring has a new Calendar view alongside the list, laying bills out on an actual month grid.",
    "Buckets' \"+ New bucket\" is now an in-grid tile instead of a separate button below the grid.",
    "The Ledger can save named filter combinations as chips for one-click reuse, and bulk-deleting transactions now shows an \"Undo\" toast instead of deleting immediately.",
    "Modals, the \"More\" menu, and expandable stat panels now animate open and closed; respects your OS's reduced-motion setting.",
    "StockData.org is now available as a live stock-price provider in Settings (100 requests/day, batches of up to 3 symbols per request).",
  ],
  "1.1.10": [
    "Investments now shows a \"Today's gain/loss\" figure, portfolio-wide and per-holding, based on the last price update of the day.",
    "Settings now has a permanent Release Notes section so you can look back at what changed in any past version, not just the one you just updated to.",
    "Fixed bill due-date checks and CSV export filenames occasionally landing on the wrong day depending on your timezone.",
    "Fixed switching or creating a profile occasionally losing track of which database file it was pointed at.",
    "Add Transaction, new holdings, and new assets now reject invalid or negative amounts instead of silently accepting them and corrupting totals.",
    "Contrast, keyboard, and screen-reader polish across the app: darker text and accent colors for readability, in-app messages that no longer shift the page when they appear, sparklines and filter checkboxes that expose their meaning to screen readers, and the Recurring calendar now shows each bill's amount directly instead of hiding it behind a tooltip.",
  ],
};
