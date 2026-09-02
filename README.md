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

- **Dashboard** — net worth, this month's spending, budget alerts, and an
  **Insights** feed that surfaces things worth a look on its own: a
  category on pace to go over budget, a month-over-month spending jump, or
  an unusually large charge.
- **Ledger** — every transaction, filterable by account/category/tag/family
  member, with inline category correction (one at a time or in bulk),
  splitting a transaction across multiple categories, tagging, applying a
  payment toward a debt account, and — for households tracking more than
  one person — assigning any account, transaction, bucket, asset, or
  recurring item to a family member via **"Manage family members…"**.
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
  show a month-over-month trend per category. Further down, a **Forecast**
  projects your checking/savings balance 30, 60, or 90 days out, and the
  **Debt Payoff Planner** shows how fast your credit cards and loans clear
  under a snowball or avalanche strategy.
- **Recurring** — a maintained list of recurring bills/income, each
  showing its next expected date and editable in place. A **Suggested**
  section above it auto-detects merchant/amount pairs in your ledger that
  look recurring but aren't tracked yet, so you can add them with one
  click instead of typing them in by hand.
- **Investments** — holdings per account (shares, price, cost basis) with
  computed value and gain/loss, plus a **goal projection** calculator that
  projects a future balance from a starting amount, a monthly
  contribution, and an assumed annual return. Prices are manual by
  default; optionally turn on live pricing (Settings tab) to auto-fill a
  new holding's price by symbol and keep existing ones current
  automatically.
- **Reports** — accounts management, net worth breakdown, total saved,
  all-time income, spending by tag, this month's budget snapshot,
  **Property & Valuables** (manually tracked assets like a home or a
  vehicle, folded into your net worth), and the CSV/PDF export and
  setup-data import/export tools described below.
- **Settings** — separate profiles (completely independent data files you
  can create, switch, rename, and delete — see FAQ), where your data file
  lives (and a button to move it), your backup history with a manual
  "Back up now" and per-backup restore, and an optional live stock-price
  integration for the Investments tab.

## Importing transactions

From the **Ledger** tab, click **"Import transactions…"**:

1. Pick which account the file belongs to (or create a new one on the
   spot).
2. Choose the file exported from your bank or credit card — CSV, OFX/QFX,
   or QIF are all supported.
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

If you'd rather set up accounts, categories, budgets, buckets, and
investment holdings in bulk instead of one at a time through the UI, use
the two buttons on the **Reports** tab:

- **"Download setup template…"** saves one CSV file with a section for
  each of Accounts / Categories / Budgets / Buckets / Holdings, with one
  example row in each section to show the expected columns. Opens and
  saves fine in Excel.
- Open it, delete the example rows, fill in your own (keep the section
  titles and column headers as they are), and save.
- **"Import setup data…"** reads the file back in and shows you a review
  screen — anything that already exists is flagged, and you choose what
  to actually apply before anything is written.
- A blank `Period` on a budget row defaults to the current month.
- A Holdings row's `Account` must match an existing account's name exactly
  (case-insensitive) — a row whose account isn't found is flagged on the
  review screen and skipped, not partially created.

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

**Will I get a reminder before a bill is due?**
If a recurring bill (Recurring tab) is due within 3 days, Penny Worth
shows a native Windows notification — but only when you actually open the
app. This isn't a background reminder service; it doesn't run, and can't
notify you, while the app is closed.

**What happens if I import the same file twice?**
Every transaction is fingerprinted from its date, description, amount,
and account. An exact repeat is flagged as a likely duplicate in the
import preview and left unchecked by default, so re-importing the same
statement won't create doubled entries unless you explicitly check it
back in.

**How does Penny Worth suggest recurring items?**
The Recurring tab's "Suggested" section looks for a merchant and amount
that's repeated at least 3 times on a roughly consistent schedule (weekly,
biweekly, monthly, or annual) but isn't tracked yet. Add it with one click
to start it, or dismiss it if it's not actually recurring — a dismissed
suggestion won't reappear.

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

**How is the cash-flow forecast calculated?**
It's based on your actual history, not your listed recurring bills: it
takes your average daily net cash flow (income minus spending) over
roughly the last 90 days and projects that trend forward from your current
checking/savings balance. It's meant to answer "am I trending up or down,"
not to predict any specific upcoming bill.

**Can I exclude a debt from the payoff planner?**
Yes — uncheck "Include" on that debt's row. It's meant for something like
a credit card you pay off in full every month, which isn't really debt to
pay down and would otherwise distort the plan.

**Does net worth include my property and valuables?**
Yes — whatever you've entered under Property & Valuables (Reports tab) is
included in the current net worth figure everywhere it's shown. One
caveat on the Dashboard's net worth *trend* chart specifically: since a
manual asset only carries a value as of today, past points on that chart
apply today's value throughout rather than tracking what it was actually
worth back then.

**How do automatic backups work, and can I restore one?**
Penny Worth backs up your data file automatically once a day when you
open it, keeping the most recent 15 (Settings tab — also has a manual
"Back up now"). Restoring one first backs up your current data (so
restoring is itself reversible), then loads the restored data immediately
— no restart needed.

**Can I move my data file to a different folder?**
Yes — "Move data file…" on the Settings tab copies your live database to
a new folder you pick and starts using it right away. The old file is
left behind untouched, in case you want it back.

**Where's my data if I want to back it up myself?**
`%APPDATA%\com.<user>.pennyworth\pennyworth.db` is the entire ledger — copy
that one file to back it up or move it to another computer.

**Can Penny Worth track spending for multiple people?**
Two different ways, depending on what you actually want:

- **Family members** — tag any account, transaction, bucket, asset, or
  recurring item with who it belongs to, then filter down to just one
  person wherever a member filter appears. Everyone still shares the same
  file and sees the same data; it's attribution, not separation. Manage
  them from the Ledger tab's "Manage family members…" button.
- **Profiles** — completely separate, independent data files, one per
  person, with nothing shared between them. Switch profiles from the
  indicator in the sidebar, or manage them fully (create, rename, delete)
  from the Settings tab.

Use family members for one combined household view with who-spent-what
attribution. Use profiles for genuinely separate finances under one
install — roommates, or keeping a side business apart from personal
spending, for example.

**Can holding prices update automatically?**
Optionally — off by default, so nothing changes unless you turn it on. In
Settings, pick a provider (Alpha Vantage, Finnhub, or Twelve Data) and add
its free API key to enable it: new holdings can auto-fill their price by
symbol, and existing ones refresh automatically when the app opens and
every 2 hours it stays open (one request per distinct symbol you hold,
not per holding). Turn it off any time and prices go back to fully
manual. Alpha Vantage's free tier is capped at 25 requests/day, which
comfortably covers casual use; Twelve Data's free tier raises that to 800
requests/day for a larger portfolio; Finnhub's free tier allows 60
requests/minute instead, so there's no daily limit to track at all.
