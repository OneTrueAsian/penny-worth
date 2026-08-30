# Penny Worth

*Get your penny's worth.*

A local, private budgeting and transaction ledger for Windows. There's no
account, no cloud sync, and no subscription — everything lives in a single
file on your own computer, and nothing is ever sent anywhere else.

## Installing

1. Run the installer you were given (`Penny Worth_x.x.x_x64-setup.exe`, or
   the `.msi` if you were sent that instead).
2. Windows may show a **"Windows protected your PC"** SmartScreen warning —
   see the FAQ below for why, and how to get past it.
3. Launch Penny Worth from the Start Menu. It starts completely empty — no
   sample data, nothing pre-loaded — ready for your own accounts and
   transactions.

## Getting started

1. **Add an account** — from the Reports tab ("Add account…"), or you'll be
   prompted automatically the first time you import a file. Checking,
   savings, credit card, loan, investment, and "other" are all supported.
2. **Get your transactions in**, either by importing a CSV from your bank
   (see below) or entering them by hand in the Ledger.
3. **Set up your budget** in the Budget tab — add a monthly amount per
   category, grouped as Income / Fixed / Flexible / Non-Monthly.
4. From there, the Dashboard and Cash Flow tabs summarize everything
   automatically — there's nothing else to configure.

## A tour of the tabs

- **Dashboard** — net worth, this month's spending, and budget alerts at a
  glance.
- **Ledger** — every transaction, filterable by account/category/tag,
  with inline category correction (one at a time or in bulk), splitting a
  transaction across multiple categories, tagging, and applying a payment
  toward a debt account.
- **Budget** — this month's budgeted vs. actual per category, with
  prev/next month navigation and drag-to-reorder. **Click any category
  name** to see every transaction behind that number and fix any that are
  miscategorized, right from that screen.
- **Buckets** — savings goals with a target amount/date, optionally linked
  to an account, with a running total and contribution history.
- **Cash Flow** — income vs. expenses over a 3 or 6 month window (with an
  optional year-over-year comparison); **click a bar** to see that month's
  spending by category and any unusually large charges. The "Top
  categories"/"Top merchants" cards below are scoped to a single month
  (defaulting to the current one, with a picker to look back further) and
  show a month-over-month trend per category.
- **Recurring** — a manually maintained list of recurring bills/income,
  each showing its next expected date.
- **Investments** — holdings per account (shares, price, cost basis) with
  computed value and gain/loss. This is a manual tracker, not a live
  market-data feed.
- **Reports** — accounts management, net worth breakdown, total saved,
  all-time income, spending by tag, this month's budget snapshot, and the
  CSV/PDF export and setup-data import/export tools described below.

## Importing transactions

From the **Ledger** tab, click **"Import CSV…"**:

1. Pick which account the file belongs to (or create a new one on the
   spot).
2. Choose the CSV file exported from your bank or credit card.
3. Confirm which way the amounts go. Penny Worth's convention is
   *negative = money out*; if your file shows charges as positive numbers
   (common for credit card exports), choose "Flip the signs" — otherwise
   "Keep as-is."
4. You'll see a preview of every row before anything is saved. Rows that
   look like duplicates of something already in your ledger are
   unchecked by default (see the FAQ on duplicates) — check or uncheck
   any row, or override which account a specific row should land in.
5. Confirm the import. Each new transaction is auto-categorized where
   possible; anything it can't confidently place is left Uncategorized
   for you to set yourself.

## Bulk setup-data import/export

If you'd rather set up accounts, categories, budgets, and buckets in bulk
instead of one at a time through the UI, use the two buttons on the
**Reports** tab:

- **"Download setup template…"** saves one CSV file with a section for
  each of Accounts / Categories / Budgets / Buckets, with one example row
  in each section to show the expected columns.
- Open it, delete the example rows, fill in your own (keep the section
  titles and column headers as they are), and save.
- **"Import setup data…"** reads the file back in and shows you a review
  screen — anything that already exists is flagged, and you choose what
  to actually apply before anything is written.
- A blank `Period` on a budget row defaults to the current month.

## Exporting your data

- **"Export CSV…"** (Reports tab) exports whatever rows are currently
  visible/filtered.
- **"Print / Save as PDF…"** opens your system print dialog against the
  current Reports view — choose "Save as PDF" as the destination if you
  want a file instead of a physical printout.

## FAQ

**Is my data private?**
Yes. Everything is stored in one SQLite file on your own computer
(`%APPDATA%\com.<user>.pennyworth\pennyworth.db`), created fresh the first
time you launch the app. There's no account, no server, and nothing is
ever uploaded — a fresh install on someone else's computer starts
completely empty, never with your data.

**I got a "Windows protected your PC" warning — is this safe?**
That's Windows SmartScreen, and it appears because this installer isn't
signed with a certificate Microsoft already recognizes — it doesn't mean
anything is actually wrong. Click **"More info"**, then **"Run anyway."**

**What happens if I import the same file twice?**
Every transaction is fingerprinted from its date, description, amount,
and account. An exact repeat is flagged as a likely duplicate in the
import preview and left unchecked by default, so re-importing the same
statement won't create doubled entries unless you explicitly check it
back in.

**How does auto-categorization work?**
New transactions are matched against rules first — an exact merchant
match, or a pattern Penny Worth has learned from a category you've
corrected before. Once you've made at least 10 corrections, a lightweight
classifier also kicks in for transactions the rules don't cover. Anything
neither can confidently place is left **Uncategorized** rather than
guessing — setting it yourself teaches the app for next time.

**Can I fix a transaction's category after the fact?**
Yes, several ways: the category dropdown on any Ledger row; selecting
several rows and using the Ledger's bulk-edit bar to recategorize them
all at once; or, from the Budget page, clicking a category name to see
every transaction behind that month's number and fixing any of them right
there (individually or in bulk).

**How do budgets carry forward month to month?**
A new month starts from whatever the closest earlier month had set for
each category, so you don't need to re-enter every line every month.
Changing the current month's amount never changes a past month's numbers.

**Can I split one transaction across multiple categories?**
Yes — the Ledger's "Split →" control on any transaction lets you divide
it into as many category/amount lines as you need, each with an optional
note.

**Does it support credit cards and loans, not just checking/savings?**
Yes — each account type tracks its balance the way that type actually
works: a credit card's balance is available credit, a loan's is what's
still owed, and a checking/savings/investment/other account's is a
literal balance.

**Where's my data if I want to back it up?**
`%APPDATA%\com.<user>.pennyworth\pennyworth.db` is the entire ledger — copy
that one file to back it up or move it to another computer.
