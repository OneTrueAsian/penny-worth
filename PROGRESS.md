# Penny Worth — TDD build progress

(Renamed from "Meadow", including the internal Tauri identifier
`com.joeyf.meadow` -> `com.joeyf.pennywise` and the db filename
`meadow.db` -> `pennywise.db`. The existing database was copied by hand
into the new AppData folder at rename time — the old
`%APPDATA%\com.joeyf.meadow\meadow.db` is left in place untouched as a
backup, not deleted. See the note in `src-tauri/src/lib.rs`.)

(Renamed again from "Penny Wise" to "Penny Worth" on 2026-08-30, including
the internal Tauri identifier `com.joeyf.pennywise` -> `com.joeyf.pennyworth`,
the db filename `pennywise.db` -> `pennyworth.db`, and the env-var override
`PENNYWISE_DB_DIR` -> `PENNYWORTH_DB_DIR`. As before, the existing database
was copied by hand into the new AppData folder at rename time — the old
`%APPDATA%\com.joeyf.pennywise\pennywise.db` is left in place untouched as
a backup, not deleted. Slogan changed to "Get your penny's worth." See the
note in `src-tauri/src/lib.rs`.)

Tracks the step-by-step plan. A step is checked off only after the user has
run the test (or the app) themselves and approved it. See the full plan at
`C:\Users\joeyf\.claude\plans\cozy-tickling-oasis.md` for rationale.

- [x] Step 0 — Clean slate + scaffold (Tauri v2 + React/TS + Rust `core`
      workspace; blank window opens; `cargo test` runs) — **confirmed by user**
- [x] Step 1 — Transaction model + CSV loader — **confirmed by user**
- [x] Step 2 — Local storage (SQLite via rusqlite) + import dedup — **confirmed by user**
- [x] Step 3 — Rule-based categorizer (seed keyword/merchant rules) — **confirmed by user**
- [x] Step 4 — Manual category correction — **confirmed by user**
- [x] Step 5 — Learning from corrections (rule promotion) — **confirmed by user**
- [x] Step 6 — Classifier layer (hand-rolled Naive Bayes) — **confirmed by user**
- [x] Step 7 — Categorizer orchestration (rules -> classifier -> Uncategorized) — **confirmed by user**
- [x] Step 8 — End-to-end learning-loop acceptance test — **confirmed by user**
- [x] Step 9 — Wire into Tauri commands + React UI — **confirmed by user** (superseded/extended by Step 12's account-aware wiring)
- [~] Step 10 — (stretch) category management, confidence indicator, packaging — split into 10a/10b/10c
  - [x] Step 10a — Confidence indicator — **confirmed by user**. `Classifier::predict_with_confidence` (softmax over Naive Bayes log-scores), threaded through `categorizer::categorize`, persisted in a new `transactions.confidence` column, shown as a "xx%" badge on classifier-sourced rows only.
  - [x] Step 10b — Category management — **cargo test: 62/62, tsc clean, not yet live-tested by user**. `Store::list_categories/rename_category/delete_category` (rename also serves as merge), 3 new Tauri commands, "Manage categories…" panel in the UI (`Modal.tsx`'s `ManageCategoriesDialog`) with inline rename and delete (resets affected transactions to Uncategorized, removes matching rules).
  - [ ] Step 10c — Packaging — not started.
- [x] Step 11 — Account entity + Store integration (Rust core only) — **confirmed by user**
- [x] Step 12 — Wire accounts into Tauri commands + React UI — **confirmed by user**
  - Hotfix landed: pre-Step-11 databases (created before `account_id` existed)
    now migrate automatically instead of erroring on every account-aware
    query.
  - Also replaced `window.prompt`/`window.confirm` (the "localhost:1420
    says" browser popups) with real in-app modals (`src/Modal.tsx`): new
    account, new category, and the invert-amounts question all now render
    inside the app itself. New account creation is also now one form
    (name + type together) instead of two sequential prompts.
  - Two more real bugs found via direct testing and fixed via TDD:
    1. CSV loader assumed every file has a header row; a real export with
       none (every line straight data) had its first real transaction
       consumed as a phantom header and then failed entirely. Now detects
       a headerless file (row 1 parses cleanly as date+amount) and treats
       every row as data.
    2. `Store::labeled_history` (the classifier's training corpus) included
       the classifier's *own* past guesses, not just rule/user-confirmed
       categories — a self-reinforcing feedback loop: one early weak guess
       became "training data" for the next import, compounding indefinitely.
       Confirmed directly in the user's real database (26 of 28 real
       transactions in a fresh account had all been guessed "Entertainment"
       by the classifier). Now excludes classifier-sourced rows from the
       training corpus entirely.
  - Real database cleared (twice, at user's request) to start fresh once
    these fixes landed.
- [x] Step 13 — Duplicate-import detection in `core::store` — **cargo test -p budget_core: 53/53, plus 1 integration test**
  - Dropped the `UNIQUE` constraint on `fingerprint` (now a plain index).
  - New `Store::check_duplicates(account_id, txns) -> Vec<bool>` — a pure
    read; flags which of the given transactions already exist in that
    account, without writing anything.
  - `Store::save_transactions` is now an unconditional insert; `SaveReport`
    simplified to `{ inserted }`. Duplicate handling moved entirely to the
    caller, proven by a new test that saves the same row twice on purpose.
- [x] Step 14 — Preview/commit import flow + duplicate-review panel in the UI — **confirmed by user**
  - `import_csv` replaced by `preview_import` (parses + checks duplicates,
    no writes) and `commit_import` (re-parses, re-derives the same
    new/duplicate split, inserts every new row plus any duplicate row the
    user explicitly asked to keep, then categorizes as before).
  - `App.tsx`: importing with no overlap goes straight through as before;
    an import with any duplicates instead shows a review panel — summary
    line, one row per duplicate with a checkbox (unchecked = excluded by
    default, same as the old silent behavior), Confirm/Cancel.
  - Live-tested by the user against a real overlapping-date-range import
    scenario — confirmed working.
- [x] Step 15 — Editable amount/account in the ledger + delete a transaction — **cargo test: 69/69 at the time, tsc clean, not yet live-tested by user**
  - `Store::update_transaction_amount`/`update_transaction_account` recompute
    the fingerprint so dedup stays correct against the corrected value;
    `delete_transaction` is a plain delete, harmless no-op on an unknown id
    (same convention as `set_category`).
  - Ledger: amount is click-to-edit (commits on blur/Enter), account is a
    dropdown of existing accounts, and each row has a Delete button with an
    inline confirm (no native `window.confirm`).
- [x] Step 16 — Savings buckets — **cargo test: 78/78 at the time, tsc clean, not yet live-tested by user**
  - New tables `buckets` (name, optional target) and `bucket_contributions`
    (bucket_id, date, amount — a negative amount is a withdrawal). A
    bucket's saved amount is always computed fresh as the sum of its
    contributions (via `Decimal` in Rust, not SQL float math) rather than
    stored as a running total, so it can't drift out of sync.
    `create_bucket` / `list_buckets` / `add_bucket_contribution` /
    `delete_bucket` (deletes its contributions too, done explicitly rather
    than via `ON DELETE CASCADE` since this connection doesn't set `PRAGMA
    foreign_keys = ON`).
  - New "Buckets" tab (`src/BucketsView.tsx`): progress cards per bucket
    (saved / target with a progress bar when there's a target), an inline
    "add contribution" form per card, "New bucket…", delete with inline
    confirm.
  - Introduced a small tab bar in `App.tsx` (Ledger / Buckets / Budget /
    Reports) since this is the first of three new top-level views.
- [x] Step 17 — Budgets + category linkage — **cargo test: 83/83 at the time, tsc clean, not yet live-tested by user**
  - New table `budgets` (category, monthly target amount — a flat "current
    target," not month-by-month history). `set_budget` (upsert) /
    `list_budgets` / `delete_budget`.
  - New "Budget" tab (`src/BudgetView.tsx`): a simple category/amount table
    with add and delete (inline confirm).
  - "Budget categories flow into the category list": the ledger's
    per-transaction category picker now merges budgeted category names in
    alongside the existing hardcoded suggestions, so setting a budget for
    e.g. "Pet Care" makes it selectable immediately, even before any
    transaction uses it.
- [x] Step 18 — Reporting — **cargo test: 83/83, tsc clean, `npm run build` clean, not yet live-tested by user**
  - `Store::total_saved()` — all-time sum across every bucket's
    contributions.
  - `Store::income_total()` — all-time sum of transactions categorized
    "Income" (matches the existing seed-rule convention, doesn't invent a
    second definition of income).
  - `Store::monthly_budget_actuals(year, month)` — for every budgeted
    category, its target vs. actual spend in that specific calendar month
    (0 rather than omitted if nothing's been spent yet); scoped to a month
    because comparing an all-time total against a "monthly" target
    wouldn't mean anything.
  - Single `get_report` Tauri command bundles all three, computing the
    current year/month via `chrono::Local::now()` in `commands.rs` (kept
    out of `core`, which stays clock-free/deterministic for testing).
  - New "Reports" tab (`src/ReportsView.tsx`): Total Saved / Income stat
    cards, then a "this month's budget" table (budgeted / actual /
    remaining, remaining shown in red when negative).

## Bugs found during live testing (post Step 18)

- **Fixed** — new categories weren't selectable on other transactions.
  Root cause: categories had no persisted identity at all — the ledger's
  picker only ever showed a hardcoded suggestion list plus budget
  categories, never categories already assigned elsewhere. Fixed by adding
  a real `categories` table (seeded once with the standard defaults plus
  anything already in use, so existing data isn't lost) that
  `set_category`, `create_category`, `set_budget`, `rename_category`, and
  `delete_category` all keep in sync. `list_categories` is now this
  table's single source of truth for every category picker in the app.
- **Fixed** — "Business Expense" (and any other unused default) didn't
  show up in Manage Categories, so it couldn't be removed. Same root
  cause/fix as above — defaults are now ordinary rows in the registry,
  fully rename/delete-able like anything else.
- **Added** — Manage Categories now has an "Add" form so a category can be
  created directly there, selectable immediately, without needing to first
  assign it to a transaction.
- **Changed** — Budget tab's category field is now a dropdown of real
  categories (from the same registry as everything else) instead of free
  text, so a budget line can never drift from an actual transaction
  category. The table now also shows "Spent this month" and "Remaining"
  next to each budgeted category (same this-month actuals the Reports tab
  uses), and the monthly amount is click-to-edit in place instead of only
  settable via the add form.
- **Confirmed already correct** — deleting a category from Manage
  Categories already removed its budget line and reset its transactions to
  Uncategorized (from the earlier "Business Expense" fix).
- **Found and fixed while in this area** — renaming a category didn't
  carry its budget line forward, silently orphaning it under the old name.
  `rename_category` now moves the budget to the new name (or, if the
  target name already has its own budget, keeps the target's and drops the
  old one — same "the thing you're merging into wins" rule used
  everywhere else).

## Account balances (new feature, planned via `cozy-tickling-oasis.md`)

Each account now has a starting number the user enters — a current cash
balance for checking/savings/other, a credit limit for a credit account —
and a live current balance computed as `starting_balance + SUM(its own
transactions)`. Resolved design question (confirmed with the user):
accounts track themselves independently — no cross-account transfer
linking. This means the exact same formula covers both cases: for credit,
the "starting balance" is the limit and the running total is *available*
credit (a charge is a negative amount and reduces it, a payment is
positive and restores it) — just labeled differently in the UI, no special
-casing in the math.

- `core/src/store.rs`: `accounts.starting_balance` column (migration
  included for existing databases, backfilled to `'0'`). `StoredAccount`
  gains `starting_balance`/`current_balance` (computed fresh in
  `list_accounts`, summed in Rust with `Decimal`, same reasoning as
  bucket saved-amounts). New `set_account_starting_balance` (harmless
  no-op on an unknown id, same convention as everything else).
- `src-tauri/src/commands.rs`: `AccountDto` gains both fields;
  `create_account` accepts an optional starting balance; new
  `set_account_starting_balance` command.
- `src/Modal.tsx`'s `NewAccountDialog` gets an optional balance field,
  labeled "Credit limit" when the account type is Credit, "Starting
  balance" otherwise.
- `src/ReportsView.tsx` gains an "Accounts" section — the "reflect on the
  dashboard" part — with click-to-edit starting balance per account
  (same inline-edit pattern as ledger/budget amounts); credit accounts
  show "Owed / Available", everything else shows "Balance".
- `cargo test -p budget_core`: 96/96 (new-account defaults to 0, a
  checking-style balance moving with income/expense, a credit account's
  available credit moving with charges/payments, each account's balance
  independent of the others, editing the starting balance, editing an
  unknown id, and a migration test for a pre-existing database). Full
  workspace: `cargo test --workspace`, `tsc --noEmit`, and `npm run build`
  all clean. Not yet live-tested by the user.

## Bugs found during live testing (post account balances)

- **Added** — an account's type can now be corrected after creation
  (previously only the name/type were fixed at creation time, with no way
  to fix a mistake). `Store::update_account_type` (harmless no-op on an
  unknown id) + `update_account_type` command; the Reports tab's Accounts
  section now renders the Type column as a dropdown instead of plain text.
- **Fixed** — the Manage Categories dialog didn't resize to fit its
  content — a fixed 340px-wide panel with a fixed 320px-tall inner list
  cramped the Rename/Delete buttons and clipped the list awkwardly on
  screens with more categories than that. `ModalShell` now takes an
  optional `wide` flag (used only by Manage Categories, so plain-form
  dialogs are unaffected) for a 480px panel, the panel itself caps at the
  viewport height with its own scroll as a fallback, and the category
  list's scroll area is sized relative to viewport height (`60vh`) instead
  of a fixed pixel value.
- **Fixed (follow-up)** — the panel-width fix didn't fully solve it: the
  inline "confirm delete" row (a long message + two non-shrinking buttons)
  still overflowed the panel's width, and since every category row shares
  one scrollable list, that shared horizontal scroll position clipped
  every row's name, not just the one being deleted. Rows now wrap instead
  of overflowing — the confirm message drops to its own line above
  Cancel/Delete, and a category name truncates with an ellipsis if it's
  ever too long, with `overflow-x: hidden` on the list as a backstop.

## New feature — "Categorize uncategorized" button

A button in the ledger toolbar re-runs categorization over every
Uncategorized transaction right now, using whatever rules/classifier
training currently exist — useful after teaching the system more via
corrections without wanting to re-import. This is the same
`categorize_uncategorized` logic that already ran automatically after
every import, now also exposed as its own `recategorize_uncategorized`
command; it reports how many rows actually got categorized. `cargo test
--workspace`, `tsc --noEmit` both clean.

**Follow-up**: the button now shows a review panel after running, listing
exactly the rows it just categorized (the backend returns their ids, not
just a count) with an editable category dropdown per row — the same
Cancel/Confirm-free "just fix what's wrong" pattern as the rest of the
app, dismissed with a "Done" button. `cargo test --workspace`, `tsc
--noEmit` both clean.

## Monarch-inspired feature set (Steps 19–29)

User supplied a Monarch Money-styled mockup (`monarch-ledger.html`),
approved building 10 of its gaps (everything except an Advice/Insights
page) plus a full visual reskin to match its style. Full comparison and
per-step design lives in `cozy-tickling-oasis.md`. Investments (Step 27)
uses manual price entry, not a live market-data API (confirmed with the
user). Sequenced by dependency, not original numbering; each step gets
the same TDD treatment as every step before it.

- [x] Step 19 — Visual shell: sidebar nav, design tokens, theme toggle —
  **`tsc --noEmit`, `npm run build`, `cargo test --workspace` all clean;
  not yet live-tested by the user.**
  - `index.html`: Google Fonts link (Instrument Sans / Public Sans / IBM
    Plex Mono), page title fixed from the Tauri scaffold default.
  - `src/App.css`: full rewrite onto CSS custom-property tokens matching
    the mockup's palette (`--bg`, `--surface`, `--sidebar-bg`, `--accent`,
    etc.), light tokens at `:root`, dark tokens under both
    `@media (prefers-color-scheme: dark)` (guarded by
    `:not([data-theme="light"])`) and `[data-theme="dark"]` — this is
    what makes the manual toggle below work cleanly instead of
    duplicating hardcoded colors per rule the way dark mode used to.
  - `src/App.tsx`: replaced the horizontal tab bar with a left sidebar
    (brand mark, nav list, theme toggle) + a `.topbar`/`.page` main area;
    the `Tab` union and `activeTab` state are unchanged — this was a
    restyle, not a routing rewrite. Added a light/dark/system theme
    toggle (Penny Wise only had automatic OS dark mode before), persisted to
    `localStorage` as a UI preference (not app data, so not in SQLite).
  - The old "Reports" tab stays as-is for now — it gets split apart as
    Accounts (Step 22), Budget grouping (Step 24), and Dashboard (Step
    29) land.
- [x] Step 20 — Delete an account — **cargo test: 100/100, tsc clean, not yet live-tested**
  - `Store::delete_account` cascades the account's own transactions
    (an account can't be left with `transactions.account_id NOT NULL`
    pointing at nothing), harmless no-op on an unknown id, returns how
    many transactions were removed. Delete button + inline confirm added
    to the Reports tab's Accounts section (shows the transaction count
    that will go with it).
- [x] Step 21 — Institution name + masked account number — **cargo test: 104/104, tsc clean, not yet live-tested**
  - `accounts` gains nullable `institution`/`mask` columns (migration
    included). `Store::set_account_details` (harmless no-op on an
    unknown id). New-account dialog gets both as optional fields; the
    Accounts section shows "Chase •••• 4821" style under the account
    name, click-to-edit for existing accounts.
- [x] Step 22 — Account grouping + Net Worth — **cargo test: 106/106, tsc clean, not yet live-tested**
  - `AccountType` gains `Loan` and `Investment` variants plus a
    `group()` helper (Checking/Savings → cash, Credit → credit, Loan →
    loan, Investment → investment, Other → other) — no changes to the
    balance formula itself, a Loan account reuses Credit's exact math
    with different labels (see the plan file's Context section for why
    that's correct).
  - Reports tab's Accounts section now groups accounts into cards by
    that grouping with a per-group subtotal, plus Total Assets / Total
    Liabilities / Net Worth headline stats. For debt-style accounts
    (credit/loan), the subtotal/net-worth contribution is the *derived*
    "owed" (`starting_balance − current_balance`), not the "available"
    number shown per-row — same underlying data, different framing for
    a total that's supposed to represent debt.
- [x] Step 23 — Transaction search & filters — **tsc clean, `npm run build` clean, not yet live-tested**
  - Frontend-only: a filter bar above the ledger (description search,
    category, account, from/to date) filters the already-loaded
    transaction list client-side — personal-scale data, no new backend
    query needed. No `cargo test` changes (nothing new on the backend).
- [x] Step 24 — Grouped, month-navigable Budget page — **cargo test: 109/109, tsc clean, not yet live-tested**
  - `budgets` gains a `budget_group` column (Income/Fixed/Flexible/
    Non-monthly, migration included, defaults to `'flexible'`).
    `set_budget`/`list_budgets`/`monthly_budget_actuals` all thread it
    through now (returning `BudgetLine`/`BudgetActual` structs instead of
    growing tuples). New `budget_actuals_for_month` command exposes
    arbitrary-month lookups (`get_report` stays pinned to "now" for the
    Reports dashboard specifically).
  - Budget tab: prev/next month navigation, categories grouped into four
    cards with per-group subtotals, and the group itself is editable
    per-row via a dropdown (move a line between groups without
    delete+recreate).
- [x] Step 25 — Goals/Buckets extras — **cargo test: 112/112, tsc clean, not yet live-tested**
  - `buckets` gains nullable `target_date`/`account_id` (migration
    included; `account_id` is purely informational — it doesn't feed
    into any balance math, same as the mockup). New
    `update_bucket_details` (harmless no-op on an unknown id).
  - Buckets tab: a hand-rolled SVG progress ring (replacing the old
    linear bar) shows percent-to-target, a "days left" countdown from
    the target date, and the linked account's name, all next to each
    bucket card. New-bucket form gains target-date and linked-account
    fields.
- [x] Step 26 — Recurring bills/income tracking — **cargo test: 122/122, tsc clean, not yet live-tested**
  - New `recurring` table (merchant, category, amount, cadence, anchor
    date, optional linked account) — manually maintained, not detected
    from transaction history (real pattern-detection is a much harder
    problem, out of scope). Unlike the mockup, next-due date is
    *computed* fresh from anchor + cadence every read
    (`next_occurrence`, tested for weekly/biweekly/monthly/annual
    including month-length clamping, e.g. Jan 31 -> Feb 28) rather than
    stored, so it never goes stale once an occurrence passes.
  - New "Recurring" tab: monthly-equivalent expense/income totals, a
    list sorted by next-due date with a cadence badge, add/delete.
- [x] Step 27 — Investments/portfolio tracking — **cargo test: 128/128, tsc clean, not yet live-tested**
  - Manual price entry (confirmed with the user, not a live market-data
    API). New `holdings` table (account, symbol/name, shares, price,
    cost basis, asset class). `value`/`gain_loss` are always computed
    fresh from `shares`/`price`/`cost_basis` — never stored — so an
    updated price immediately recomputes both.
  - New "Investments" tab: portfolio value/cost-basis/gain-loss headline
    stats, holdings grouped by account, click-to-edit price (same
    pattern as every other editable amount in the app). No allocation
    donut yet — deferred to Step 28, which builds the shared chart
    components this needs.
- [x] Step 28 — Cash Flow page + shared chart infrastructure — **cargo test: 131/131, tsc clean, `npm run build` clean, not yet live-tested**
  - `src/charts.tsx`: hand-rolled inline-SVG `LineChart`, `BarChart`,
    `DonutChart`, `ProgressRing` (moved out of `BucketsView` into shared
    code) — no charting library, same technique as the mockup.
  - Backend: `monthly_totals(year, month)` (income/expense across *all*
    transactions, unlike `monthly_budget_actuals` which only covers
    budgeted categories), `spending_by_category(start, end)`,
    `top_merchants(start, end, limit)` (grouped by raw description —
    flagged as a known limitation, no normalized merchant-name concept
    exists yet). Bundled into one `get_cash_flow(months)` command.
  - New "Cash Flow" tab: 3/6-month income-vs-expense bar chart, top
    categories donut, top merchants list, savings rate.
  - Closed the loop on Step 27's deferred piece: Investments now has an
    asset-class allocation donut too, using this same chart infra.
- [x] Step 29 — Dashboard (final step) — **cargo test: 133/133, tsc clean, `npm run build` clean, not yet live-tested**
  - `Store::net_worth_as_of(date)` — total net worth counting only
    transactions on or before that date (cash/investment/other add,
    credit/loan subtract "owed"). No new snapshot storage — a historical
    trend is fully computable on demand from data already stored, for
    any past date. New `net_worth_history`/`spending_this_month`
    commands (past months valued as of their last day, the current
    month as of today — not "as of a month that hasn't happened yet").
  - New "Dashboard" tab, now the app's default view: Net Worth (with a
    6-month trend line and delta) / Cash / Debt / Investments KPI cards,
    a this-month spending-by-category donut, per-group budget progress
    bars (reusing Step 24's groups), upcoming bills (Step 26), and
    recent transactions.
  - `Transaction` moved from a type defined inline in `App.tsx` into
    `types.ts` so `DashboardView` could share it, matching every other
    shared shape.

## All 11 approved items (Steps 19–29) are implemented

Every step above is green on `cargo test --workspace` (133 unit + 1
integration test), `cargo check`, `npx tsc --noEmit`, and `npm run build`.
A live launch (`npm run tauri dev`) was also used after each major batch
to confirm the app actually starts with no compile/runtime error — see
below for the final one covering everything through Step 29. None of it
has been click-tested by the user yet (see the testing caveat in
`cozy-tickling-oasis.md` — no GUI-automation tool in this session).

## Current status

**Steps 0–9 and 11–14 are confirmed working end-to-end by the user,
including against real bank exports from multiple institutions. Step 10a
is also confirmed. Steps 10b and 15–18 are implemented and fully green
(`cargo test --workspace`: 83 unit + 1 integration, `cargo check`,
`tsc --noEmit`, `npm run build`) and the app has been launched
(`npm run tauri dev`) and confirmed to compile and run with no crash — but
have NOT yet been click-tested by the user.** They were built in a session
where the user was away and this agent has no GUI-automation tool, so only
compile/test/launch-level verification was possible (see the "Testing
caveat" in `cozy-tickling-oasis.md`). A separate message to the user lists
concrete manual test cases to run for all of Steps 10b and 15–18 when
they're back.

## Monthly balance rollover (manually-tracked accounts)

Added `balance_resets` table (`account_id, period "YYYY-MM", reset_date,
balance`, `UNIQUE(account_id, period)`). New shared helper
`Store::account_balance_as_of(account_id, starting_balance, as_of)`:
starts from the most recent reset at or before `as_of` (or the original,
never-mutated `starting_balance` if none yet), adds transactions dated
*after* that point through `as_of`. `list_accounts` and `net_worth_as_of`
both now delegate to it instead of their old inline
`starting_balance + all transactions` formulas — behavior is identical
when no reset exists (verified by the full existing test suite passing
unchanged), and a reset never retroactively changes a past-dated lookup
(new regression test covers this directly).

New `Store::roll_forward_monthly_balances(today)`: for every account,
if no reset exists yet for the current `YYYY-MM` period, computes
`account_balance_as_of(id, starting_balance, today)` and records it as
a fresh reset — idempotent (a period that already has one is skipped),
applies uniformly to every account regardless of type. New Tauri command
`check_monthly_rollover` calls it and returns only the accounts that
just got a fresh reset. `App.tsx` calls this once on startup (before the
first `refresh()`) and shows a one-time status note when anything
rolled forward.

Accepted limitation (documented in the code): a transaction imported
*later* with a date before the most recent reset won't affect *today's*
balance, only past point-in-time lookups — same spirit as the
top-merchants raw-description grouping already accepted elsewhere.

5 new unit tests (141 total unit + 1 integration), all passing. `cargo
check`, `tsc --noEmit`, `npm run build` clean; a live `npm run tauri dev`
launch against the real database confirmed the new table migrates in
without error.

## Per-month budgets (bug fix)

`budgets` used to be one global row per category (`category TEXT PRIMARY
KEY`) shared by every month — editing a budgeted amount changed it for
every month, past and future. Rebuilt with a composite `(category,
period)` key ("YYYY-MM") so each month is fully independent; a table
rebuild migration tags every pre-existing row with a sentinel period
("0000-01") so it becomes the template the first real month copies
forward from, preserving existing numbers exactly.

New `Store::list_budgets(period)` materializes a month's budget the
first time it's viewed by copying the most recent earlier month with
data (a one-time starting point, not an ongoing link — confirmed with
the user via AskUserQuestion, "copy last month's budget" over "start
blank"). A separate `budget_periods` tracking table records which
periods have been "touched" — needed because checking `budgets` directly
for "does this period have rows" broke once a period's last line was
deleted (it looked untouched again and silently resurrected the deleted
line from an earlier month on the next read); found by a dedicated test,
fixed before it shipped.

Found a second bug the same way, this time by inspecting the user's live
database directly: an intermediate build had already migrated their
`budgets` table to the period-scoped schema *before* `budget_periods`
existed, so the tracker never learned about the sentinel period and
their August budget view came back empty. Added
`Store::backfill_budget_periods_if_missing` — an unconditional,
idempotent backfill (`INSERT OR IGNORE ... SELECT DISTINCT period FROM
budgets`) that runs every launch regardless of migration history, plus a
regression test simulating exactly that scenario. The user's live
`budget_periods` table also needed a one-time manual fix (deleting the
artifact "touched but empty" row for their August period) since the code
fix alone can't undo state already written by the buggy intermediate
build.

Retired the old un-scoped `list_budgets` Tauri command/DTO entirely —
`BudgetView` now derives every row from `budget_actuals_for_month`
(already period-scoped) instead of a separate global list, removing the
two-sources-of-truth split that made the bug possible in the first
place.

## Seven financial-wellness features (in progress)

Planned via `cozy-tickling-oasis.md`: apply-payment-to-debt, budget
threshold alerts, anomaly flags (large/duplicate), split transactions,
tags, year-over-year/custom-range comparison, CSV/PDF export — built one
at a time, each with its own core tests, in that order.

Before starting: backed up the live database (`db-backups/` in the repo)
and added a `PENNYWISE_DB_DIR` env-var override in `src-tauri/src/lib.rs`
so automated testing never touches the user's real AppData database.

Also stood up real E2E UI testing this session (`e2e/`, see
`e2e/README.md`) — Tauri's official WebDriver support (`tauri-driver` +
Microsoft Edge WebDriver, since the app uses WebView2), driving the actual
compiled `.exe` through `webdriverio`, not a mock. Two non-obvious things
learned getting it working, both now documented in `e2e/README.md`: the
binary must be built via `npx tauri build --debug --no-bundle`, not a bare
`cargo build` (which silently produces a binary that can't find its own
embedded frontend assets); and a WebView2 automation session starts at
`about:blank` like a fresh browser session — Tauri does not auto-navigate
under `TAURI_WEBVIEW_AUTOMATION`, so the harness (`e2e/harness.mjs`)
navigates and waits for render once, up front.

### 1. Apply a payment to a debt

New `debt_payments` link table (`source_transaction_id` UNIQUE,
`debt_account_id`, `generated_transaction_id`, `amount`, `date`). Applying
a payment inserts a new transaction directly on the debt account (signed
to match a real imported payment: negative for a loan since
`current_balance` there *is* the amount owed, positive for credit since
`current_balance` there is *available* credit), copying the source
transaction's category/description — no reserved category name needed.
The applied amount is independent of the source transaction's own amount
and user-editable in the apply form (pre-filled with it, but overridable)
since a mortgage payment bundles principal/interest/escrow and only
principal should reduce what's tracked as owed — this was confirmed with
the user before building it. `delete_transaction` cascades both
directions (deleting the source removes the generated row too; deleting
the generated row cleans up the dangling link). Found and fixed a real
foreign-key-ordering bug via the first attempt at these tests: SQLite's
FK enforcement is on for this connection, so the link row has to be
deleted before either transaction row it references, not after.

UI: a new "Debt" column in the Ledger table. An unapplied outflow gets an
"Apply to a debt →" button (hidden on debt accounts' own rows) opening an
inline form (account picker + editable amount); an applied one shows a
"→ {account} (${amount})" badge with an Undo action. Verified end-to-end
with a real E2E spec (`e2e/feature1_debt_payment.mjs`): seeds a checking
+ loan account with a payment transaction (via direct sqlite, sidestepping
native file-picker automation for CSV import), drives the real Ledger UI
to apply it, and confirms both the badge and the underlying database rows.
Caught one real bug this way that no core test would have: the amount
field was pre-filled using the `$`-prefixed display formatter, which the
backend's plain-Decimal parser then rejected — fixed to pre-fill a plain
numeric string instead.

### 2. Budget threshold alerts

`Store::budget_alerts_for_month` — purely derived from the existing
`monthly_budget_actuals`, no new table. A category shows up once it's hit
80% of its budget (`"warning"`) or 100%+ (`"over"`); income lines and
zero-budgeted lines never alert (the former is already a positive shown
elsewhere, the latter has nothing to alert against). Budget page shows a
badge on each alerted row; Dashboard gets a compact banner ("2 over
budget, 1 approaching its limit") that expands into the existing
`StatDetailPanel` breakdown. Verified end-to-end
(`e2e/feature2_budget_alerts.mjs`): seeds an over-budget category, confirms
both the Dashboard banner and the Budget row's "Over" badge render.

### 3. Anomaly flags (large + duplicate)

`Store::anomaly_flags` — purely derived, no new table, computed over the
whole ledger every call (personal-scale data, same precedent as other
full-table scans in this file). "Large": a category needs at least 3
prior transactions in the trailing ~180 days to have a baseline; a
transaction over 2.5x that average *and* over $50 (a floor so a tiny
category's small swings don't misread as "unusual") is flagged. "Duplicate":
any two transactions, any accounts, same signed amount, within 3 days of
each other, whose descriptions match once normalized (lowercased,
whitespace collapsed, a trailing digit run like a store/reference number
stripped) — deliberately broader than the existing import-time fingerprint
dedup, which only stops literally re-importing the same file twice, not
two genuinely separate charges that happen to look identical (e.g. a
subscription billed twice). Ledger rows show a ⚠ (large) or ⧉ (duplicate)
badge with the reason as a tooltip. Verified end-to-end
(`e2e/feature3_anomaly_flags.mjs`).

### 4. Split transactions

New `transaction_splits` table (`transaction_id`, nullable `category` —
nullable the same way `transactions.category` is, so deleting a category
nulls it out here too instead of forcing the split to vanish — `amount`,
`note`). `Store::set_transaction_splits` replaces all of a transaction's
split lines at once (empty slice clears them); no sum-must-match-the-
parent validation on the backend — the Ledger UI enforces that itself (a
"remaining to allocate" total that must hit exactly $0.00 before "Save
splits" enables), matching this crate's existing trust-the-UI stance
elsewhere. `rename_category`/`delete_category` and `delete_transaction`'s
cascade were extended to also touch `transaction_splits`, same four/five-
table treatment as everywhere else category names are stored redundantly.

Every place that aggregates spend by category — `monthly_budget_actuals`
and `spending_by_category` (which backs both cash-flow's top-categories
and the Dashboard's spending-by-category donut) — was extended with a
`UNION ALL`: unsplit transactions contribute via their own category as
before, split lines contribute via their own category instead, and a
split transaction's own row is excluded from double-counting under its
original category.

Ledger UI: the category cell shows "Split (n)" instead of the usual
dropdown once split, with a "Split →"/"Edit splits" toggle that expands an
inline editor row below (per-line category + amount + note, add/remove
lines, a live remaining-to-allocate total gating Save, and a Clear splits
action to un-split). Verified end-to-end
(`e2e/feature4_split_transactions.mjs`): splits a seeded $100 transaction
into Groceries $60 / Household $40 through the real UI, confirms the "Split
(2)" summary, and checks the `transaction_splits` rows directly.

### 5. Tags

New `transaction_tags` table (`transaction_id`, `tag` COLLATE NOCASE,
composite PK — no separate master tag list, `SELECT DISTINCT tag` powers
autocomplete). `add_tag`/`remove_tag`/`list_all_tags`, cascaded from
`delete_transaction` the same way splits are. `all_transactions`'s query
gains tags via `GROUP_CONCAT(tag, char(31))` (a separator that can't
appear in a typed tag) parsed back into a list in Rust, alongside a
`GROUP BY t.id` (safe with the existing 1:0-or-1 debt-payment joins,
SQLite's relaxed GROUP BY semantics pick the single matching value per
group correctly).

Ledger: tag pills under each description with an inline "+ tag" input
(datalist-backed autocomplete from every tag in use) and a tag filter in
the toolbar. Reports gets a third top-level stat, "Tags in use," expanding
into a per-tag all-time spending breakdown (computed client-side from the
already-loaded `transactions`, same as the existing Income breakdown — no
new backend call needed). Verified end-to-end (`e2e/feature5_tags.mjs`):
tags a transaction from the real Ledger, confirms the pill and the filter
dropdown both pick it up, then confirms Reports' tag breakdown shows it.

### 6. Year-over-year cash flow comparison

Entirely in `src-tauri/src/commands.rs` (Rust) — `get_cash_flow`'s trailing-
window logic already lived there, not in `core`, so no `core` changes were
needed: `cash_flow_for_range` generalizes it to an explicit `[from, to]`
month range, and `year_over_year_cash_flow` runs the same range-bucketing
helper twice (the requested range, and the identical range shifted back
one year) and returns both series for the frontend to pair by index. A
month with no prior-year data comes back as zeros for free — `monthly_totals`
already sums an empty match set to zero, no special-casing needed.

Scope trim from the original plan, noted here rather than silently: instead
of a full custom "From"/"To" date-range picker replacing the existing 3/6-
month toggle, shipped a "Compare to last year" checkbox that reuses
whichever trailing window is already selected — smaller UI surface, still
delivers the actual ask (a year-over-year view), and `cash_flow_for_range`
is there if an arbitrary custom range is wanted later. Checking it swaps
the Income/Expense chart for a "This year" vs "Last year" net-cash-flow
comparison, paired month-by-month. Verified end-to-end
(`e2e/feature6_yoy_cashflow.mjs`).

### 7. CSV / PDF export

CSV export is entirely client-side (`src/csv.ts` — a tiny, dependency-free
CSV serializer) plus one new one-line Tauri command,
`write_text_file(path, content)` (a thin `std::fs::write` wrapper) — the
frontend already holds exactly the filtered/visible rows to export, so it
builds the CSV text itself and just needs the actual filesystem write done
on its behalf (sandboxed frontend JS can't do that directly). The
`@tauri-apps/plugin-dialog` `save()` picker (already a dependency both
sides, previously only `open()` had ever been used) supplies the
destination path. "Export CSV…" on Ledger exports whatever the current
search/category/account/date/tag filters are showing; on Reports it
exports the accounts table and this month's budget table together.

PDF export uses the browser engine's own print-to-PDF (a "Print / Save as
PDF…" button on Reports calling `window.print()`) rather than a new Rust
PDF-generation crate — a `@media print` stylesheet hides the sidebar/
toolbar/topbar so only the report content prints. This was a deliberate
simplicity tradeoff over adding `printpdf`/`genpdf` as a dependency,
flagged to the user rather than assumed.

**Known testing gap, stated plainly**: clicking either export button opens
a native OS dialog (a real Win32 file/print dialog, not an in-page
element) that WebDriver has no cross-platform way to interact with — the
same limitation this app's CSV *import* already has. `e2e/feature7_export.mjs`
verifies both buttons render, are wired to real accounts/report data, and
are enabled — it deliberately never clicks them, since doing so would hang
the dialog open with nothing able to dismiss it in an unattended run. The
underlying `write_text_file` command is a one-line `std::fs::write` wrapper
verified by code review rather than a test.

## Summary of this session's E2E test infrastructure

Real UI automation was stood up from scratch this session (`e2e/`, Tauri's
official WebDriver support — `tauri-driver` + Microsoft Edge WebDriver,
driving the actual compiled `.exe`, not a mock) and used to verify all
seven features end-to-end (six fully interactive, one presence/wiring-only
per the native-dialog limitation above). Every automated test run used an
isolated throwaway database (`PENNYWISE_DB_DIR`) — the user's real data was
never touched by any of this. See `e2e/README.md` for how to run these
again, and the two non-obvious setup gotchas (build via `tauri build
--debug --no-bundle`, not bare `cargo build`; a WebView2 automation session
starts blank and must be navigated once up front).

7 new unit tests (148 total unit + 1 integration), all passing. `cargo
check`, `tsc --noEmit`, `npm run build` clean.

## Post-launch fixes (live user feedback)

- **Year-over-year chart looked broken for Mar/Apr/May** — investigated by
  querying the user's live database directly rather than assuming a code
  bug: their transaction history starts 2025-06-02, so there is genuinely
  no 2025 data for those three months to compare against. Not a bug —
  explained to the user, with a follow-up offer (not yet taken) to show an
  explicit "no data" state instead of an invisible zero-height bar.
- **Budget row said "Over" at exactly 100% of budget** — `budget_alerts_for_month`
  used `pct >= 100` for `"over"`; landing exactly on budget (remaining ==
  $0.00) isn't overspending, only going past it is. Fixed to `pct > 100`;
  the badge itself now shows "100%" instead of "80%+" when `remaining` is
  exactly zero. Rewrote the test that had baked in the old behavior, added
  a new one for genuinely-over-budget, all passing.

## Bulk setup-data import (downloadable/re-uploadable template)

A companion to the Reports CSV export, running the opposite direction:
"Download setup template…" saves one combined CSV with a section each for
Accounts/Categories/Budgets/Buckets (confirmed scope — Recurring bills and
investment holdings stay UI-only for now, and transactions already have
their own dedicated CSV import), pre-filled with one example row per
section; the user fills in their own rows and "Import setup data…" reads
it back in. Section format mirrors `handleExportReportsCsv`'s existing
multi-section-in-one-file convention.

New `core/src/setup_import.rs` — a section-aware CSV parser (splits on
section-title lines, feeds each section's lines to the `csv` crate
independently), closely mirroring `csv_loader.rs`'s philosophy: a
`RowError` per malformed row (now tagged with which section, not just a
line number) collected rather than aborting the file, so one bad row never
costs any other good row in that section *or* any other. An unknown
account type or budget group is a row error, never silently defaulted. 11
tests, written first.

`Store::apply_setup_import` reuses each entity's existing, already-
idempotent-where-it-matters creation path — `get_or_create_account`,
`create_category` (`INSERT OR IGNORE`), `set_budget` (upserts on
`(category, period)`), `create_bucket` — so importing produces exactly
what typing the same values into the UI would. Only `create_bucket` errors
on a duplicate name by design; that specific error is caught per row and
recorded in a `skipped` list instead of aborting the rest of the import,
same "one bad row doesn't cost the good ones" stance as everywhere else.
Applies in a fixed order (Accounts, Categories, Budgets, Buckets) so a
bucket's `Linked Account` column can resolve by name to an account the
same file just created; an unresolvable linked-account name is also a
skip, not an error — the bucket itself still gets created, just unlinked.
5 tests, written first, including one that imports the same file twice
and confirms nothing errors or duplicates.

Tauri layer stays thin, mirroring `preview_import`/`commit_import`:
`preview_setup_import` parses and flags `already_exists`/`will_update` per
row (a pure read) for the frontend's review screen; `commit_setup_import`
re-parses the file rather than trusting client-echoed row data back (same
reasoning `commit_import`'s doc comment already gives), filters to the
rows the user kept checked, and calls `apply_setup_import`. Frontend
review screen mirrors the existing transaction-import preview table:
duplicates default unchecked (budget "will update" rows default checked,
since updating an existing line is usually the intent of re-uploading),
parse errors shown as a count only, not individually pickable.

191 unit tests total (up from 175), all passing; `cargo check`, `tsc
--noEmit`, `npm run build` all clean. E2E verification deferred — the
user's own dev session was running live when this shipped, and rebuilding
the E2E test binary would have conflicted with it the same way it did
once already this session; the core parsing/apply logic (where the real
complexity lives) has full unit coverage regardless.

**Follow-up bug, caught by the user from a screenshot of the downloaded
template**: the template's intro comment used a real em dash, and
`write_text_file` wrote plain UTF-8 with no byte-order-mark — Excel (and
other Windows tools) guess Windows-1252 without one, so the em dash came
back as mojibake ("â€""). Fixed at the root rather than just removing that
one character: `write_text_file` now prepends a UTF-8 BOM to everything it
writes (every CSV export and the setup template alike), and
`setup_import::load_setup_csv` strips a leading BOM back out when reading
a file this produced (2 new tests, written first — one confirming the BOM
doesn't break section-title matching, the round trip is safe). Also added
a characterization test proving the existing transaction CSV importer
(`csv_loader.rs`) already tolerates a BOM correctly via the underlying
`csv` crate, with no code change needed there — checked rather than
assumed, since the same class of bug could easily have hit a real bank
export saved via Excel's "CSV UTF-8" option. The em dash itself was also
just swapped for a plain hyphen, belt-and-suspenders. 193 unit tests
total, all passing.

## Cash-flow chart drill-down (click a bar for the month's detail)

Clicking a bar on the Cash Flow page's "Income vs. expenses" chart (or,
in compare-to-last-year mode, the "this year" side of a pair) opens a
dialog answering "what drove this month's number": expenses by category
(reusing `Store::spending_by_category`, so a split transaction's amount
is correctly attributed to its split categories, not lumped under the
parent), plus a "Large expenses" section calling out any unusually large
charges that occurred.

New `Store::large_expenses_in_range` (core, 4 tests written first) reuses
`anomaly_flags`'s existing "large" detection (2.5x a category's trailing-
180-day average, floor $50) rather than inventing a new definition,
joins in the actual transaction details (date/description/amount/
category) so the frontend doesn't need a separate lookup, filters to the
requested date range, and excludes "duplicate"-kind flags (a repeated
charge isn't a single large expense worth calling out here). Sorted
biggest-first.

`MonthTotalDto` gained `year`/`month` fields (previously only a
formatted `month_label` like "Aug", not enough to know *which* Aug when
resolving a click back to a real calendar month) — threaded through
`get_cash_flow`, `cash_flow_for_range`, and `year_over_year_cash_flow`.
New thin Tauri command `month_expense_detail(year, month)` bundles the
category breakdown and large-expense list for one month into a single
round trip, mirroring `get_cash_flow`'s "one call, everything the view
needs" shape.

Frontend: `BarChart` (`charts.tsx`) gained an optional `onBarClick`
prop — a plain click handler on the same invisible per-group hit-rect
already used for the hover tooltip, cursor only switches to a pointer
when a handler is passed, so this doesn't change any other `BarChart`
call site's behavior (there is only the one, in `CashFlowView`). New
`MonthExpenseDetailDialog` (`Modal.tsx`) reuses the existing modal shell
and the same category-bar / list styling already established elsewhere
on the page. 197 unit tests total, all passing; `cargo check`, `tsc
--noEmit`, `npm run build` all clean. E2E deferred, same reasoning as
the setup-import feature — the user's live dev session was running.

## Budget page category drill-down

Clicking a category name on the Budget page (e.g. "Utilities") opens a
dialog listing every transaction that counted toward that row's "actual"
for the month currently being viewed.

New `Store::transactions_for_category_in_month` (core, 3 tests written
first) mirrors `monthly_budget_actuals`'s split-aware SQL exactly (a
split transaction contributes its split lines instead of itself), so the
line items shown always sum to the same "actual" the budget row already
displays — no separate/inconsistent definition of "what's in this
category." New thin Tauri command `transactions_for_category(category,
year, month)`. Frontend: category name is now a clickable
`.category-link` span on `BudgetRow`; new `CategoryTransactionsDialog`
(`Modal.tsx`) reuses the existing `.ledger` table styling, marking a
split line's row with its note if one was given. 200 unit tests total,
all passing; `cargo check`, `tsc --noEmit`, `npm run build` all clean.
E2E deferred, same reasoning as the other recent features — the user's
live dev session was running.

**Follow-up**: each whole (non-split) row in the dialog now has a
category dropdown, so a miscategorized transaction can be reconciled
right from this drill-down instead of having to go find it in the
Ledger — same `correct_category` command and same dropdown options
(plus "+ New category…") the Ledger's own category column already
uses, no new backend code needed. A split line still shows its category
as plain text (no dropdown): a split's category lives on its own split
row, which already has a dedicated editor (Ledger's "Edit splits"), so
this doesn't duplicate that. Correcting a category refetches the
dialog's own list (the transaction no longer belongs to the category
being viewed, so it drops out immediately) plus the Ledger, budget
actuals, and budget alerts — same `Promise.all([refresh(), ...])`
pattern `handleRenameCategory`/`handleDeleteCategory` already use.

**Follow-up bug, caught by the user from a screenshot**: adding the
Category column pushed this dialog's 5-column table past the old fixed
`.modal-panel-wide` width (480px), so columns compressed (dates wrapped
to three lines, the category dropdown's text got clipped) and — because
CSS resolves `overflow-x` to `auto` on a box whose `overflow-y` is
non-`visible`, per the spec's overflow computation rule — the *entire*
modal panel scrolled sideways, title and Close button included, instead
of just the table. Fixed generally, not just for this one dialog:
`.modal-panel` now pins `overflow-x: hidden` so that quirk can't
resurface, `.modal-panel-wide` sizes from `min(760px, calc(100vw -
40px))` instead of a flat 480px so a wide dialog gets the room it
actually needs (and still shrinks on a small window) rather than every
"wide" dialog sharing one fixed number, and the table itself is now
wrapped in a new `.modal-table-scroll` container so if content ever
still exceeds the available width, only the table scrolls horizontally
— the rest of the dialog stays put. Pure CSS/markup change, no backend
or type changes; `tsc --noEmit` and `npm run build` clean.

**Follow-up**: the dialog now has the same bulk-edit bar the Ledger tab
does — a checkbox per whole (non-split) row, a "select all" header
checkbox, and a bar (shown once anything is selected) with "N selected",
a "Set category to…" dropdown (plus "+ New category…"), and "Clear
selection." Reuses the existing `bulk_correct_category` command and the
Ledger's own `.bulk-actions-bar` styling verbatim — no backend changes.
Deliberately left out bulk *delete* (the Ledger bar's other bulk
action): this dialog exists to reconcile categorization, not to remove
transactions, and the ask was specifically "bulk edit." Selection state
lives locally in `CategoryTransactionsDialog` (resets whenever the
dialog reopens for a different category, same as its other local UI
state) — only the actual mutation goes up to `App.tsx`, mirroring the
single-row edit added just before this. Split lines never get a
checkbox, same reasoning as their missing per-row dropdown. Pure
frontend change; `tsc --noEmit` and `npm run build` clean.

## Cash Flow "Top categories"/"Top merchants" now scoped to one month

These two cards used to summarize whatever the bar chart's own trailing
3/6-month window covered. Split apart on request: they now default to
the current month, with a "Category & merchant breakdown" month
dropdown (year-to-date only — January of the current year through the
current month, never a past year or a month with no data yet) to look
at an earlier month instead. The bar chart above is unchanged and keeps
its own independent 3/6-month range control.

No backend changes — `cash_flow_for_range(fromYear, fromMonth, toYear,
toMonth)` already computed both `top_categories` and `top_merchants` for
an arbitrary month range (it powers the custom date-range picker
elsewhere); calling it with the same month as both ends returns exactly
one month's breakdown for free. New `App.tsx` state
(`topCategoriesMonth`, `topCategoriesData`) and `CashFlowView` props,
refetched whenever the selected month changes or the tab is opened.
Pure frontend change; `tsc --noEmit` and `npm run build` clean.

**Follow-up, caught by the user from a screenshot**: the month dropdown
originally sat in its own header row above both cards, and — since it
had no matching CSS rule (every `<select>` in this app is styled by a
specific parent class, there's no app-wide bare `select` rule) —
rendered with the browser's unstyled default appearance instead of the
app's dark theme. Moved into the "Top merchants" card's own header,
top-right, per the user's mockup; gave it a dedicated `.month-select`
class (same declarations as the existing `.account-select`, this app's
established pattern for a standalone select outside a table). It still
drives both cards (a tooltip on the control says so), just lives
visually in one place now. Pure CSS/markup change; `tsc --noEmit` and
`npm run build` clean.

**Follow-up: month-over-month category trend.** The user asked what to
add given the "Top categories" card's spare vertical space; agreed
approach was a per-category trend rather than a budget overlay (the
Budget page already covers budgeted-vs-actual — a trend line is the
complementary view, not a duplicate). Each legend row now shows "▲12%"/
"▼8%" vs. the prior month, or "New" when the category had no spend at
all the month before (a percent change there would be either
meaningless or an infinite jump). Spend up is flagged the same color as
an over-budget amount elsewhere (`--negative`); down uses `--positive`.

New thin Tauri command `category_spending_for_month(year, month)` —
wraps `Store::spending_by_category` with no cap, unlike the `top_categories`
already on `CashFlowDto` (capped to 6 for the summary cards): a category
in the *current* month's top 6 can easily be outside the *prior*
month's top 6, so the trend's "previous" figure has to come from an
uncapped source or it would silently read as zero/"New" when it wasn't.
No new core code (reuses the already-tested `spending_by_category`) or
core tests, consistent with how other thin aggregating commands in this
file (`get_report`, `get_cash_flow`) aren't separately unit tested.
200 unit tests total (unchanged), all passing; `cargo check`,
`tsc --noEmit`, `npm run build` all clean.

**Follow-up, two small requests.** (1) "Top categories" typically has
far fewer rows than its "Top merchants" grid sibling, so the CSS grid's
default equal-height stretch left it with a small donut pinned to the
top and a lot of dead space below. New `.cashflow-category-card`/
`.cashflow-category-body` turn the card into a flex column (header,
then a flex-1 body that vertically centers the donut+legend) so the
content actually fills whatever height the grid gives it instead of
floating at the top. (2) "Top categories" has no month control of its
own — it was unclear from looking at it that it follows the selector
living in "Top merchants" below. Added a small read-only month label to
its header (reusing `.account-col`, the same muted style used
elsewhere) rather than a second selector, since two controls for one
piece of state would just invite them going out of sync. Pure CSS/
markup change; `tsc --noEmit` and `npm run build` clean.

## Step 10c — packaged for distribution (Windows)

`npm run tauri build` (via `npx tauri build` once `cargo`/`.cargo\bin` is on
PATH — the user's own PowerShell hit `npm.ps1`'s execution-policy block
running it directly; nothing to fix in the project, just run it from a
shell that doesn't restrict local scripts, or `npm.cmd` instead of `npm`)
produces two installers under `target/release/bundle/`: an NSIS
`Penny Worth_x.x.x_x64-setup.exe` and a `Penny Worth_x.x.x_x64_en-US.msi`.
No new code — `tauri.conf.json` already had `bundle.active: true` /
`targets: "all"`.

Decisions made for the first real distribution:
- **Version 1.0.0** (was 0.1.0) — `tauri.conf.json`, `src-tauri/Cargo.toml`,
  `package.json`.
- **Unsigned, with a warning instead of a certificate.** A trusted Windows
  code-signing cert requires real business verification through a CA under
  "Faas Consulting LLC" — not something achievable from a terminal, and
  the user chose to skip it for now. Recipients will see Windows
  SmartScreen's "unknown publisher" warning; a `READ BEFORE INSTALLING.txt`
  (explaining that it's expected, and how to click through it) now ships
  copied alongside both installers in `target/release/bundle/`.
- **macOS: explicitly deferred**, not attempted. Flagged to the user as a
  real architecture change (Tauri can't cross-compile a Mac build from
  Windows — it needs an actual Mac or macOS-hosted CI, plus a separate paid
  Apple Developer account for notarization) per their own instruction to
  stop and reevaluate before any major architecture change; no decision
  made yet on whether it's actually needed.
- `Cargo.toml` `authors = ["OneTrueAsian"]`, `license = "MIT"` (the user
  said "free" — not a valid Cargo/SPDX license string, so this interprets
  that as MIT rather than guessing something stricter or literally
  publishing with an invalid field) with a matching `LICENSE` file added at
  the repo root.
- `README.md` fully rewritten from the default Vite/Tauri scaffold text
  into real end-user documentation: install steps, a tour of every tab,
  full transaction-import walkthrough (sign-flip prompt, duplicate
  handling), the bulk setup-data import/export feature, CSV/PDF export,
  and an FAQ.

**Real icon.** The Tauri scaffold's placeholder icon set (`src-tauri/icons/`)
was replaced via `npx tauri icon <source.png>` from a real 1024×1024 source
(`src/assets/penny-worth-icon-1024.png`) — regenerates every Windows/macOS
size plus Windows Store tiles in place. The newer Tauri CLI also generates
iOS/Android sets this project doesn't use; deleted `icons/ios/`/`icons/android/`
after generating, since this project has no mobile targets.

**Follow-up, caught by the user:** the in-app sidebar still showed a
generic 🪙 emoji instead of the real icon, and `index.html`'s favicon
still pointed at the leftover Vite-template `vite.svg`. Fixed both — the
sidebar brand mark is now an `<img>` of the same source PNG (sized down
via CSS, no separate asset needed), and the favicon now points at a copy
of it under `public/`. Deleted the now-fully-unused scaffold leftovers
(`public/vite.svg`, `public/tauri.svg`, `src/assets/react.svg`) while in
there.

**Verifying "does a fresh install really start empty" scared the user
briefly:** installing the built app on the *same machine* used for `tauri
dev` showed their real data. Not a bug — both share the same Tauri
`identifier` (`com.joeyf.pennyworth`) and therefore the same
`%APPDATA%\com.joeyf.pennyworth\` folder, which already had the user's
real database copied into it during the Penny Wise → Penny Worth rebrand
earlier this session. Someone else installing on their own computer (or
the same user under a different Windows account) gets a genuinely fresh,
empty database — confirmed by explanation, not by actually renaming the
folder aside (user said they trusted the explanation, no need to prove it).

## In-app Help tab + first-launch welcome prompt

A new **Help** tab (`src/HelpView.tsx`, no props, no backend calls) puts
the same tour/import-instructions/FAQ content from `README.md` directly in
the app, so a user never has to go find a separate file. Keep the two in
sync when a feature changes — there's no shared source between them, by
design (the README needs to read fine outside the app too, e.g. attached
to the installer).

On first launch, a `WelcomeDialog` (same `ModalShell` every other dialog
uses) asks "Explore Help" vs. "Just get started" before showing anything
else. "Newly launched" is detected the same way the theme/nav-order
preference already is: a `localStorage` flag
(`pennyworth-welcome-seen`) — a fresh AppData profile (a real new install,
or someone else's computer) has never set it, so the prompt always
appears there exactly once; dismissing either way (including clicking
outside the dialog) marks it seen. No backend/DB involvement, matching how
this app already treats UI-only preferences as local-storage state, not
ledger data.

Pure frontend change; `tsc --noEmit` and `npm run build` clean.

Still-open question from Step 12: one real export (`2026-08-29_transaction_download.csv`)
has its own pre-existing `Category` column, currently ignored entirely.
Never decided whether to use it as a categorization hint/seed.

Run:
```
cd "E:\misc\Programming\Budgeting App"
npm run tauri dev
```
