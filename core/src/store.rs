use crate::models::{Account, AccountType, Transaction};
use crate::rules::{Rule, RuleSet};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use rusqlite::{params, Connection};
use rust_decimal::Decimal;
use std::path::Path;
use std::str::FromStr;

/// The starter categories offered before the user has created or used any
/// of their own — seeded once into the `categories` table on a fresh
/// database (see `Store::seed_categories_if_missing`).
const DEFAULT_CATEGORIES: [&str; 10] = [
    "Rent",
    "Groceries",
    "Dining Out",
    "Utilities",
    "Transportation",
    "Entertainment",
    "Shopping",
    "Income",
    "Transfer",
    "Business Expense",
];

/// How a transaction's current category was decided — kept so a rule-guess
/// can later be told apart from something the user confirmed by hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CategorySource {
    Rule,
    User,
    Classifier,
}

impl CategorySource {
    pub fn as_str(self) -> &'static str {
        match self {
            CategorySource::Rule => "rule",
            CategorySource::User => "user",
            CategorySource::Classifier => "classifier",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "rule" => Some(CategorySource::Rule),
            "user" => Some(CategorySource::User),
            "classifier" => Some(CategorySource::Classifier),
            _ => None,
        }
    }
}

/// A transaction as it exists in the store, with the row id needed to
/// correct its category later, and which account it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredTransaction {
    pub id: i64,
    pub transaction: Transaction,
    pub category_source: Option<CategorySource>,
    pub confidence: Option<f64>,
    pub account_id: i64,
    pub account_name: String,
    pub applied_to_debt: Option<AppliedDebtPayment>,
    pub split_count: i64,
    pub tags: Vec<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// Which debt account this transaction's amount was applied toward paying
/// down (see `Store::apply_debt_payment`) — only ever set on the source
/// (e.g. checking-account) side of an applied payment, never on the
/// generated transaction it created on the debt account itself.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedDebtPayment {
    pub debt_account_id: i64,
    pub debt_account_name: String,
    pub amount: Decimal,
}

/// One line of a split transaction (see `Store::set_transaction_splits`) —
/// `category` is nullable the same way `transactions.category` is (a
/// deleted category nulls it out here too, rather than leaving a dangling
/// reference or forcing the split to vanish).
#[derive(Debug, Clone, PartialEq)]
pub struct TransactionSplit {
    pub id: i64,
    pub category: Option<String>,
    pub amount: Decimal,
    pub note: Option<String>,
}

/// An account as it exists in the store, with the row id `save_transactions`
/// and `all_transactions` reference it by, plus its balance — computed
/// with the same starting-balance-plus-transactions formula for every
/// account type, though what it *means* differs by type:
/// - Checking/savings/investment/other: `current_balance` is the literal
///   balance (a deposit is a positive transaction, a withdrawal negative).
/// - Credit: `starting_balance` is the credit limit, so owed starts at $0;
///   `current_balance` is available credit (a charge is negative and
///   reduces it, a payment is positive and restores it).
/// - Loan: `starting_balance` is the amount *currently owed* (not the
///   original principal), so the whole thing is debt from day one, same
///   as a fresh cash account's balance counts in full. `current_balance`
///   is what's still owed (a payment is a negative transaction — same
///   sign as any other outflow — and reduces it).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAccount {
    pub id: i64,
    pub account: Account,
    pub starting_balance: Decimal,
    pub current_balance: Decimal,
    pub institution: Option<String>,
    pub mask: Option<String>,
    /// Annual interest rate as a percentage (e.g. `24.99` for 24.99% APR) —
    /// only meaningful for credit/loan accounts, used by
    /// `Store::debt_payoff_projection`. `None` if never set.
    pub interest_rate: Option<Decimal>,
    /// Opts a debt account out of `debt_payoff_projection` without
    /// deleting it — e.g. a credit card the user pays off in full every
    /// month shouldn't be treated as debt to pay down.
    pub excluded_from_debt_payoff: bool,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SaveReport {
    pub inserted: usize,
}

/// A savings bucket (a named goal, e.g. "Emergency Fund"), with its saved
/// amount computed fresh from its contributions rather than stored as a
/// running total — so it's never out of sync with the contribution log.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredBucket {
    pub id: i64,
    pub name: String,
    pub target_amount: Option<Decimal>,
    pub saved_amount: Decimal,
    pub target_date: Option<NaiveDate>,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// A budgeted category's monthly target and which group it's organized
/// under (Income/Fixed/Flexible/Non-monthly).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetLine {
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: Decimal,
}

/// A budgeted category's target vs. actual spend for one specific
/// calendar month (see `Store::monthly_budget_actuals`).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetActual {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
}

/// A budgeted category that's at or near its monthly limit (see
/// `Store::budget_alerts_for_month`) — `level` is `"warning"` (>= 80% of
/// budget spent) or `"over"` (>= 100%).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetAlert {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
    pub pct: Decimal,
    pub level: String,
}

/// One transaction flagged as an anomaly (see `Store::anomaly_flags`) —
/// `kind` is `"large"` or `"duplicate"`, `detail` is a human-readable
/// explanation of why.
#[derive(Debug, Clone, PartialEq)]
pub struct AnomalyFlag {
    pub transaction_id: i64,
    pub kind: String,
    pub detail: String,
}

/// A proactive note for the Dashboard (see `Store::dashboard_insights`) —
/// `severity` is `"warning"` or `"info"`; `kind` is `"pace"` (on pace to
/// exceed a budget), `"category_jump"` (a month-over-month spending jump),
/// or `"large_expense"` (an unusually large charge this month).
#[derive(Debug, Clone, PartialEq)]
pub struct Insight {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

/// A "large" anomaly (see `Store::anomaly_flags`) with enough transaction
/// detail to display directly — used by `Store::large_expenses_in_range`
/// for the cash-flow chart's per-month drill-down, so the frontend doesn't
/// need to separately fetch and cross-reference the full transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct LargeExpense {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
    pub detail: String,
}

/// One line item contributing to a category's actual spend for a month
/// (see `Store::transactions_for_category_in_month`) — either a whole
/// transaction, or one split line of a split transaction (`is_split`),
/// kept as its own entry with just that split's own amount/note rather
/// than the parent transaction's full amount, matching how
/// `monthly_budget_actuals` attributes a split line to its own category
/// instead of the parent's.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryTransaction {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub account_name: String,
    pub is_split: bool,
    pub split_note: Option<String>,
}

/// What a setup-data import actually did (see `Store::apply_setup_import`)
/// — counts per section, plus a human-readable reason for every row that
/// was skipped rather than applied (e.g. a bucket name that already
/// exists).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SetupImportOutcome {
    pub accounts_created: usize,
    pub categories_created: usize,
    pub budgets_set: usize,
    pub buckets_created: usize,
    pub skipped: Vec<String>,
}

/// A recurring bill or income line — manually maintained, not detected
/// from transaction history (a real pattern-detection feature is a much
/// harder, fuzzier problem than this). `next_date` is computed fresh from
/// `anchor_date` + `cadence` relative to today every time this is read,
/// rather than stored — so it never goes stale the way a stored
/// "next date" would once its occurrence passes.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRecurring {
    pub id: i64,
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub next_date: NaiveDate,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// A pattern detected in the ledger that looks recurring but isn't yet
/// tracked in `recurring` — see `Store::detect_recurring_candidates`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecurringCandidate {
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub occurrence_count: usize,
}

/// An investment holding, with `value` and `gain_loss` computed fresh
/// from `shares`/`price`/`cost_basis` (never stored — a manually-entered
/// price should always immediately recompute both).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredHolding {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: Decimal,
    pub price: Decimal,
    pub cost_basis: Decimal,
    pub asset_class: Option<String>,
    pub value: Decimal,
    pub gain_loss: Decimal,
}

/// Opt-in live-price configuration (see `Store::get_live_price_settings`).
/// `api_key` being `None` means the feature is off — holding prices stay
/// fully manual, exactly like before this existed.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredLivePriceSettings {
    pub api_key: Option<String>,
    pub last_refreshed_at: Option<NaiveDateTime>,
}

/// A manually-tracked asset outside the accounts model — real estate, a
/// vehicle, or anything else with a value worth counting toward net worth
/// but no transaction history of its own. See `Store::total_assets_value`
/// for how (and deliberately how not) this feeds into net worth.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAsset {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: Decimal,
    pub valued_on: NaiveDate,
    pub notes: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// One debt's projected payoff (see `Store::debt_payoff_projection`) —
/// `payoff_date` is `None` if it isn't projected to clear within the
/// simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffLine {
    pub account_id: i64,
    pub account_name: String,
    pub starting_balance: Decimal,
    pub payoff_date: Option<NaiveDate>,
    pub total_interest_paid: Decimal,
}

/// The full result of `Store::debt_payoff_projection` — `total_months` and
/// `total_interest_paid` describe the plan as a whole (every debt clear,
/// and what interest that costs in total), `None` if not every debt
/// resolves within the simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffPlan {
    pub per_account: Vec<DebtPayoffLine>,
    pub total_months: Option<u32>,
    pub total_interest_paid: Decimal,
}

/// One day's projected total cash balance (see
/// `Store::cash_flow_forecast`).
#[derive(Debug, Clone, PartialEq)]
pub struct ForecastPoint {
    pub date: NaiveDate,
    pub balance: Decimal,
}

/// A household member a piece of data can be attributed to (see
/// `Store::create_family_member`) — deliberately just a name, no color or
/// login of its own; this is an attribution label, not an account.
#[derive(Debug, Clone, PartialEq)]
pub struct FamilyMember {
    pub id: i64,
    pub name: String,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let store = Store {
            conn: Connection::open(path)?,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let store = Store {
            conn: Connection::open_in_memory()?,
        };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                account_type TEXT NOT NULL,
                starting_balance TEXT NOT NULL DEFAULT '0',
                institution TEXT,
                mask TEXT,
                interest_rate TEXT,
                excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount TEXT NOT NULL,
                category TEXT,
                category_source TEXT,
                confidence REAL,
                fingerprint TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint);
            CREATE TABLE IF NOT EXISTS rules (
                pattern TEXT NOT NULL UNIQUE COLLATE NOCASE,
                category TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS buckets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                target_amount TEXT,
                target_date TEXT,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS bucket_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_id INTEGER NOT NULL REFERENCES buckets(id),
                date TEXT NOT NULL,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS budgets (
                category TEXT NOT NULL,
                period TEXT NOT NULL,
                monthly_amount TEXT NOT NULL,
                budget_group TEXT NOT NULL DEFAULT 'flexible',
                PRIMARY KEY (category, period)
            );
            CREATE TABLE IF NOT EXISTS recurring (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                category TEXT,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                anchor_date TEXT NOT NULL,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS recurring_dismissals (
                merchant TEXT NOT NULL,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                PRIMARY KEY (merchant, amount, cadence)
            );
            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                shares TEXT NOT NULL,
                price TEXT NOT NULL,
                cost_basis TEXT NOT NULL,
                asset_class TEXT
            );
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                value TEXT NOT NULL,
                valued_on TEXT NOT NULL,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS balance_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                period TEXT NOT NULL,
                reset_date TEXT NOT NULL,
                balance TEXT NOT NULL,
                UNIQUE(account_id, period)
            );
            CREATE TABLE IF NOT EXISTS budget_periods (
                period TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS debt_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                debt_account_id INTEGER NOT NULL REFERENCES accounts(id),
                generated_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                amount TEXT NOT NULL,
                date TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transaction_splits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                category TEXT,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS transaction_tags (
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                tag TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY (transaction_id, tag)
            );
            CREATE TABLE IF NOT EXISTS family_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS live_price_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_key TEXT,
                last_refreshed_at TEXT,
                requests_used_today INTEGER NOT NULL DEFAULT 0,
                requests_count_date TEXT
            );",
        )?;
        self.migrate_add_account_id_if_missing()?;
        self.migrate_add_confidence_if_missing()?;
        self.migrate_add_starting_balance_if_missing()?;
        self.migrate_add_institution_and_mask_if_missing()?;
        self.migrate_add_interest_rate_if_missing()?;
        self.migrate_add_excluded_from_debt_payoff_if_missing()?;
        self.migrate_add_budget_group_if_missing()?;
        self.migrate_budgets_to_period_scoped_if_missing()?;
        self.backfill_budget_periods_if_missing()?;
        self.migrate_add_bucket_extras_if_missing()?;
        self.migrate_add_member_id_to_accounts_if_missing()?;
        self.migrate_add_member_id_to_transactions_if_missing()?;
        self.migrate_add_member_id_to_recurring_if_missing()?;
        self.migrate_add_member_id_to_buckets_if_missing()?;
        self.migrate_add_member_id_to_assets_if_missing()?;
        self.migrate_add_live_price_request_tracking_if_missing()?;
        self.seed_categories_if_missing()
    }

    /// `live_price_settings` originally shipped with just `api_key`/
    /// `last_refreshed_at` — these two columns (the daily request counter
    /// used by `record_live_price_request`/`live_price_requests_used_today`)
    /// were added right after. Same missing-column pattern as every other
    /// migration here.
    fn migrate_add_live_price_request_tracking_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(live_price_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_requests_used_today = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "requests_used_today" {
                has_requests_used_today = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_requests_used_today {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE live_price_settings ADD COLUMN requests_used_today INTEGER NOT NULL DEFAULT 0", [])?;
        self.conn.execute("ALTER TABLE live_price_settings ADD COLUMN requests_count_date TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `target_date`/`account_id` are both
    /// nullable and optional — a missing-column database just needs the
    /// columns added, `NULL` is already correct for existing buckets.
    fn migrate_add_bucket_extras_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_target_date = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "target_date" {
                has_target_date = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_target_date {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN target_date TEXT", [])?;
        self.conn.execute("ALTER TABLE buckets ADD COLUMN account_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: a database from before grouped budgets
    /// existed has no `budget_group` column. Existing budget lines
    /// backfill to `'flexible'` — the same default a fresh line gets —
    /// rather than leaving them ungrouped.
    fn migrate_add_budget_group_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_budget_group = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "budget_group" {
                has_budget_group = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_budget_group {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE budgets ADD COLUMN budget_group TEXT", [])?;
        self.conn.execute(
            "UPDATE budgets SET budget_group = 'flexible' WHERE budget_group IS NULL",
            [],
        )?;
        Ok(())
    }

    /// `budgets` used to have one global row per category shared by every
    /// month (`category TEXT PRIMARY KEY`) — editing a budget amount
    /// changed it for every month, past and future, since there was only
    /// ever one row per category. Rebuilds the table with a composite
    /// `(category, period)` key so each calendar month gets its own
    /// independent row (SQLite can't change a primary key with `ALTER
    /// TABLE`, so this rebuilds it: rename, recreate, copy, drop). Every
    /// pre-existing row is tagged with a sentinel period ("0000-01",
    /// guaranteed to sort before any real month) so it becomes the
    /// template the first real month copies forward from (see
    /// `Store::list_budgets`), preserving today's numbers exactly until
    /// the user edits a specific month.
    fn migrate_budgets_to_period_scoped_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_period = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "period" {
                has_period = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_period {
            return Ok(());
        }

        self.conn.execute_batch(
            "ALTER TABLE budgets RENAME TO budgets_old;
             CREATE TABLE budgets (
                 category TEXT NOT NULL,
                 period TEXT NOT NULL,
                 monthly_amount TEXT NOT NULL,
                 budget_group TEXT NOT NULL DEFAULT 'flexible',
                 PRIMARY KEY (category, period)
             );
             INSERT INTO budgets (category, period, monthly_amount, budget_group)
             SELECT category, '0000-01', monthly_amount, budget_group FROM budgets_old;
             DROP TABLE budgets_old;",
        )?;
        Ok(())
    }

    /// Ensures `budget_periods` (the "has this month been touched"
    /// tracker `list_budgets` relies on) has an entry for every period
    /// that already has real rows in `budgets` — self-healing rather
    /// than seeded only inside the migration above, since a database
    /// migrated by an earlier build (before `budget_periods` existed)
    /// would otherwise have `period`-scoped budget rows the tracker
    /// never learned about, making them look untouched and silently
    /// invisible to `list_budgets` for any period that hasn't been
    /// independently touched since. Safe and cheap to run on every
    /// launch — an `INSERT OR IGNORE` over this app's tiny budgets table.
    fn backfill_budget_periods_if_missing(&self) -> rusqlite::Result<()> {
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) SELECT DISTINCT period FROM budgets", [])?;
        Ok(())
    }

    /// A category used to be purely implicit — whatever string happened to
    /// sit in `transactions.category` or `budgets.category` — which meant a
    /// suggested-but-unused category (like "Business Expense") had nowhere
    /// to live, and a brand-new category typed for one transaction wasn't
    /// selectable for any other until this table existed. Seeded once, the
    /// first time this table is empty, with the standard suggestions plus
    /// (for a database that already has data) whatever's already in use —
    /// so upgrading an existing database never loses a category someone's
    /// already using.
    fn seed_categories_if_missing(&self) -> rusqlite::Result<()> {
        let already_seeded: bool =
            self.conn
                .query_row("SELECT EXISTS(SELECT 1 FROM categories)", [], |row| row.get(0))?;
        if already_seeded {
            return Ok(());
        }

        for name in DEFAULT_CATEGORIES {
            self.conn
                .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        }
        self.conn.execute_batch(
            "INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL;
             INSERT OR IGNORE INTO categories (name) SELECT category FROM budgets;",
        )?;
        Ok(())
    }

    /// `CREATE TABLE IF NOT EXISTS` above only creates a fresh table — it
    /// never alters one that already exists. A database from before
    /// accounts existed has a `transactions` table with no `account_id`
    /// column at all, so every account-aware query fails outright. This
    /// adds the column and backfills existing rows into a fallback account
    /// rather than losing them.
    fn migrate_add_account_id_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_account_id = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "account_id" {
                has_account_id = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_account_id {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN account_id INTEGER", [])?;
        let fallback_id = self.get_or_create_account("Imported before accounts existed", AccountType::Other)?;
        self.conn.execute(
            "UPDATE transactions SET account_id = ?1 WHERE account_id IS NULL",
            params![fallback_id],
        )?;
        Ok(())
    }

    /// Same pattern as `migrate_add_account_id_if_missing`: a database from
    /// before the confidence indicator existed has no `confidence` column
    /// at all. `NULL` is already the correct value for every existing row
    /// (a rule match or a user correction never had a numeric confidence),
    /// so no backfill is needed beyond adding the column.
    fn migrate_add_confidence_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_confidence = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "confidence" {
                has_confidence = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_confidence {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN confidence REAL", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before account balances existed
    /// has no `starting_balance` column. Backfills existing accounts to
    /// `'0'` — the same default a fresh account gets — so their balance
    /// simply equals the sum of their transactions until the user sets a
    /// real one.
    fn migrate_add_starting_balance_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_starting_balance = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "starting_balance" {
                has_starting_balance = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_starting_balance {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN starting_balance TEXT", [])?;
        self.conn.execute(
            "UPDATE accounts SET starting_balance = '0' WHERE starting_balance IS NULL",
            [],
        )?;
        Ok(())
    }

    /// Same pattern once more: `institution`/`mask` are both nullable and
    /// optional, so a missing-column database just needs the columns
    /// added — `NULL` is already the correct "not set" value, no backfill.
    fn migrate_add_institution_and_mask_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_institution = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "institution" {
                has_institution = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_institution {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN institution TEXT", [])?;
        self.conn.execute("ALTER TABLE accounts ADD COLUMN mask TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `interest_rate` (an annual percentage, used
    /// by the debt payoff planner) is nullable and optional — a missing-
    /// column database just needs the column added, `NULL` already meaning
    /// "not set" (treated as 0% by `debt_payoff_projection`).
    fn migrate_add_interest_rate_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_interest_rate = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "interest_rate" {
                has_interest_rate = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_interest_rate {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN interest_rate TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `excluded_from_debt_payoff` lets a debt
    /// account (e.g. a credit card paid in full every month) opt out of
    /// `debt_payoff_projection` without deleting the account itself.
    /// Defaults to `0` (included) for every pre-existing row.
    fn migrate_add_excluded_from_debt_payoff_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "excluded_from_debt_payoff" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE accounts ADD COLUMN excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more, repeated per table: `member_id` (which
    /// `family_members` row this row is attributed to) is nullable and
    /// optional — a missing-column database just needs the column added,
    /// `NULL` already meaning "unassigned."
    fn migrate_add_member_id_to_accounts_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `transactions.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `recurring.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_recurring_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(recurring)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE recurring ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `buckets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_buckets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `assets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_assets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(assets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE assets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Finds an account by name, or creates it — so the UI can let a user
    /// re-type an existing account's name at import time without erroring.
    pub fn get_or_create_account(&self, name: &str, account_type: AccountType) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO accounts (name, account_type) VALUES (?1, ?2)
             ON CONFLICT(name) DO NOTHING",
            params![name, account_type.as_str()],
        )?;
        self.conn.query_row(
            "SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| row.get(0),
        )
    }

    /// The balance of one account as of `as_of`, honoring any monthly
    /// balance reset recorded for it (see `roll_forward_monthly_balances`):
    /// starts from the most recent reset at or before `as_of` (or the
    /// account's original, never-mutated `starting_balance` if there
    /// isn't one yet), then adds every transaction dated *after* that
    /// point through `as_of` — a reset's own balance already reflects
    /// everything up to its `reset_date`, so those transactions must
    /// never be summed again.
    fn account_balance_as_of(
        &self,
        account_id: i64,
        starting_balance: Decimal,
        as_of: NaiveDate,
    ) -> rusqlite::Result<Decimal> {
        let checkpoint = match self.conn.query_row(
            "SELECT reset_date, balance FROM balance_resets
             WHERE account_id = ?1 AND reset_date <= ?2
             ORDER BY reset_date DESC LIMIT 1",
            params![account_id, as_of.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((date, balance)) => Some((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("reset_date stored by this crate must be valid"),
                Decimal::from_str(&balance).expect("balance stored by this crate must be valid"),
            )),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        let (base_value, since_date) = match checkpoint {
            Some((date, balance)) => (balance, Some(date)),
            None => (starting_balance, None),
        };

        let transaction_amounts: Vec<String> = match since_date {
            Some(since) => {
                let mut stmt = self.conn.prepare(
                    "SELECT amount FROM transactions WHERE account_id = ?1 AND date > ?2 AND date <= ?3",
                )?;
                let rows =
                    stmt.query_map(params![account_id, since.to_string(), as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let mut stmt = self
                    .conn
                    .prepare("SELECT amount FROM transactions WHERE account_id = ?1 AND date <= ?2")?;
                let rows = stmt.query_map(params![account_id, as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };

        let total: Decimal = transaction_amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        Ok(base_value + total)
    }

    /// Every account, each with its balance computed fresh as of `today`
    /// (see `account_balance_as_of`) — not a stored running total, so
    /// it's never out of sync with either the transaction log or any
    /// monthly reset.
    pub fn list_accounts(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredAccount>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.account_type, a.starting_balance, a.institution, a.mask, a.interest_rate,
                    a.excluded_from_debt_payoff, a.member_id, fm.name
             FROM accounts a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })?;

        let mut accounts = Vec::new();
        for row in rows {
            let (id, name, account_type, starting_balance_str, institution, mask, interest_rate_str, excluded_from_debt_payoff, member_id, member_name) = row?;
            let starting_balance = Decimal::from_str(&starting_balance_str)
                .expect("starting_balance stored by this crate must be valid");
            let current_balance = self.account_balance_as_of(id, starting_balance, today)?;
            let interest_rate = interest_rate_str
                .map(|s| Decimal::from_str(&s).expect("interest_rate stored by this crate must be valid"));
            accounts.push(StoredAccount {
                id,
                account: Account {
                    name,
                    account_type: AccountType::parse(&account_type)
                        .expect("account_type stored by this crate must be valid"),
                },
                starting_balance,
                current_balance,
                institution,
                mask,
                interest_rate,
                excluded_from_debt_payoff,
                member_id,
                member_name,
            });
        }
        Ok(accounts)
    }

    /// Applies a parsed setup-import template (see `setup_import`) in a
    /// fixed order — accounts, then categories, then budgets, then
    /// buckets — so a bucket's `linked_account_name` can resolve against
    /// an account the same file just created. Every section reuses its
    /// normal creation path, so the result is exactly what typing the
    /// same values into the UI would produce: accounts via the idempotent
    /// `get_or_create_account`, categories via the `INSERT OR IGNORE`
    /// `create_category`, budgets via the upserting `set_budget` (a blank
    /// period falls back to `default_period` — passed in rather than read
    /// from the clock, keeping this testable), and buckets via
    /// `create_bucket`, whose duplicate-name error is caught per row and
    /// recorded in `skipped` instead of aborting the rest of the import.
    /// A bucket's linked account that matches nothing (not in this file,
    /// not already in the app) is also a skip, not an error — the bucket
    /// itself is still created, just unlinked.
    pub fn apply_setup_import(
        &self,
        data: &crate::setup_import::SetupImportResult,
        default_period: &str,
    ) -> rusqlite::Result<SetupImportOutcome> {
        let mut outcome = SetupImportOutcome::default();

        for row in &data.accounts {
            let account_type = AccountType::parse(&row.account_type)
                .expect("setup_import validated account_type against the known set");
            let id = self.get_or_create_account(&row.name, account_type)?;
            if let Some(balance) = row.starting_balance {
                self.set_account_starting_balance(id, balance)?;
            }
            if row.institution.is_some() || row.mask.is_some() {
                self.set_account_details(id, row.institution.as_deref(), row.mask.as_deref())?;
            }
            outcome.accounts_created += 1;
        }

        for row in &data.categories {
            self.create_category(&row.name)?;
            outcome.categories_created += 1;
        }

        for row in &data.budgets {
            let period = row.period.as_deref().unwrap_or(default_period);
            self.set_budget(&row.category, period, row.monthly_amount, &row.budget_group)?;
            self.create_category(&row.category)?;
            outcome.budgets_set += 1;
        }

        for row in &data.buckets {
            let account_id = match &row.linked_account_name {
                Some(name) => {
                    let found = self.conn.query_row(
                        "SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE",
                        params![name],
                        |r| r.get::<_, i64>(0),
                    );
                    match found {
                        Ok(id) => Some(id),
                        Err(rusqlite::Error::QueryReturnedNoRows) => {
                            outcome.skipped.push(format!(
                                "{}: linked account '{name}' not found — bucket created without a link",
                                row.name
                            ));
                            None
                        }
                        Err(e) => return Err(e),
                    }
                }
                None => None,
            };
            match self.create_bucket(&row.name, row.target_amount, row.target_date, account_id) {
                Ok(_) => outcome.buckets_created += 1,
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    outcome
                        .skipped
                        .push(format!("{}: a bucket with this name already exists", row.name));
                }
                Err(e) => return Err(e),
            }
        }

        Ok(outcome)
    }

    /// Rolls every account's balance forward into a fresh reset once per
    /// calendar month — the first time the app opens in a new month,
    /// whatever `current_balance` shows becomes that account's baseline
    /// for everything going forward, so a manually-tracked account (a
    /// loan, an investment, a house) never needs its balance retyped
    /// from scratch. Past "balance as of" lookups are unaffected: they
    /// use whichever reset (or the original `starting_balance`) applied
    /// back then, never today's — see `account_balance_as_of`. Safe to
    /// call on every launch: a period that already has a reset for an
    /// account is left alone (`UNIQUE(account_id, period)`).
    ///
    /// Applies uniformly to every account, not just manually-tracked
    /// ones — harmless for an actively-imported account too, since
    /// nothing is deleted. One accepted edge case: a transaction
    /// imported *later* with a date before the most recent reset won't
    /// affect *today's* balance, only past point-in-time lookups — a
    /// known limitation, same spirit as the top-merchants
    /// raw-description grouping documented elsewhere in this file.
    ///
    /// Returns `(account_id, account_name, new_balance)` for every
    /// account that got a *fresh* reset in this call, so the caller can
    /// show a one-time note — empty on every call after the first one
    /// this month.
    pub fn roll_forward_monthly_balances(&self, today: NaiveDate) -> rusqlite::Result<Vec<(i64, String, Decimal)>> {
        let period = format!("{:04}-{:02}", today.year(), today.month());

        let mut stmt = self.conn.prepare("SELECT id, name, starting_balance FROM accounts")?;
        let accounts: Vec<(i64, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut rolled = Vec::new();
        for (id, name, starting_balance_str) in accounts {
            let already_done: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM balance_resets WHERE account_id = ?1 AND period = ?2)",
                params![id, period],
                |row| row.get(0),
            )?;
            if already_done {
                continue;
            }

            let starting_balance = Decimal::from_str(&starting_balance_str)
                .expect("starting_balance stored by this crate must be valid");
            let balance = self.account_balance_as_of(id, starting_balance, today)?;

            self.conn.execute(
                "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)",
                params![id, period, today.to_string(), balance.to_string()],
            )?;
            rolled.push((id, name, balance));
        }
        Ok(rolled)
    }

    /// Sets (or corrects) an account's starting balance — a current cash
    /// balance for checking/savings, a credit limit for a credit account,
    /// or the amount currently owed for a loan. An unknown id is a
    /// harmless no-op, same convention as `set_category`.
    pub fn set_account_starting_balance(&self, id: i64, balance: Decimal) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET starting_balance = ?1 WHERE id = ?2",
            params![balance.to_string(), id],
        )?;
        Ok(())
    }

    /// Sets an account's institution name and masked account number — both
    /// purely cosmetic (e.g. "Chase" / "4821"), either can be `None`.
    pub fn set_account_details(&self, id: i64, institution: Option<&str>, mask: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET institution = ?1, mask = ?2 WHERE id = ?3",
            params![institution, mask, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) an account's annual interest rate —
    /// used only by `debt_payoff_projection`, meaningless for a non-debt
    /// account type but not restricted to one, same "don't over-validate"
    /// convention as the rest of this crate.
    pub fn set_account_interest_rate(&self, id: i64, rate: Option<Decimal>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET interest_rate = ?1 WHERE id = ?2",
            params![rate.map(|r| r.to_string()), id],
        )?;
        Ok(())
    }

    /// Opts a debt account in or out of `debt_payoff_projection` (see
    /// `StoredAccount::excluded_from_debt_payoff`) without deleting it.
    pub fn set_account_excluded_from_debt_payoff(&self, id: i64, excluded: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET excluded_from_debt_payoff = ?1 WHERE id = ?2",
            params![excluded, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member owns an account —
    /// purely an attribution label (see `FamilyMember`), doesn't affect any
    /// balance calculation. `save_transactions`/`apply_debt_payment` use
    /// this as the default a new transaction on this account inherits.
    pub fn set_account_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Corrects an account's type after the fact (created as the wrong
    /// kind by mistake). An unknown id is a harmless no-op, same
    /// convention as everything else here.
    pub fn update_account_type(&self, id: i64, account_type: AccountType) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET account_type = ?1 WHERE id = ?2",
            params![account_type.as_str(), id],
        )?;
        Ok(())
    }

    /// Deletes an account and every one of its transactions — an account
    /// can't be left behind with `transactions.account_id NOT NULL`
    /// pointing at nothing, so this cascades explicitly rather than
    /// erroring or orphaning rows (same reasoning as `delete_bucket`
    /// cascading its contributions). Each transaction goes through
    /// `delete_transaction` rather than a bare `DELETE`, so a debt-payment
    /// link row (and, if this account holds the *source* side of one, the
    /// paired transaction it generated on the debt account) is cleaned up
    /// too — otherwise it trips a foreign key constraint or lingers
    /// orphaned. Holdings and balance-reset snapshots for this account are
    /// swept the same way. A recurring item pointing here just loses the
    /// link (falls back to "no linked account") rather than being deleted
    /// itself, since it doesn't stop existing just because the account
    /// that used to pay it did. Returns how many transactions were
    /// removed, for the confirm dialog's copy. An unknown id is a
    /// harmless no-op.
    pub fn delete_account(&self, id: i64) -> rusqlite::Result<usize> {
        let mut stmt = self.conn.prepare("SELECT id FROM transactions WHERE account_id = ?1")?;
        let tx_ids: Vec<i64> = stmt
            .query_map(params![id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for tx_id in &tx_ids {
            self.delete_transaction(*tx_id)?;
        }

        self.conn
            .execute("UPDATE recurring SET account_id = NULL WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM holdings WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM balance_resets WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        Ok(tx_ids.len())
    }

    /// Creates a new family member — a household member other data
    /// (accounts, transactions, recurring items, buckets, assets) can be
    /// attributed to. Errors (a `UNIQUE` constraint violation) if a member
    /// with that name already exists, same "a duplicate name is a mistake
    /// to surface" convention as `create_bucket`.
    pub fn create_family_member(&self, name: &str) -> rusqlite::Result<i64> {
        self.conn
            .execute("INSERT INTO family_members (name) VALUES (?1)", params![name])?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every family member, alphabetical by name.
    pub fn list_family_members(&self) -> rusqlite::Result<Vec<FamilyMember>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM family_members ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(FamilyMember {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Renames a family member. An unknown id is a harmless no-op, same
    /// convention as `update_account_type` and friends.
    pub fn rename_family_member(&self, id: i64, new_name: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE family_members SET name = ?1 WHERE id = ?2", params![new_name, id])?;
        Ok(())
    }

    /// Removes a family member. A member is an attribution label, not a
    /// data container — unlike `delete_account`, this never touches the
    /// financial rows it was attached to, only clears the label on every
    /// table that can carry one, so nothing is left pointing at a
    /// now-deleted member. An unknown id is a harmless no-op.
    pub fn delete_family_member(&self, id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE transactions SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE recurring SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE buckets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE assets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM family_members WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Persists a learned rule (see `learner::learn_from_correction`) so it
    /// survives past this run. Upserts by pattern, same as `RuleSet::upsert`.
    pub fn upsert_rule(&self, pattern: &str, category: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO rules (pattern, category) VALUES (?1, ?2)
             ON CONFLICT(pattern) DO UPDATE SET category = excluded.category",
            params![pattern, category],
        )?;
        Ok(())
    }

    /// Every rule persisted so far, as a ready-to-use `RuleSet`. Empty on a
    /// fresh store — callers fall back to `RuleSet::seeded()` themselves.
    pub fn load_rules(&self) -> rusqlite::Result<RuleSet> {
        let mut stmt = self.conn.prepare("SELECT pattern, category FROM rules")?;
        let rows = stmt.query_map([], |row| {
            Ok(Rule::new(
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })?;

        let mut rules = Vec::new();
        for row in rows {
            rules.push(row?);
        }
        Ok(RuleSet::new(rules))
    }

    /// (description, category) for every transaction categorized by a rule
    /// or confirmed by the user — the training corpus for
    /// `Classifier::train`. Deliberately excludes the classifier's own past
    /// guesses: training the next classifier on an earlier unconfident
    /// guess would let it reinforce itself indefinitely across imports,
    /// since nothing distinguishes a self-generated guess from real ground
    /// truth once it's sitting in the table with a category.
    pub fn labeled_history(&self) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT description, category FROM transactions
             WHERE category IS NOT NULL AND category_source IN ('rule', 'user')",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Records a category for a transaction — either a rule/classifier guess
    /// or a user's manual correction. `confidence` should be `None` for
    /// anything but a classifier guess, since a rule match and a user
    /// correction are both deterministic rather than a probability.
    /// Correcting an id that doesn't exist is a harmless no-op rather than
    /// an error.
    pub fn set_category(
        &self,
        id: i64,
        category: &str,
        source: CategorySource,
        confidence: Option<f64>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE transactions SET category = ?1, category_source = ?2, confidence = ?3 WHERE id = ?4",
            params![category, source.as_str(), confidence, id],
        )?;
        // a brand-new category typed for one transaction must be immediately
        // selectable for every other one, not just the row it was first used on
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Registers a category so it's selectable even before any transaction
    /// or budget uses it. A name that already exists is a harmless no-op.
    pub fn create_category(&self, name: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        Ok(())
    }

    /// Every registered category, sorted — the standard suggestions plus
    /// anything created, budgeted, or assigned to a transaction, whether or
    /// not it's currently in use by anything.
    pub fn list_categories(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT name FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Renames every transaction and rule filed under `old` to `new`, and
    /// the category registry entry itself. If `new` already has
    /// transactions of its own, this is how a merge happens — same
    /// operation, no special-casing needed. Returns how many transaction
    /// rows were affected.
    ///
    /// Every budget line follows the rename too, month by month — but
    /// `budgets`' key is `(category, period)`, so if `new` already has
    /// its own line for a given month, `old`'s can't just overwrite it;
    /// the existing target's line wins for that month (same "the thing
    /// you're merging into wins" rule as everywhere else here) and
    /// `old`'s line is dropped instead of silently orphaned.
    pub fn rename_category(&self, old: &str, new: &str) -> rusqlite::Result<usize> {
        let affected = self.conn.execute(
            "UPDATE transactions SET category = ?1 WHERE category = ?2",
            params![new, old],
        )?;
        self.conn.execute(
            "UPDATE transaction_splits SET category = ?1 WHERE category = ?2",
            params![new, old],
        )?;
        self.conn.execute(
            "UPDATE rules SET category = ?1 WHERE category = ?2",
            params![new, old],
        )?;
        self.conn.execute(
            "UPDATE budgets SET category = ?1
             WHERE category = ?2 AND NOT EXISTS (
                 SELECT 1 FROM budgets b2 WHERE b2.category = ?1 AND b2.period = budgets.period
             )",
            params![new, old],
        )?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![old])?;
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![new])?;
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![old])?;
        Ok(affected)
    }

    /// Resets every transaction filed under `name` back to uncategorized,
    /// removes any rule or budget line that points at it, and removes it
    /// from the category registry — otherwise a leftover rule would
    /// silently recreate the "deleted" category on the next import, or it
    /// would still show up as a suggestion. Returns how many transactions
    /// were reset.
    pub fn delete_category(&self, name: &str) -> rusqlite::Result<usize> {
        let affected = self.conn.execute(
            "UPDATE transactions SET category = NULL, category_source = NULL, confidence = NULL WHERE category = ?1",
            params![name],
        )?;
        self.conn
            .execute("UPDATE transaction_splits SET category = NULL WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM rules WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![name])?;
        Ok(affected)
    }

    /// Whether each of `txns` already exists in this account (by
    /// fingerprint) — a pure read, no writes. `result[i]` corresponds to
    /// `txns[i]`. Callers use this to show the user what's about to be
    /// skipped and let them override it, rather than having dedup decided
    /// for them silently.
    pub fn check_duplicates(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<Vec<bool>> {
        let mut result = Vec::with_capacity(txns.len());
        for tx in txns {
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?1 AND fingerprint = ?2)",
                params![account_id, fingerprint(account_id, tx)],
                |row| row.get(0),
            )?;
            result.push(exists);
        }
        Ok(result)
    }

    /// Inserts every transaction given, unconditionally. Duplicate handling
    /// is entirely the caller's responsibility (see `check_duplicates`) —
    /// this used to skip anything matching an existing fingerprint, but
    /// that made it impossible to honor a user's explicit "keep it anyway"
    /// on a flagged duplicate.
    pub fn save_transactions(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<SaveReport> {
        for tx in txns {
            self.conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
                params![
                    account_id,
                    tx.date.to_string(),
                    tx.description,
                    tx.amount.to_string(),
                    tx.category,
                    fingerprint(account_id, tx),
                ],
            )?;
        }
        Ok(SaveReport { inserted: txns.len() })
    }

    pub fn all_transactions(&self) -> rusqlite::Result<Vec<StoredTransaction>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.date, t.description, t.amount, t.category, t.category_source,
                    t.confidence, t.account_id, a.name,
                    dp.debt_account_id, da.name, dp.amount,
                    (SELECT COUNT(*) FROM transaction_splits ts WHERE ts.transaction_id = t.id),
                    GROUP_CONCAT(tt.tag, char(31)),
                    t.member_id, fm.name
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN debt_payments dp ON dp.source_transaction_id = t.id
             LEFT JOIN accounts da ON da.id = dp.debt_account_id
             LEFT JOIN transaction_tags tt ON tt.transaction_id = t.id
             LEFT JOIN family_members fm ON fm.id = t.member_id
             GROUP BY t.id
             ORDER BY t.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<i64>>(14)?,
                row.get::<_, Option<String>>(15)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                date_str,
                description,
                amount_str,
                category,
                category_source,
                confidence,
                account_id,
                account_name,
                debt_account_id,
                debt_account_name,
                applied_amount_str,
                split_count,
                tags_str,
                member_id,
                member_name,
            ) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                .expect("date stored by this crate must be valid");
            let amount =
                Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let applied_to_debt = match (debt_account_id, debt_account_name, applied_amount_str) {
                (Some(debt_account_id), Some(debt_account_name), Some(applied_amount_str)) => {
                    Some(AppliedDebtPayment {
                        debt_account_id,
                        debt_account_name,
                        amount: Decimal::from_str(&applied_amount_str)
                            .expect("amount stored by this crate must be valid"),
                    })
                }
                _ => None,
            };
            let tags = tags_str
                .map(|s| s.split('\u{1f}').map(str::to_string).collect())
                .unwrap_or_default();
            result.push(StoredTransaction {
                id,
                transaction: Transaction {
                    date,
                    description,
                    amount,
                    category,
                },
                category_source: category_source.and_then(|s| CategorySource::parse(&s)),
                confidence,
                account_id,
                account_name,
                applied_to_debt,
                split_count,
                tags,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Corrects a transaction's amount after the fact (a wrong sign or a
    /// misread value shouldn't require re-importing the whole file). The
    /// fingerprint is recomputed so dedup keeps keying off the corrected
    /// value. An unknown id is a harmless no-op, matching `set_category`.
    pub fn update_transaction_amount(&self, id: i64, amount: Decimal) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, date, description FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        );
        let (account_id, date_str, description) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
            .expect("date stored by this crate must be valid");
        let fp = fingerprint(account_id, &Transaction { date, description, amount, category: None });

        self.conn.execute(
            "UPDATE transactions SET amount = ?1, fingerprint = ?2 WHERE id = ?3",
            params![amount.to_string(), fp, id],
        )?;
        Ok(())
    }

    /// Moves a transaction to a different account after the fact (it was
    /// imported into the wrong one). The fingerprint is recomputed since it
    /// includes `account_id`. An unknown id is a harmless no-op.
    pub fn update_transaction_account(&self, id: i64, account_id: i64) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT date, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        );
        let (date_str, description, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
            .expect("date stored by this crate must be valid");
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(account_id, &Transaction { date, description, amount, category: None });

        self.conn.execute(
            "UPDATE transactions SET account_id = ?1, fingerprint = ?2 WHERE id = ?3",
            params![account_id, fp, id],
        )?;
        Ok(())
    }

    /// Removes a transaction entirely. An unknown id is a harmless no-op —
    /// `DELETE` naturally affects zero rows rather than erroring.
    ///
    /// If `id` is the source side of an applied debt payment (see
    /// `apply_debt_payment`), the generated transaction it created on the
    /// debt account is removed too — otherwise it would silently linger,
    /// no longer backed by anything. If `id` is the *generated* side
    /// instead (deleted directly from the debt account's own ledger), the
    /// now-dangling link row is cleaned up the same way.
    pub fn delete_transaction(&self, id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        // The link row must go before either transaction row it points at
        // (it references both by id) — otherwise deleting the transaction
        // first trips the foreign key constraint.
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1 OR generated_transaction_id = ?1",
            params![id],
        )?;
        if let Some(generated_id) = generated_transaction_id {
            self.conn.execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![generated_id])?;
            self.conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![generated_id])?;
            self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![generated_id])?;
        }
        self.conn.execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Adds a tag to a transaction (a no-op if it's already there, since
    /// tags have no ordering or count that a duplicate would affect).
    pub fn add_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?1, ?2)",
            params![transaction_id, tag.trim()],
        )?;
        Ok(())
    }

    /// Removes a tag from a transaction. A no-op if it wasn't there.
    pub fn remove_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM transaction_tags WHERE transaction_id = ?1 AND tag = ?2",
            params![transaction_id, tag],
        )?;
        Ok(())
    }

    /// Every distinct tag in use across any transaction, alphabetically —
    /// powers autocomplete when adding a new tag; there's no separate
    /// master tag list to manage.
    pub fn list_all_tags(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT tag FROM transaction_tags ORDER BY tag COLLATE NOCASE")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Sets (or clears, with `None`) which family member a transaction is
    /// attributed to — overrides whatever it inherited from its account
    /// (see `save_transactions`). An unknown id is a harmless no-op.
    pub fn set_transaction_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE transactions SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// `set_transaction_member` applied to every id in `ids` — a plain loop,
    /// not a rule-learning bulk edit like `bulk_correct_category`, since
    /// member assignment has no analogous side effect to replay.
    pub fn bulk_set_transaction_member(&self, ids: &[i64], member_id: Option<i64>) -> rusqlite::Result<()> {
        for id in ids {
            self.set_transaction_member(*id, member_id)?;
        }
        Ok(())
    }

    /// Replaces every split line for `transaction_id` with `splits` (an
    /// empty slice clears them, un-splitting the transaction back to its
    /// own single category). No sum-matches-the-parent-amount validation
    /// here — the Ledger UI enforces that before it lets you save (a
    /// "remaining to allocate" total that must hit exactly $0.00), same
    /// trust-the-UI stance as every other setter in this crate that
    /// doesn't re-validate what the caller already checked.
    pub fn set_transaction_splits(
        &self,
        transaction_id: i64,
        splits: &[(String, Decimal, Option<String>)],
    ) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![transaction_id])?;
        for (category, amount, note) in splits {
            self.conn.execute(
                "INSERT INTO transaction_splits (transaction_id, category, amount, note) VALUES (?1, ?2, ?3, ?4)",
                params![transaction_id, category, amount.to_string(), note],
            )?;
        }
        Ok(())
    }

    /// A transaction's split lines, in the order they were saved. Empty
    /// for a transaction that's never been split.
    pub fn list_transaction_splits(&self, transaction_id: i64) -> rusqlite::Result<Vec<TransactionSplit>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, category, amount, note FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![transaction_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, category, amount_str, note) = row?;
            result.push(TransactionSplit {
                id,
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                note,
            });
        }
        Ok(result)
    }

    /// Applies part or all of `source_transaction_id`'s amount toward
    /// paying down `debt_account_id` (a loan or credit account), so the
    /// debt's tracked balance moves without the user retyping it. `amount`
    /// is independent of the source transaction's own amount — a mortgage
    /// payment bundles principal, interest and escrow, and only the
    /// principal portion should reduce what's owed, so the caller decides
    /// how much counts.
    ///
    /// Records a new transaction on the debt account itself, signed to
    /// match what a real imported payment would look like: negative for a
    /// loan (`current_balance` there *is* the amount owed), positive for
    /// credit (`current_balance` is *available* credit — a payment
    /// restores it). It copies the source transaction's own category and
    /// notes where it came from in its description. A cash-funded payment
    /// already reduces net worth by `amount` on the source side; this
    /// generated row increases it by the same amount on the debt side, so
    /// total net worth is correctly unaffected — only its composition
    /// shifts from cash to less debt.
    ///
    /// One source transaction can be applied to one debt account at a
    /// time (`UNIQUE(source_transaction_id)`) — call
    /// `unapply_debt_payment` first to change it.
    pub fn apply_debt_payment(
        &self,
        source_transaction_id: i64,
        debt_account_id: i64,
        amount: Decimal,
        date: NaiveDate,
    ) -> rusqlite::Result<()> {
        let (source_category, source_description): (Option<String>, String) = self.conn.query_row(
            "SELECT category, description FROM transactions WHERE id = ?1",
            params![source_transaction_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let account_type_str: String = self.conn.query_row(
            "SELECT account_type FROM accounts WHERE id = ?1",
            params![debt_account_id],
            |row| row.get(0),
        )?;
        let account_type = AccountType::parse(&account_type_str)
            .expect("account_type stored by this crate must be valid");
        let signed_amount = match account_type.group() {
            "loan" => -amount.abs(),
            _ => amount.abs(), // credit — paying it down increases available credit
        };

        let description = format!("Payment applied from: {source_description}");
        let generated = Transaction {
            date,
            description: description.clone(),
            amount: signed_amount,
            category: source_category,
        };
        self.conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
            params![
                debt_account_id,
                date.to_string(),
                description,
                signed_amount.to_string(),
                generated.category,
                fingerprint(debt_account_id, &generated),
            ],
        )?;
        let generated_transaction_id = self.conn.last_insert_rowid();

        self.conn.execute(
            "INSERT INTO debt_payments
                (source_transaction_id, debt_account_id, generated_transaction_id, amount, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source_transaction_id,
                debt_account_id,
                generated_transaction_id,
                amount.to_string(),
                date.to_string(),
            ],
        )?;
        Ok(())
    }

    /// Reverses `apply_debt_payment`: deletes the transaction it generated
    /// on the debt account and the link row. A no-op if
    /// `source_transaction_id` was never applied to anything.
    pub fn unapply_debt_payment(&self, source_transaction_id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
        )?;
        self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![generated_transaction_id])?;
        Ok(())
    }

    /// Creates a new savings bucket. Errors (a `UNIQUE` constraint
    /// violation) if a bucket with that name already exists — unlike an
    /// account, a duplicate bucket name is a mistake to surface, not a
    /// re-selection to shrug off.
    pub fn create_bucket(
        &self,
        name: &str,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO buckets (name, target_amount, target_date, account_id) VALUES (?1, ?2, ?3, ?4)",
            params![
                name,
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Updates a bucket's target amount, target date, and linked account
    /// (all optional/nullable — the linked account is purely informational,
    /// it doesn't feed into any balance calculation). An unknown id is a
    /// harmless no-op.
    pub fn update_bucket_details(
        &self,
        id: i64,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE buckets SET target_amount = ?1, target_date = ?2, account_id = ?3 WHERE id = ?4",
            params![
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
                id,
            ],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a bucket is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_bucket_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE buckets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Every bucket, each with its saved amount computed fresh from its
    /// contributions (0 for a bucket with none yet) rather than trusted
    /// from a stored running total. The sum is done in Rust with `Decimal`,
    /// not in SQL — summing money as floating point (SQLite has no decimal
    /// aggregate) would risk the exact rounding errors this app avoids
    /// everywhere else by keeping amounts as `Decimal` end to end.
    pub fn list_buckets(&self) -> rusqlite::Result<Vec<StoredBucket>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.id, b.name, b.target_amount, b.target_date, b.account_id, a.name,
                    GROUP_CONCAT(c.amount, '|'), b.member_id, fm.name
             FROM buckets b
             LEFT JOIN accounts a ON a.id = b.account_id
             LEFT JOIN bucket_contributions c ON c.bucket_id = b.id
             LEFT JOIN family_members fm ON fm.id = b.member_id
             GROUP BY b.id
             ORDER BY b.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, name, target_amount, target_date, account_id, account_name, contributions, member_id, member_name) = row?;
            let saved_amount = contributions
                .map(|joined| {
                    joined
                        .split('|')
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                })
                .unwrap_or(Decimal::ZERO);
            result.push(StoredBucket {
                id,
                name,
                target_amount: target_amount
                    .map(|a| Decimal::from_str(&a).expect("amount stored by this crate must be valid")),
                saved_amount,
                target_date: target_date.map(|d| {
                    NaiveDate::parse_from_str(&d, "%Y-%m-%d").expect("date stored by this crate must be valid")
                }),
                account_id,
                account_name,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Logs a contribution toward a bucket — a positive amount is a
    /// deposit, a negative amount is a withdrawal. Doesn't touch a stored
    /// total; `list_buckets` sums these fresh every time.
    pub fn add_bucket_contribution(
        &self,
        bucket_id: i64,
        date: NaiveDate,
        amount: Decimal,
        note: Option<&str>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?1, ?2, ?3, ?4)",
            params![bucket_id, date.to_string(), amount.to_string(), note],
        )?;
        Ok(())
    }

    /// Deletes a bucket and every contribution logged against it — done as
    /// an explicit statement rather than an `ON DELETE CASCADE`, since that
    /// requires `PRAGMA foreign_keys = ON` which this connection doesn't
    /// set (matching how `delete_category` explicitly removes matching
    /// rules rather than relying on a database-level cascade).
    pub fn delete_bucket(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM bucket_contributions WHERE bucket_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM buckets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Sets (or updates) one category's target budget amount and group
    /// for one specific calendar month (`period`, "YYYY-MM") — completely
    /// independent of every other month, on purpose: this never touches
    /// a different period's row, so adjusting August never moves
    /// July's or September's numbers.
    pub fn set_budget(
        &self,
        category: &str,
        period: &str,
        monthly_amount: Decimal,
        budget_group: &str,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(category, period) DO UPDATE SET monthly_amount = excluded.monthly_amount, budget_group = excluded.budget_group",
            params![category, period, monthly_amount.to_string(), budget_group],
        )?;
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Every budgeted category for `period` ("YYYY-MM"), its group, and
    /// its monthly target — fully independent of every other period.
    /// The first time a period that's never been touched is requested,
    /// it's materialized by copying the most recent *earlier* touched
    /// period: a one-time starting point (so a new month doesn't start
    /// blank), not an ongoing link — the copy becomes this period's own
    /// rows immediately, and editing it from here on never touches the
    /// period it was copied from. A period with nothing earlier to copy
    /// from (the very first budget ever set) simply starts empty.
    ///
    /// Whether a period has been "touched" is tracked in `budget_periods`
    /// rather than by checking `budgets` directly — deleting a period's
    /// last line must leave it genuinely empty, not indistinguishable
    /// from never having been visited (which would silently resurrect
    /// the deleted line from an earlier month on the next read). Note
    /// this "read" can write on a cache-miss — deliberate, since
    /// materializing real rows is what makes later edits to this period
    /// stay isolated from the one it came from.
    pub fn list_budgets(&self, period: &str) -> rusqlite::Result<Vec<BudgetLine>> {
        let already_touched: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM budget_periods WHERE period = ?1)",
            params![period],
            |row| row.get(0),
        )?;

        if !already_touched {
            let source_period: Option<String> = match self.conn.query_row(
                "SELECT period FROM budget_periods WHERE period < ?1 ORDER BY period DESC LIMIT 1",
                params![period],
                |row| row.get(0),
            ) {
                Ok(p) => Some(p),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };

            if let Some(source_period) = source_period {
                self.conn.execute(
                    "INSERT INTO budgets (category, period, monthly_amount, budget_group)
                     SELECT category, ?1, monthly_amount, budget_group FROM budgets WHERE period = ?2",
                    params![period, source_period],
                )?;
            }
            self.conn
                .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        }

        let mut stmt = self
            .conn
            .prepare("SELECT category, budget_group, monthly_amount FROM budgets WHERE period = ?1 ORDER BY category")?;
        let rows = stmt.query_map(params![period], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (category, budget_group, amount) = row?;
            result.push(BudgetLine {
                category,
                budget_group,
                monthly_amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
            });
        }
        Ok(result)
    }

    /// Removes one category's budget line for one specific month only —
    /// an unknown (category, period) pair is a harmless no-op, and every
    /// other month's line for that category is untouched.
    pub fn delete_budget(&self, category: &str, period: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM budgets WHERE category = ?1 AND period = ?2", params![category, period])?;
        Ok(())
    }

    /// All-time total across every bucket's contributions — summed in Rust
    /// with `Decimal`, same reasoning as `list_buckets`.
    pub fn total_saved(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT amount FROM bucket_contributions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(total)
    }

    /// All-time total of every transaction categorized "Income" — matches
    /// the convention `RuleSet::seeded` already uses (payroll, interest).
    pub fn income_total(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self
            .conn
            .prepare("SELECT amount FROM transactions WHERE category = 'Income'")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(total)
    }

    /// For every budgeted category *in this specific month* (see
    /// `list_budgets` — a month with no budget of its own materializes
    /// from the most recent earlier one), its target and how much was
    /// actually spent — `(category, budgeted, actual)`. `actual` is
    /// shown as a positive "spent" number (transactions are negative for
    /// money out), 0 for a budgeted category with no transactions yet in
    /// that month rather than being omitted.
    ///
    /// A split transaction (see `set_transaction_splits`) contributes
    /// through its split lines' own categories instead of its own —
    /// `id NOT IN (...)` excludes any transaction that's been split from
    /// also counting under its own (now superseded) category.
    pub fn monthly_budget_actuals(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetActual>> {
        let month_key = format!("{year:04}-{month:02}");
        let budgets = self.list_budgets(&month_key)?;

        let mut stmt = self.conn.prepare(
            "SELECT amount FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
             UNION ALL
             SELECT ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2",
        )?;
        let mut result = Vec::with_capacity(budgets.len());
        for line in budgets {
            let rows = stmt.query_map(params![line.category, month_key], |row| row.get::<_, String>(0))?;
            let mut spent = Decimal::ZERO;
            for row in rows {
                let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
                // Expense transactions are stored negative, so negating
                // reports a positive "amount spent" — but income
                // transactions are stored positive already and must not
                // be flipped, or a real deposit reads as negative "actual".
                if line.budget_group == "income" {
                    spent += amount;
                } else {
                    spent -= amount;
                }
            }
            result.push(BudgetActual {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: line.monthly_amount,
                actual: spent,
            });
        }
        Ok(result)
    }

    /// Every line item behind one category's `monthly_budget_actuals`
    /// entry for a month — clicking a category on the Budget page drills
    /// into this. Same split-aware shape as `monthly_budget_actuals`: a
    /// transaction that's been split contributes its split lines instead
    /// of itself, so the line items shown here sum to exactly the same
    /// "actual" the budget row displays. Sorted oldest first.
    pub fn transactions_for_category_in_month(
        &self,
        category: &str,
        year: i32,
        month: u32,
    ) -> rusqlite::Result<Vec<CategoryTransaction>> {
        let month_key = format!("{year:04}-{month:02}");
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.date, t.description, t.amount, a.name, 0, NULL
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
             UNION ALL
             SELECT t.id, t.date, t.description, ts.amount, a.name, 1, ts.note
             FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             JOIN accounts a ON a.id = t.account_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
             ORDER BY 2",
        )?;
        let rows = stmt.query_map(params![category, month_key], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (transaction_id, date, description, amount, account_name, is_split, split_note) = row?;
            result.push(CategoryTransaction {
                transaction_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                    .expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                account_name,
                is_split,
                split_note,
            });
        }
        Ok(result)
    }

    /// Which budgeted categories are at or near their monthly limit —
    /// built on top of `monthly_budget_actuals`, no separate query. A
    /// category shows up once it's spent 80% or more of its budget
    /// (`"warning"`) — landing exactly on 100% still counts as a warning,
    /// not "over"; only spending *past* the budget (`"over"`) does.
    /// Anything below 80%, any income line (exceeding an income budget is
    /// already a positive, never an alert), and any zero-budgeted line
    /// (nothing to alert
    /// against) are all left out entirely rather than included at 0%.
    pub fn budget_alerts_for_month(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetAlert>> {
        let hundred = Decimal::from(100);
        let mut result = Vec::new();
        for line in self.monthly_budget_actuals(year, month)? {
            if line.budget_group == "income" || line.budgeted <= Decimal::ZERO {
                continue;
            }
            let pct = (line.actual / line.budgeted) * hundred;
            // Landing exactly on budget (pct == 100) is not overspending —
            // only going past it is, so "over" needs to be strictly
            // greater than 100, not >=.
            let level = if pct > hundred {
                "over"
            } else if pct >= Decimal::from(80) {
                "warning"
            } else {
                continue;
            };
            result.push(BudgetAlert {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: line.budgeted,
                actual: line.actual,
                pct,
                level: level.to_string(),
            });
        }
        Ok(result)
    }

    /// Every transaction currently flagged as an anomaly — an unusually
    /// large charge for its category, or a likely duplicate of another
    /// transaction — computed fresh over the whole ledger (personal-scale
    /// data, same "don't over-engineer for scale" precedent as the
    /// per-account balance loop). One transaction can appear more than
    /// once (e.g. flagged as both a duplicate of two different other
    /// rows), each as its own entry.
    ///
    /// "Large": a category needs at least 3 other transactions in the
    /// trailing ~6 months (180 days) before `today` to have a baseline to
    /// compare against — too little history and nothing is flagged, since
    /// there's nothing meaningful to be "unusual" relative to. A
    /// transaction over 2.5x that baseline average, and over $50 (a floor
    /// so a tiny category's small absolute swings don't read as "unusual"
    /// just because they're a big multiple), is flagged.
    ///
    /// "Duplicate": any two transactions — regardless of account — with
    /// the exact same signed amount, dated within 3 days of each other,
    /// whose descriptions match once normalized (lowercased, whitespace
    /// collapsed, a trailing digit run like a store/reference number
    /// stripped). This is looking for genuinely separate charges that
    /// happen to look identical (e.g. a subscription billed twice), not
    /// the same import re-added — that's already prevented at import time
    /// by fingerprint-based dedup.
    pub fn anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        struct Row {
            id: i64,
            date: NaiveDate,
            description: String,
            amount: Decimal,
            category: Option<String>,
        }

        let mut stmt = self
            .conn
            .prepare("SELECT id, date, description, amount, category FROM transactions ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;

        let mut all = Vec::new();
        for row in rows {
            let (id, date_str, description, amount_str, category) = row?;
            all.push(Row {
                id,
                date: NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                    .expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                category,
            });
        }

        let mut result = Vec::new();

        for row in &all {
            let Some(category) = &row.category else { continue };
            let window_start = row.date - chrono::Duration::days(180);
            let history: Vec<&Row> = all
                .iter()
                .filter(|r| {
                    r.id != row.id
                        && r.category.as_deref() == Some(category.as_str())
                        && r.date >= window_start
                        && r.date < row.date
                })
                .collect();
            if history.len() < 3 {
                continue;
            }
            let baseline: Decimal =
                history.iter().map(|r| r.amount.abs()).sum::<Decimal>() / Decimal::from(history.len());
            let threshold = baseline * Decimal::new(25, 1); // 2.5x
            if row.amount.abs() > threshold && row.amount.abs() > Decimal::from(50) {
                result.push(AnomalyFlag {
                    transaction_id: row.id,
                    kind: "large".to_string(),
                    detail: format!(
                        "Unusually large for {category} — {} vs a recent average of {baseline:.2}",
                        row.amount.abs()
                    ),
                });
            }
        }

        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                let a = &all[i];
                let b = &all[j];
                if a.amount != b.amount {
                    continue;
                }
                if (a.date - b.date).num_days().abs() > 3 {
                    continue;
                }
                if normalize_description(&a.description) != normalize_description(&b.description) {
                    continue;
                }
                result.push(AnomalyFlag {
                    transaction_id: a.id,
                    kind: "duplicate".to_string(),
                    detail: format!("Possible duplicate of the {} transaction on {}", b.description, b.date),
                });
                result.push(AnomalyFlag {
                    transaction_id: b.id,
                    kind: "duplicate".to_string(),
                    detail: format!("Possible duplicate of the {} transaction on {}", a.description, a.date),
                });
            }
        }

        Ok(result)
    }

    /// The "large" anomalies (see `anomaly_flags`) dated within
    /// `[start_date, end_date]`, sorted by amount spent, biggest first —
    /// powers the cash-flow chart's per-month drill-down ("what drove this
    /// month's expenses"). Deliberately excludes "duplicate" flags: a
    /// repeated charge isn't a single large expense worth calling out here.
    pub fn large_expenses_in_range(
        &self,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> rusqlite::Result<Vec<LargeExpense>> {
        let flags = self.anomaly_flags()?;
        let all = self.all_transactions()?;
        let by_id: std::collections::HashMap<i64, &StoredTransaction> =
            all.iter().map(|t| (t.id, t)).collect();

        let mut result: Vec<LargeExpense> = flags
            .into_iter()
            .filter(|f| f.kind == "large")
            .filter_map(|f| {
                let stored = by_id.get(&f.transaction_id)?;
                let date = stored.transaction.date;
                if date < start_date || date > end_date {
                    return None;
                }
                Some(LargeExpense {
                    transaction_id: f.transaction_id,
                    date,
                    description: stored.transaction.description.clone(),
                    amount: stored.transaction.amount,
                    category: stored.transaction.category.clone(),
                    detail: f.detail,
                })
            })
            .collect();
        result.sort_by(|a, b| b.amount.abs().cmp(&a.amount.abs()));
        Ok(result)
    }

    /// Proactive notes for the Dashboard, combining three signals this
    /// crate already computes elsewhere rather than inventing new
    /// detection logic:
    ///
    /// 1. **Pace**: for each budgeted category (excluding income),
    ///    projects this month's spend forward (`actual *
    ///    days_in_month/days_elapsed`) and flags it if that projection
    ///    exceeds the budget by more than 10% — skipped entirely before
    ///    day 5 of the month, since too little of the month has happened
    ///    yet to project anything meaningful from.
    /// 2. **Category jump**: reuses `spending_by_category` to compare this
    ///    month-to-date against the *same number of days* at the start of
    ///    the previous month (not the previous month's full total — that
    ///    would make every early-month comparison look like a decrease),
    ///    flagging a rise of more than 30% and more than $50.
    /// 3. **Large expense**: reuses `large_expenses_in_range` (the same
    ///    detection already powering the Cash Flow drill-down) scoped to
    ///    the current month.
    ///
    /// Warnings sort before info, capped at 5 total so the Dashboard card
    /// never turns into another full list to scroll through.
    pub fn dashboard_insights(&self, today: NaiveDate) -> rusqlite::Result<Vec<Insight>> {
        let year = today.year();
        let month = today.month();
        let days_elapsed = today.day() as i64;
        let first_of_month = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");

        let mut insights = Vec::new();

        if days_elapsed >= 5 {
            let days_in_month = days_in_month(year, month);
            for actual in self.monthly_budget_actuals(year, month)? {
                if actual.budget_group == "income" || actual.budgeted <= Decimal::ZERO {
                    continue;
                }
                let projected = actual.actual * Decimal::from(days_in_month) / Decimal::from(days_elapsed);
                let threshold = actual.budgeted * Decimal::new(11, 1); // 1.1x
                if projected > threshold {
                    insights.push(Insight {
                        severity: "warning".to_string(),
                        kind: "pace".to_string(),
                        message: format!(
                            "You're on pace to exceed {} by ${:.2} this month (projected ${:.2} vs a ${:.2} budget).",
                            actual.category,
                            projected - actual.budgeted,
                            projected,
                            actual.budgeted
                        ),
                    });
                }
            }
        }

        let (prev_year, prev_month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
        let prev_first = NaiveDate::from_ymd_opt(prev_year, prev_month, 1).expect("valid first-of-previous-month");
        let comparable_days = days_elapsed.min(days_in_month(prev_year, prev_month));
        let current_window_end = first_of_month + chrono::Duration::days(comparable_days - 1);
        let prev_window_end = prev_first + chrono::Duration::days(comparable_days - 1);
        let current_spend = self.spending_by_category(first_of_month, current_window_end)?;
        let prev_spend: std::collections::HashMap<String, Decimal> =
            self.spending_by_category(prev_first, prev_window_end)?.into_iter().collect();
        for (category, current_amount) in current_spend {
            let Some(&previous_amount) = prev_spend.get(&category) else { continue };
            if previous_amount <= Decimal::ZERO {
                continue;
            }
            let delta = current_amount - previous_amount;
            let pct = delta / previous_amount * Decimal::from(100);
            if pct > Decimal::from(30) && delta > Decimal::from(50) {
                insights.push(Insight {
                    severity: "warning".to_string(),
                    kind: "category_jump".to_string(),
                    message: format!(
                        "{category} rose {pct:.0}% (${current_amount:.2} vs ${previous_amount:.2}) from last month."
                    ),
                });
            }
        }

        for expense in self.large_expenses_in_range(first_of_month, today)? {
            insights.push(Insight {
                severity: "info".to_string(),
                kind: "large_expense".to_string(),
                message: format!("Unusually large charge: {} — {}", expense.description, expense.detail),
            });
        }

        insights.sort_by_key(|i| if i.severity == "warning" { 0 } else { 1 });
        insights.truncate(5);
        Ok(insights)
    }

    /// Logs a recurring bill or income line. `account_id` is purely
    /// informational, same as a bucket's linked account.
    pub fn create_recurring(
        &self,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Replaces every field of an existing recurring item. An unknown id
    /// is a harmless no-op, same convention as everywhere else here.
    pub fn update_recurring(
        &self,
        id: i64,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE recurring SET merchant = ?1, category = ?2, amount = ?3, cadence = ?4, anchor_date = ?5, account_id = ?6
             WHERE id = ?7",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a recurring item is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_recurring_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE recurring SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Every recurring item, each with its next-due date computed fresh
    /// relative to `today` (see `next_occurrence`) rather than trusted
    /// from a stored value, sorted by that next-due date.
    pub fn list_recurring(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredRecurring>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.merchant, r.category, r.amount, r.cadence, r.anchor_date, r.account_id, a.name,
                    r.member_id, fm.name
             FROM recurring r
             LEFT JOIN accounts a ON a.id = r.account_id
             LEFT JOIN family_members fm ON fm.id = r.member_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, merchant, category, amount, cadence, anchor_date_str, account_id, account_name, member_id, member_name) = row?;
            let anchor_date = NaiveDate::parse_from_str(&anchor_date_str, "%Y-%m-%d")
                .expect("date stored by this crate must be valid");
            result.push(StoredRecurring {
                id,
                merchant,
                category,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                next_date: next_occurrence(anchor_date, &cadence, today),
                cadence,
                anchor_date,
                account_id,
                account_name,
                member_id,
                member_name,
            });
        }
        result.sort_by_key(|r| r.next_date);
        Ok(result)
    }

    /// Removes a recurring item. An unknown id is a harmless no-op.
    pub fn delete_recurring(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM recurring WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Scans the whole ledger for merchant+amount pairs that recur on a
    /// consistent weekly/biweekly/monthly/annual cadence (see
    /// `classify_cadence`) but aren't yet tracked in `recurring` and haven't
    /// been dismissed (see `dismiss_recurring_candidate`) — the offline
    /// equivalent of a "detected subscription" feed. A group needs at least
    /// 3 occurrences before it's considered: too little history to call
    /// anything a pattern otherwise. Sorted most-recent-occurrence first.
    pub fn detect_recurring_candidates(&self, today: NaiveDate) -> rusqlite::Result<Vec<RecurringCandidate>> {
        struct Row {
            date: NaiveDate,
            description: String,
            category: Option<String>,
        }

        let mut stmt = self
            .conn
            .prepare("SELECT date, description, amount, category FROM transactions ORDER BY date")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        // Grouped by (normalized description, amount-as-stored) — the same
        // normalization `anomaly_flags`'s duplicate detection already uses,
        // so a varying store-number suffix doesn't split one merchant into
        // several groups.
        let mut groups: std::collections::BTreeMap<(String, String), Vec<Row>> = std::collections::BTreeMap::new();
        for row in rows {
            let (date_str, description, amount_str, category) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let key = (normalize_description(&description), amount_str);
            groups.entry(key).or_default().push(Row { date, description, category });
        }

        let mut existing_recurring: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount FROM recurring")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (merchant, amount) = row?;
            existing_recurring.insert((normalize_description(&merchant), amount));
        }

        let mut dismissed: std::collections::HashSet<(String, String, String)> = std::collections::HashSet::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount, cadence FROM recurring_dismissals")?;
        for row in stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })? {
            dismissed.insert(row?);
        }

        let mut result = Vec::new();
        for ((norm_desc, amount_str), mut rows) in groups {
            if rows.len() < 3 {
                continue;
            }
            rows.sort_by_key(|r| r.date);
            let gaps: Vec<i64> = rows.windows(2).map(|w| (w[1].date - w[0].date).num_days()).collect();
            let Some(cadence) = classify_cadence(&gaps) else { continue };
            let last_date = rows.last().expect("checked len >= 3 above").date;
            // A pattern whose most recent occurrence is long overdue (more
            // than 2 cadence periods ago) has likely stopped — e.g. a
            // cancelled subscription — and shouldn't be suggested as if it
            // were still active.
            if (today - last_date).num_days() > cadence_days(cadence) * 2 {
                continue;
            }
            if existing_recurring.contains(&(norm_desc.clone(), amount_str.clone())) {
                continue;
            }
            if dismissed.contains(&(norm_desc, amount_str.clone(), cadence.to_string())) {
                continue;
            }

            let mut category_counts: std::collections::BTreeMap<Option<String>, usize> = std::collections::BTreeMap::new();
            for r in &rows {
                *category_counts.entry(r.category.clone()).or_insert(0) += 1;
            }
            let category = category_counts.into_iter().max_by_key(|(_, count)| *count).and_then(|(cat, _)| cat);

            let last = rows.last().expect("checked len >= 3 above");
            result.push(RecurringCandidate {
                merchant: last.description.clone(),
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                cadence: cadence.to_string(),
                anchor_date: last.date,
                occurrence_count: rows.len(),
            });
        }
        result.sort_by(|a, b| b.anchor_date.cmp(&a.anchor_date));
        Ok(result)
    }

    /// Marks a detected pattern as "not actually recurring" so it stops
    /// being suggested — keyed on the same normalized-merchant/amount/
    /// cadence triple `detect_recurring_candidates` groups by. Dismissing
    /// the same candidate twice is a harmless no-op (the underlying table's
    /// primary key already de-duplicates).
    pub fn dismiss_recurring_candidate(&self, merchant: &str, amount: Decimal, cadence: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO recurring_dismissals (merchant, amount, cadence) VALUES (?1, ?2, ?3)",
            params![normalize_description(merchant), amount.to_string(), cadence],
        )?;
        Ok(())
    }

    /// Adds an investment holding. `price` is whatever the caller passes in
    /// at creation time — manually typed, or auto-filled from a live quote
    /// when the optional Alpha Vantage integration is enabled (see
    /// `get_live_price_settings`). Either way it's just a starting value;
    /// `update_holding_price`/`update_holding_prices_for_symbol` are how it
    /// changes afterward.
    pub fn create_holding(
        &self,
        account_id: i64,
        symbol: &str,
        name: &str,
        shares: Decimal,
        price: Decimal,
        cost_basis: Decimal,
        asset_class: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                account_id,
                symbol,
                name,
                shares.to_string(),
                price.to_string(),
                cost_basis.to_string(),
                asset_class,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every holding, each with `value` (`shares * price`) and `gain_loss`
    /// (`value - cost_basis`) computed fresh — never stored, so an
    /// updated price is always immediately reflected in both.
    pub fn list_holdings(&self) -> rusqlite::Result<Vec<StoredHolding>> {
        let mut stmt = self.conn.prepare(
            "SELECT h.id, h.account_id, a.name, h.symbol, h.name, h.shares, h.price, h.cost_basis, h.asset_class
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id
             ORDER BY a.name, h.symbol",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, account_id, account_name, symbol, name, shares, price, cost_basis, asset_class) = row?;
            let shares = Decimal::from_str(&shares).expect("shares stored by this crate must be valid");
            let price = Decimal::from_str(&price).expect("price stored by this crate must be valid");
            let cost_basis = Decimal::from_str(&cost_basis).expect("cost_basis stored by this crate must be valid");
            let value = shares * price;
            result.push(StoredHolding {
                id,
                account_id,
                account_name,
                symbol,
                name,
                shares,
                price,
                cost_basis,
                asset_class,
                value,
                gain_loss: value - cost_basis,
            });
        }
        Ok(result)
    }

    /// Updates a holding's price (the only field expected to change often).
    /// An unknown id is a harmless no-op.
    pub fn update_holding_price(&self, id: i64, price: Decimal) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE holdings SET price = ?1 WHERE id = ?2", params![price.to_string(), id])?;
        Ok(())
    }

    /// Removes a holding. An unknown id is a harmless no-op.
    pub fn delete_holding(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM holdings WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Every distinct symbol currently held, across every account — the
    /// list a live-price refresh fetches one quote per, regardless of how
    /// many holdings (or accounts) share that symbol.
    pub fn list_distinct_holding_symbols(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT symbol FROM holdings ORDER BY symbol")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// Applies one fetched quote to every holding of that symbol at once
    /// (a symbol can appear in more than one account) — the counterpart to
    /// `update_holding_price`, which targets a single holding by id. Returns
    /// how many rows were touched; an unknown symbol is a harmless no-op.
    pub fn update_holding_prices_for_symbol(&self, symbol: &str, price: Decimal) -> rusqlite::Result<usize> {
        self.conn
            .execute("UPDATE holdings SET price = ?1 WHERE symbol = ?2", params![price.to_string(), symbol])
    }

    /// The opt-in live-price feature's current state. No row exists in
    /// `live_price_settings` until the user actually saves an API key —
    /// this returns the "off" state rather than synthesizing one, so a
    /// profile that never touches this feature has nothing written to its
    /// database for it (same lazy-write principle as the rest of this
    /// app's optional features).
    pub fn get_live_price_settings(&self) -> rusqlite::Result<StoredLivePriceSettings> {
        let row = match self.conn.query_row(
            "SELECT api_key, last_refreshed_at FROM live_price_settings WHERE id = 1",
            [],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let (api_key, last_refreshed_at) = row.unwrap_or((None, None));
        let last_refreshed_at = last_refreshed_at.map(|s| {
            NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S").expect("timestamp stored by this crate must be valid")
        });
        Ok(StoredLivePriceSettings { api_key, last_refreshed_at })
    }

    /// Sets (or, with `None`, clears/disables) the Alpha Vantage API key.
    /// Clearing it does not touch `last_refreshed_at` or any holding price
    /// already on record — it only stops future refreshes from happening.
    pub fn set_live_price_api_key(&self, api_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, api_key) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET api_key = ?1",
            params![api_key],
        )?;
        Ok(())
    }

    /// Records when a live-price refresh last ran (regardless of whether
    /// every symbol in it succeeded) — shown in Settings so the user can
    /// see the feature is actually working.
    pub fn set_live_prices_last_refreshed(&self, at: NaiveDateTime) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, last_refreshed_at) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET last_refreshed_at = ?1",
            params![at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(())
    }

    /// How many live-price requests have been sent today (`today`'s local
    /// calendar day). A pure read — rolls back over to 0 whenever the
    /// stored count is from an earlier day, but doesn't write anything;
    /// `record_live_price_request` is the only thing that actually persists
    /// the rollover. No row at all also just means 0, same as every other
    /// lazily-created live-price setting.
    pub fn live_price_requests_used_today(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let row = match self.conn.query_row(
            "SELECT requests_used_today, requests_count_date FROM live_price_settings WHERE id = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let Some((count, count_date)) = row else {
            return Ok(0);
        };
        let is_today = count_date.as_deref() == Some(today.format("%Y-%m-%d").to_string().as_str());
        Ok(if is_today { count } else { 0 })
    }

    /// Records one live-price request actually sent to Alpha Vantage today
    /// — rolling the counter over to 1 (not incrementing) if the stored
    /// count is from an earlier day — and returns the new total. Called
    /// once per request regardless of whether it succeeded, returned no
    /// data, or hit Alpha Vantage's own rate limit; it still spent one of
    /// today's free-tier requests either way.
    pub fn record_live_price_request(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let next = self.live_price_requests_used_today(today)? + 1;
        self.conn.execute(
            "INSERT INTO live_price_settings (id, requests_used_today, requests_count_date) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET requests_used_today = ?1, requests_count_date = ?2",
            params![next, today.format("%Y-%m-%d").to_string()],
        )?;
        Ok(next)
    }

    /// Adds a manually-tracked asset (see `StoredAsset`). `asset_type` is a
    /// free string, same convention as `budget_group` — the UI suggests
    /// "real_estate"/"vehicle"/"other" but nothing here enforces it.
    pub fn create_asset(
        &self,
        name: &str,
        asset_type: &str,
        value: Decimal,
        valued_on: NaiveDate,
        notes: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO assets (name, asset_type, value, valued_on, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, asset_type, value.to_string(), valued_on.to_string(), notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every manually-tracked asset, alphabetical by name.
    pub fn list_assets(&self) -> rusqlite::Result<Vec<StoredAsset>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.asset_type, a.value, a.valued_on, a.notes, a.member_id, fm.name
             FROM assets a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, name, asset_type, value, valued_on, notes, member_id, member_name) = row?;
            result.push(StoredAsset {
                id,
                name,
                asset_type,
                value: Decimal::from_str(&value).expect("value stored by this crate must be valid"),
                valued_on: NaiveDate::parse_from_str(&valued_on, "%Y-%m-%d")
                    .expect("date stored by this crate must be valid"),
                notes,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Updates an asset's value and the date it was valued as of — the
    /// only fields expected to change over time. An unknown id is a
    /// harmless no-op.
    pub fn update_asset_value(&self, id: i64, value: Decimal, valued_on: NaiveDate) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE assets SET value = ?1, valued_on = ?2 WHERE id = ?3",
            params![value.to_string(), valued_on.to_string(), id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member an asset is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_asset_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE assets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Removes an asset. An unknown id is a harmless no-op.
    pub fn delete_asset(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// The sum of every manually-tracked asset's current value.
    ///
    /// **Deliberately not part of `net_worth_as_of`/net worth history**: an
    /// asset here carries only a current value with no history, so
    /// retroactively applying today's value to every past point on the net
    /// worth trend chart would misrepresent history. Callers that want a
    /// "right now, including assets" figure (the Dashboard/Reports net
    /// worth headline) add this on top of the *current* `net_worth_as_of`
    /// result themselves, rather than this crate baking it into the
    /// historical series.
    pub fn total_assets_value(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT value FROM assets")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("value stored by this crate must be valid");
        }
        Ok(total)
    }

    /// Copies this database to `dest_path` using SQLite's own online
    /// backup API — safe to call against a live connection (unlike a raw
    /// `fs::copy`, which risks copying a half-written page or missing a
    /// `-wal`/`-shm` sidecar file if the database is in WAL mode). Used by
    /// both the "move my data file" flow and automatic local backups.
    pub fn backup_to(&self, dest_path: impl AsRef<Path>) -> rusqlite::Result<()> {
        let mut dest = Connection::open(dest_path)?;
        let backup = rusqlite::backup::Backup::new(&self.conn, &mut dest)?;
        backup.run_to_completion(5, std::time::Duration::from_millis(50), None)?;
        Ok(())
    }

    /// Simulates paying down every debt account (credit or loan, matching
    /// `AccountType::group`) month by month, applying `minimum_payments`
    /// (an account not present defaults to a $0 minimum) plus
    /// `extra_monthly_payment` to whichever debt `strategy` prioritizes —
    /// `"avalanche"` targets the highest `interest_rate` first (a missing
    /// rate counts as 0% for both accrual and ordering), anything else
    /// (including `"snowball"`) targets the smallest current balance
    /// first, same lenient fallback convention as `next_occurrence`'s
    /// cadence matching.
    ///
    /// Interest accrues monthly (`rate / 1200`, i.e. APR/12 as a
    /// fraction) before that month's payments are applied. Once a debt's
    /// minimum is no longer needed (it's paid off), that minimum rolls
    /// into the extra-payment pool for every subsequent month — the
    /// defining trait of a real snowball/avalanche plan, not just a set of
    /// independent payoff timers.
    ///
    /// Capped at 600 months (50 years): a debt that never clears within
    /// that (minimum too small to outpace interest) reports `payoff_date:
    /// None`, and the whole plan's `total_months` is `None` too.
    pub fn debt_payoff_projection(
        &self,
        strategy: &str,
        extra_monthly_payment: Decimal,
        minimum_payments: &[(i64, Decimal)],
        today: NaiveDate,
    ) -> rusqlite::Result<DebtPayoffPlan> {
        const CAP_MONTHS: u32 = 600;

        struct Debt {
            account_id: i64,
            name: String,
            starting_balance: Decimal,
            owed: Decimal,
            rate: Decimal,
            minimum: Decimal,
            interest_paid: Decimal,
            payoff_month: Option<u32>,
        }

        let minimums: std::collections::HashMap<i64, Decimal> = minimum_payments.iter().cloned().collect();

        let mut debts: Vec<Debt> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| matches!(a.account.account_type.group(), "credit" | "loan"))
            .filter(|a| !a.excluded_from_debt_payoff)
            .filter_map(|a| {
                let owed = match a.account.account_type.group() {
                    "credit" => a.starting_balance - a.current_balance,
                    _ => a.current_balance,
                };
                if owed <= Decimal::ZERO {
                    return None;
                }
                Some(Debt {
                    account_id: a.id,
                    name: a.account.name,
                    starting_balance: owed,
                    owed,
                    rate: a.interest_rate.unwrap_or(Decimal::ZERO),
                    minimum: minimums.get(&a.id).copied().unwrap_or(Decimal::ZERO),
                    interest_paid: Decimal::ZERO,
                    payoff_month: None,
                })
            })
            .collect();

        if debts.is_empty() {
            return Ok(DebtPayoffPlan {
                per_account: Vec::new(),
                total_months: Some(0),
                total_interest_paid: Decimal::ZERO,
            });
        }

        let mut freed_minimums = Decimal::ZERO;
        let mut month = 0u32;
        while debts.iter().any(|d| d.owed > Decimal::ZERO) && month < CAP_MONTHS {
            month += 1;

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let interest = d.owed * d.rate / Decimal::from(1200);
                d.owed += interest;
                d.interest_paid += interest;
            }

            match strategy {
                "avalanche" => debts.sort_by(|a, b| b.rate.cmp(&a.rate).then_with(|| a.owed.cmp(&b.owed))),
                _ => debts.sort_by(|a, b| a.owed.cmp(&b.owed)),
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = d.minimum.min(d.owed);
                d.owed -= pay;
            }

            let mut pool = extra_monthly_payment + freed_minimums;
            for d in debts.iter_mut() {
                if pool <= Decimal::ZERO {
                    break;
                }
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = pool.min(d.owed);
                d.owed -= pay;
                pool -= pay;
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO && d.payoff_month.is_none() {
                    d.payoff_month = Some(month);
                    freed_minimums += d.minimum;
                }
            }
        }

        let total_months = if debts.iter().all(|d| d.payoff_month.is_some()) {
            debts.iter().map(|d| d.payoff_month.unwrap()).max()
        } else {
            None
        };
        let total_interest_paid = debts.iter().map(|d| d.interest_paid).sum();

        let per_account = debts
            .into_iter()
            .map(|d| DebtPayoffLine {
                account_id: d.account_id,
                account_name: d.name,
                starting_balance: d.starting_balance,
                payoff_date: d.payoff_month.map(|m| add_months(today, m)),
                total_interest_paid: d.interest_paid,
            })
            .collect();

        Ok(DebtPayoffPlan {
            per_account,
            total_months,
            total_interest_paid,
        })
    }

    /// Projects total cash balance one point per day for `days` days
    /// forward from `today` as a smooth trend — starting balance is the
    /// sum of every "cash"-group account's current balance (checking/
    /// savings only; deliberately not investment/other/debt, since this
    /// answers "can I cover my bills," not total net worth), and the
    /// day-over-day *slope* is the trailing ~90-day observed daily net
    /// cash flow: `(balance today - balance at the start of the window) /
    /// days in that window`.
    ///
    /// Deliberately not based on `Recurring` items: most people don't
    /// bother entering their paycheck as a recurring item, only their
    /// bills, which made an earlier recurring-only version of this always
    /// trend straight down regardless of real income. A window built from
    /// actual transaction history has no such blind spot — real income
    /// already shows up in the observed balance change automatically. The
    /// trade-off is losing the specific-date "rent hits on the 15th" dip
    /// in favor of a smooth trend line.
    ///
    /// The window is capped at 90 days but shrinks to however much history
    /// actually exists (via the ledger's earliest transaction date) so a
    /// brand-new account with only two weeks of data isn't diluted by 76
    /// days of assumed inactivity. With no transactions at all, the slope
    /// is 0 (flat). `days = 0` returns just today's balance as a single
    /// point.
    pub fn cash_flow_forecast(&self, today: NaiveDate, days: i64) -> rusqlite::Result<Vec<ForecastPoint>> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let cash_accounts: Vec<StoredAccount> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| a.account.account_type.group() == "cash")
            .collect();
        let starting_balance: Decimal = cash_accounts.iter().map(|a| a.current_balance).sum();

        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions", [], |row| row.get::<_, Option<String>>(0))?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));

        let daily_net = match earliest_transaction_date {
            None => Decimal::ZERO,
            Some(earliest) => {
                let window_start = earliest.max(today - chrono::Duration::days(TRAILING_WINDOW_DAYS));
                let days_elapsed = (today - window_start).num_days().max(1);
                let mut balance_at_window_start = Decimal::ZERO;
                for a in &cash_accounts {
                    balance_at_window_start += self.account_balance_as_of(a.id, a.starting_balance, window_start)?;
                }
                (starting_balance - balance_at_window_start) / Decimal::from(days_elapsed)
            }
        };

        let mut points = Vec::with_capacity((days + 1).max(1) as usize);
        let mut balance = starting_balance;
        points.push(ForecastPoint { date: today, balance });
        let mut date = today;
        for _ in 0..days {
            date += chrono::Duration::days(1);
            balance += daily_net;
            points.push(ForecastPoint { date, balance });
        }
        Ok(points)
    }

    /// Total income (positive amounts) and total expense (as a positive
    /// "spent" number, from negative amounts) across *every* transaction
    /// in the given month — unlike `monthly_budget_actuals`, not scoped to
    /// budgeted categories, since a cash-flow chart cares about the whole
    /// picture.
    pub fn monthly_totals(&self, year: i32, month: u32) -> rusqlite::Result<(Decimal, Decimal)> {
        let month_key = format!("{year:04}-{month:02}");
        let mut stmt = self.conn.prepare("SELECT amount FROM transactions WHERE substr(date, 1, 7) = ?1")?;
        let rows = stmt.query_map(params![month_key], |row| row.get::<_, String>(0))?;

        let mut income = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        for row in rows {
            let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
            if amount > Decimal::ZERO {
                income += amount;
            } else if amount < Decimal::ZERO {
                expense -= amount;
            }
        }
        Ok((income, expense))
    }

    /// Total spend per category (as positive "spent" numbers) across every
    /// transaction dated within `[start_date, end_date]`, sorted highest
    /// spend first. Uncategorized transactions and income are excluded.
    pub fn spending_by_category(&self, start_date: NaiveDate, end_date: NaiveDate) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(
            "SELECT category, amount FROM transactions
             WHERE category IS NOT NULL AND date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
             UNION ALL
             SELECT ts.category, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category IS NOT NULL AND t.date >= ?1 AND t.date <= ?2",
        )?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (category, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(category).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        Ok(result)
    }

    /// The top `limit` merchants by total spend within
    /// `[start_date, end_date]` — "merchant" here is just the raw
    /// transaction description, since this app has no separate normalized
    /// merchant-name concept; a repeat merchant with varying suffixes
    /// (store numbers, etc.) lists as separate entries.
    pub fn top_merchants(
        &self,
        start_date: NaiveDate,
        end_date: NaiveDate,
        limit: usize,
    ) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT description, amount FROM transactions WHERE date >= ?1 AND date <= ?2")?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (description, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(description).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        result.truncate(limit);
        Ok(result)
    }

    /// Total net worth *as of* a given date — each account's balance
    /// computed by `account_balance_as_of` (so a monthly reset, if any,
    /// is honored exactly as it would be for "now"). Cash/investment/
    /// other accounts add their balance as-is; a credit account's
    /// `starting_balance` is a limit (owed starts at $0, so only the
    /// change since it — `balance - starting_balance` — counts); a
    /// loan's balance directly represents what's owed (so it's
    /// subtracted in full) — no snapshot storage beyond `balance_resets`
    /// needed, since this is fully computable from data already on hand
    /// for any date, past or present.
    pub fn net_worth_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT id, account_type, starting_balance FROM accounts")?;
        let accounts: Vec<(i64, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut net_worth = Decimal::ZERO;
        for (id, account_type, starting_balance_str) in accounts {
            let starting_balance = Decimal::from_str(&starting_balance_str)
                .expect("starting_balance stored by this crate must be valid");
            let balance = self.account_balance_as_of(id, starting_balance, as_of)?;
            let account_type =
                AccountType::parse(&account_type).expect("account_type stored by this crate must be valid");
            let contribution = match account_type.group() {
                "credit" => balance - starting_balance,
                "loan" => -balance,
                _ => balance,
            };
            net_worth += contribution;
        }
        Ok(net_worth)
    }
}

/// Same transaction imported twice into the same account (even from a
/// different file) should collapse to one row, so dedup is keyed on the
/// transaction's own content plus which account it's in — the same
/// content in a different account is a coincidence, not a duplicate.
fn fingerprint(account_id: i64, tx: &Transaction) -> String {
    format!(
        "{}|{}|{}|{}",
        account_id,
        tx.date,
        tx.description.trim().to_lowercase(),
        tx.amount
    )
}

/// Normalizes a description for duplicate-detection comparison (see
/// `Store::anomaly_flags`): lowercased, internal whitespace collapsed to
/// single spaces, and a trailing run of digits (a common store/reference
/// number suffix that varies between otherwise-identical charges)
/// stripped along with any space before it.
fn normalize_description(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    let collapsed = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_end_matches(|c: char| c.is_ascii_digit())
        .trim_end()
        .to_string()
}

/// The four cadences `detect_recurring_candidates` recognizes, as a
/// (name, typical days, tolerance in days) table shared by
/// `classify_cadence` and `cadence_days` — the buckets don't overlap
/// (5-9, 11-17, 25-35, 355-375), so a set of gaps matches at most one.
const CADENCE_BUCKETS: [(&str, i64, i64); 4] = [("weekly", 7, 2), ("biweekly", 14, 3), ("monthly", 30, 5), ("annual", 365, 10)];

/// Classifies a series of day-gaps between consecutive occurrences as one
/// of the four recognized cadences, requiring every gap to fall within
/// that cadence's tolerance of its typical length — an irregular series
/// (gaps that don't consistently cluster around any one target) matches
/// nothing, since it isn't actually a recurring pattern.
fn classify_cadence(gaps: &[i64]) -> Option<&'static str> {
    CADENCE_BUCKETS
        .iter()
        .find(|(_, target, tolerance)| gaps.iter().all(|g| (g - target).abs() <= *tolerance))
        .map(|(name, _, _)| *name)
}

/// The typical day-length of a cadence name, for the "has this pattern
/// gone stale" check in `detect_recurring_candidates`. Panics on an
/// unrecognized name — every caller gets `cadence` from `classify_cadence`,
/// so this should never see anything else.
fn cadence_days(cadence: &str) -> i64 {
    CADENCE_BUCKETS
        .iter()
        .find(|(name, _, _)| *name == cadence)
        .map(|(_, days, _)| *days)
        .expect("cadence must be one produced by classify_cadence")
}

/// The next date on/after `today` that a recurring item lands on, given
/// its anchor date and cadence — computed fresh every call rather than
/// stored, so it never goes stale once an occurrence passes. An anchor
/// still in the future is itself the next occurrence.
fn next_occurrence(anchor: NaiveDate, cadence: &str, today: NaiveDate) -> NaiveDate {
    if anchor >= today {
        return anchor;
    }
    let mut next = anchor;
    match cadence {
        "weekly" => {
            while next < today {
                next += chrono::Duration::days(7);
            }
        }
        "biweekly" => {
            while next < today {
                next += chrono::Duration::days(14);
            }
        }
        "annual" => {
            while next < today {
                next = add_one_year(next);
            }
        }
        _ => {
            // "monthly", and the fallback for anything unrecognized
            while next < today {
                next = add_one_month(next);
            }
        }
    }
    next
}


/// The number of days in a given calendar month — computed as the gap
/// between its first day and the next month's first day, rather than a
/// hand-maintained 30/31/28 table, so leap Februaries fall out for free.
fn days_in_month(year: i32, month: u32) -> i64 {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");
    let next_first = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid first-of-next-month");
    (next_first - first).num_days()
}

/// Adds one calendar month, clamping the day into the target month if it
/// doesn't have that many days (e.g. Jan 31 + 1 month -> Feb 28/29).
fn add_one_month(d: NaiveDate) -> NaiveDate {
    let (mut y, mut m) = (d.year(), d.month());
    m += 1;
    if m > 12 {
        m = 1;
        y += 1;
    }
    let day = d.day();
    (0u32..4)
        .find_map(|back| NaiveDate::from_ymd_opt(y, m, day - back))
        .expect("some valid day exists within 4 days of any day-of-month")
}

/// Adds `n` calendar months by repeated `add_one_month` — `n` is always
/// small in practice (`debt_payoff_projection` caps its simulation at 600
/// months), so the repeated-addition cost is negligible next to the
/// clarity of reusing the same day-clamping logic as everywhere else.
fn add_months(d: NaiveDate, n: u32) -> NaiveDate {
    let mut result = d;
    for _ in 0..n {
        result = add_one_month(result);
    }
    result
}

/// Adds one year, clamping Feb 29 -> Feb 28 in a non-leap target year.
fn add_one_year(d: NaiveDate) -> NaiveDate {
    let y = d.year() + 1;
    NaiveDate::from_ymd_opt(y, d.month(), d.day())
        .or_else(|| NaiveDate::from_ymd_opt(y, d.month(), d.day() - 1))
        .expect("Feb 29 -> Feb 28 fallback must exist")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Transaction;
    use chrono::NaiveDate;

    fn tx(date: &str, description: &str, amount: &str) -> Transaction {
        Transaction {
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            description: description.to_string(),
            amount: amount.parse().unwrap(),
            category: None,
        }
    }

    /// Most tests don't care about accounts — just need *an* account id to
    /// save into.
    fn test_account(store: &Store) -> i64 {
        store
            .get_or_create_account("Test Checking", AccountType::Checking)
            .unwrap()
    }

    /// `list_accounts` now takes a `today` for reset-awareness; tests that
    /// don't care about monthly resets just need *a* date safely after
    /// every transaction date used anywhere in this file.
    fn far_future() -> NaiveDate {
        "2099-12-31".parse().unwrap()
    }

    #[test]
    fn saves_and_reads_back_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![
            tx("2026-08-20", "Union Realty", "-1850.00"),
            tx("2026-08-26", "Payroll Deposit", "3120.00"),
        ];

        let report = store.save_transactions(account, &txns).unwrap();
        assert_eq!(report.inserted, 2);

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].transaction.description, "Union Realty");
        assert_eq!(stored[1].transaction.amount, "3120.00".parse().unwrap());
    }

    #[test]
    fn check_duplicates_flags_a_transaction_already_saved_in_this_account() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];
        store.save_transactions(account, &txns).unwrap();

        let flags = store.check_duplicates(account, &txns).unwrap();

        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn check_duplicates_distinguishes_new_from_already_seen_in_an_overlapping_batch() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")])
            .unwrap();

        let second_batch = vec![
            tx("2026-08-20", "Union Realty", "-1850.00"),   // already saved
            tx("2026-08-21", "Green Leaf Grocers", "-86.42"), // new
        ];
        let flags = store.check_duplicates(account, &second_batch).unwrap();

        assert_eq!(flags, vec![true, false]);
    }

    #[test]
    fn save_transactions_inserts_a_flagged_duplicate_when_asked() {
        // Proves the safety valve genuinely works: the caller can choose to
        // keep a row `check_duplicates` flagged, rather than dedup being
        // silently enforced regardless of what the user wants.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];

        store.save_transactions(account, &txns).unwrap();
        let second = store.save_transactions(account, &txns).unwrap();

        assert_eq!(second.inserted, 1);
        assert_eq!(store.all_transactions().unwrap().len(), 2);
    }

    #[test]
    fn persists_to_disk_across_reopen() {
        let dir = std::env::temp_dir().join(format!("meadow-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let store = Store::open(&db_path).unwrap();
            let account = test_account(&store);
            store
                .save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")])
                .unwrap();
        } // store (and its connection) dropped here

        let reopened = Store::open(&db_path).unwrap();
        assert_eq!(reopened.all_transactions().unwrap().len(), 1);
        drop(reopened); // release the file handle before cleanup — Windows can't delete an open file

        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn backup_to_copies_every_row_to_a_new_file() {
        let dir = std::env::temp_dir().join(format!("pennyworth-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.db");
        let dest_path = dir.join("dest.db");
        for p in [&source_path, &dest_path] {
            if p.exists() {
                std::fs::remove_file(p).unwrap();
            }
        }

        {
            let store = Store::open(&source_path).unwrap();
            let account = test_account(&store);
            store
                .save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")])
                .unwrap();
            store.backup_to(&dest_path).unwrap();
        } // source store dropped here

        let restored = Store::open(&dest_path).unwrap();
        let stored = restored.all_transactions().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].transaction.description, "Union Realty");
        drop(restored);

        std::fs::remove_file(&source_path).unwrap();
        std::fs::remove_file(&dest_path).unwrap();
    }

    #[test]
    fn opening_a_pre_accounts_database_migrates_it_without_losing_data() {
        // Simulates a real database created before Step 11 added accounts:
        // a `transactions` table with no `account_id` column at all.
        let dir = std::env::temp_dir().join(format!("meadow-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_accounts.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    fingerprint TEXT NOT NULL UNIQUE
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO transactions (date, description, amount, fingerprint)
                 VALUES ('2026-08-20', 'Union Realty', '-1850.00', 'old-fingerprint')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let stored = store.all_transactions().unwrap();

        assert_eq!(stored.len(), 1, "the pre-existing transaction must survive the migration");
        assert_eq!(stored[0].transaction.description, "Union Realty");
        assert!(!stored[0].account_name.is_empty(), "it should land in some fallback account, not be orphaned");

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn user_can_correct_a_transactions_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store
            .set_category(id, "Dining Out", CategorySource::User, None)
            .unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
        assert_eq!(stored[0].category_source, Some(CategorySource::User));
    }

    #[test]
    fn correcting_again_overwrites_the_previous_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Groceries", CategorySource::Rule, None).unwrap();
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
        assert_eq!(stored[0].category_source, Some(CategorySource::User));
    }

    #[test]
    fn correcting_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        // no transactions saved at all — id 999 doesn't exist
        store.set_category(999, "Dining Out", CategorySource::User, None).unwrap();
    }

    #[test]
    fn a_classifiers_confidence_is_persisted_and_read_back() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Mystery Merchant", "-10.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store
            .set_category(id, "Groceries", CategorySource::Classifier, Some(0.73))
            .unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].confidence, Some(0.73));
    }

    #[test]
    fn a_rule_or_user_categorization_has_no_confidence() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Dining Out", CategorySource::Rule, None).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].confidence, None);
    }

    #[test]
    fn upserted_rules_persist_and_load_back() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let rules = store.load_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(
            rules.categorize("Local Coffee Shop"),
            Some("Dining Out".to_string())
        );
    }

    #[test]
    fn upserting_the_same_pattern_again_updates_rather_than_duplicates() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();
        store.upsert_rule("Ferrywood Coffee", "Business Expense").unwrap();

        let rules = store.load_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(
            rules.categorize("Ferrywood Coffee"),
            Some("Business Expense".to_string())
        );
    }

    #[test]
    fn a_fresh_store_has_no_persisted_rules() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.load_rules().unwrap().len(), 0);
    }

    #[test]
    fn labeled_history_includes_only_categorized_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Mystery Merchant", "-10.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
        // ids[1] ("Mystery Merchant") is deliberately left uncategorized

        let history = store.labeled_history().unwrap();
        assert_eq!(
            history,
            vec![("Ferrywood Coffee".to_string(), "Dining Out".to_string())]
        );
    }

    #[test]
    fn labeled_history_excludes_the_classifiers_own_guesses() {
        // A classifier guess is not ground truth — training the *next*
        // classifier on it would let one early wrong guess reinforce
        // itself indefinitely, since every later import's training corpus
        // would include it as if a human had confirmed it.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Mystery Merchant", "-10.00"),
                    tx("2026-08-22", "Another Merchant", "-5.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::Rule, None).unwrap();
        store
            .set_category(ids[2], "Entertainment", CategorySource::Classifier, Some(0.5))
            .unwrap();

        let history = store.labeled_history().unwrap();
        assert_eq!(history.len(), 2, "the classifier's own guess must not become training data");
        assert!(history.contains(&("Ferrywood Coffee".to_string(), "Dining Out".to_string())));
        assert!(history.contains(&("Mystery Merchant".to_string(), "Groceries".to_string())));
    }

    // Category management.

    #[test]
    fn a_fresh_store_already_offers_the_default_category_suggestions() {
        let store = Store::open_in_memory().unwrap();

        let categories = store.list_categories().unwrap();

        assert!(categories.contains(&"Business Expense".to_string()));
        assert!(categories.contains(&"Rent".to_string()));
        assert_eq!(categories.len(), DEFAULT_CATEGORIES.len(), "no transactions yet, so only the defaults");
    }

    #[test]
    fn create_category_makes_a_new_category_selectable_before_anything_uses_it() {
        let store = Store::open_in_memory().unwrap();

        store.create_category("Pet Care").unwrap();

        assert!(store.list_categories().unwrap().contains(&"Pet Care".to_string()));
    }

    #[test]
    fn creating_the_same_category_twice_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Pet Care").unwrap();

        store.create_category("Pet Care").unwrap();

        let matches = store.list_categories().unwrap().iter().filter(|c| *c == "Pet Care").count();
        assert_eq!(matches, 1);
    }

    #[test]
    fn assigning_a_brand_new_category_to_a_transaction_registers_it_for_every_other_row() {
        // The original bug this guards against: typing a new category for
        // one transaction didn't make it selectable for any other one.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Health", CategorySource::User, None).unwrap();

        assert!(store.list_categories().unwrap().contains(&"Health".to_string()));
    }

    #[test]
    fn rename_category_updates_matching_transactions_and_rules() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let affected = store.rename_category("Dining Out", "Food & Drink").unwrap();

        assert_eq!(affected, 1);
        assert_eq!(
            store.all_transactions().unwrap()[0].transaction.category,
            Some("Food & Drink".to_string())
        );
        assert_eq!(
            store.load_rules().unwrap().categorize("Local Coffee Shop"),
            Some("Food & Drink".to_string())
        );
    }

    #[test]
    fn rename_category_carries_its_budget_line_forward() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        store.rename_category("Dining Out", "Food & Drink").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].category, "Food & Drink");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
    }

    #[test]
    fn renaming_into_a_category_that_already_has_a_budget_keeps_the_targets_budget() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Coffee", "0000-01", "40.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(
            budgets.len(),
            1,
            "the existing target's budget should win, not be overwritten or duplicated"
        );
        assert_eq!(budgets[0].category, "Dining Out");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
    }

    #[test]
    fn renaming_into_an_existing_category_merges_them() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Downtown Cafe", "-12.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Coffee", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Dining Out", CategorySource::User, None).unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let categories = store.list_categories().unwrap();
        assert!(!categories.contains(&"Coffee".to_string()), "the merged-away name must be gone");
        assert_eq!(
            categories.iter().filter(|c| *c == "Dining Out").count(),
            1,
            "merging must leave exactly one entry for the target category, not a duplicate"
        );
    }

    #[test]
    fn delete_category_resets_its_transactions_to_uncategorized_and_removes_its_rules() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_category(id, "Dining Out", CategorySource::Classifier, Some(0.9))
            .unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let affected = store.delete_category("Dining Out").unwrap();

        assert_eq!(affected, 1);
        let stored = &store.all_transactions().unwrap()[0];
        assert_eq!(stored.transaction.category, None);
        assert_eq!(stored.category_source, None);
        assert_eq!(stored.confidence, None);
        assert_eq!(
            store.load_rules().unwrap().categorize("Local Coffee Shop"),
            None,
            "a rule that only pointed at the deleted category must not silently recreate it"
        );
        assert!(
            !store.list_categories().unwrap().contains(&"Dining Out".to_string()),
            "a deleted category must not still show up as a suggestion"
        );
    }

    #[test]
    fn delete_category_also_removes_its_budget_line() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

        store.delete_category("Pet Care").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
    }

    // Accounts.

    #[test]
    fn get_or_create_account_creates_then_reuses_by_name() {
        let store = Store::open_in_memory().unwrap();
        let first = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let second = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        assert_eq!(first, second, "re-using an existing account name should return the same id");

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].account.name, "Everyday Checking");
        assert_eq!(accounts[0].account.account_type, AccountType::Checking);
    }

    #[test]
    fn different_account_names_get_different_ids() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

        assert_ne!(checking, credit);
        assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
    }

    #[test]
    fn a_new_accounts_starting_balance_defaults_to_zero() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].starting_balance, Decimal::ZERO);
        assert_eq!(accounts[0].current_balance, Decimal::ZERO);
    }

    #[test]
    fn current_balance_reflects_starting_balance_plus_its_own_transactions() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "5000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3120.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-86.42"),
                ],
            )
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].starting_balance, "5000.00".parse().unwrap());
        assert_eq!(accounts[0].current_balance, "8033.58".parse().unwrap());
    }

    #[test]
    fn a_credit_accounts_available_credit_moves_with_charges_and_payments() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                card,
                &[
                    tx("2026-08-01", "Grocery Store", "-300.00"), // a charge reduces available credit
                    tx("2026-08-15", "Card Payment", "100.00"),   // a payment restores it
                ],
            )
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(
            accounts[0].current_balance,
            "1800.00".parse().unwrap(),
            "2000 limit - 300 charge + 100 payment = 1800 available"
        );
    }

    #[test]
    fn each_accounts_balance_is_independent() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-01", "Payroll Deposit", "200.00")])
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let checking_balance = accounts.iter().find(|a| a.id == checking).unwrap().current_balance;
        let card_balance = accounts.iter().find(|a| a.id == card).unwrap().current_balance;

        assert_eq!(checking_balance, "1200.00".parse().unwrap());
        assert_eq!(card_balance, "500.00".parse().unwrap(), "untouched by checking's transaction");
    }

    #[test]
    fn set_account_starting_balance_updates_it_and_recomputes_current_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store.set_account_starting_balance(checking, "1500.00".parse().unwrap()).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].starting_balance, "1500.00".parse().unwrap());
        assert_eq!(accounts[0].current_balance, "1500.00".parse().unwrap());
    }

    #[test]
    fn set_account_starting_balance_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_account_starting_balance(999, "100.00".parse().unwrap()).unwrap();
    }

    #[test]
    fn update_account_type_corrects_a_mistakenly_created_account() {
        let store = Store::open_in_memory().unwrap();
        let id = store.get_or_create_account("Sapphire Rewards", AccountType::Savings).unwrap();

        store.update_account_type(id, AccountType::Credit).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].account.account_type, AccountType::Credit);
    }

    #[test]
    fn update_account_type_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_account_type(999, AccountType::Credit).unwrap();
    }

    #[test]
    fn delete_account_removes_it_and_its_transactions() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                ],
            )
            .unwrap();
        store
            .save_transactions(savings, &[tx("2026-08-01", "Transfer In", "500.00")])
            .unwrap();

        let affected = store.delete_account(checking).unwrap();

        assert_eq!(affected, 2, "both of checking's transactions were removed");
        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, savings);
        let remaining = store.all_transactions().unwrap();
        assert_eq!(remaining.len(), 1, "savings' own transaction must be untouched");
        assert_eq!(remaining[0].account_id, savings);
    }

    #[test]
    fn delete_account_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_account(999).unwrap();
    }

    #[test]
    fn delete_account_removes_a_balance_reset_snapshot_taken_against_it() {
        // Regression test: `roll_forward_monthly_balances` leaves a
        // `balance_resets` row (`account_id NOT NULL REFERENCES
        // accounts(id)`) behind for every account it touches. Deleting an
        // account that has one used to trip a foreign key constraint
        // instead of succeeding.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Test", AccountType::Checking).unwrap();
        store.roll_forward_monthly_balances("2026-08-01".parse().unwrap()).unwrap();

        store.delete_account(checking).unwrap();

        assert!(store.list_accounts(far_future()).unwrap().is_empty());
    }

    #[test]
    fn delete_account_removes_its_investment_holdings() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "VTI",
                "Vanguard Total Stock Market",
                "10".parse().unwrap(),
                "100.00".parse().unwrap(),
                "900.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.delete_account(brokerage).unwrap();

        assert!(store.list_holdings().unwrap().is_empty());
    }

    #[test]
    fn delete_account_unlinks_rather_than_deletes_a_recurring_item_pointing_to_it() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), Some(checking))
            .unwrap();

        store.delete_account(checking).unwrap();

        let recurring = store.list_recurring(far_future()).unwrap();
        assert_eq!(recurring.len(), 1, "the recurring item itself survives");
        assert_eq!(recurring[0].account_id, None);
    }

    #[test]
    fn delete_account_holding_the_source_of_a_debt_payment_also_removes_the_generated_transaction() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();
        assert_eq!(store.all_transactions().unwrap().len(), 2);

        store.delete_account(checking).unwrap();

        assert!(store.all_transactions().unwrap().is_empty(), "the generated debt-account transaction must go too");
    }

    #[test]
    fn create_family_member_then_list_family_members_returns_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_family_member("Alex").unwrap();

        let members = store.list_family_members().unwrap();

        assert_eq!(members, vec![FamilyMember { id, name: "Alex".to_string() }]);
    }

    #[test]
    fn create_family_member_rejects_a_duplicate_name_case_insensitively() {
        let store = Store::open_in_memory().unwrap();
        store.create_family_member("Alex").unwrap();

        let result = store.create_family_member("ALEX");

        assert!(result.is_err());
    }

    #[test]
    fn rename_family_member_updates_its_name() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_family_member("Alex").unwrap();

        store.rename_family_member(id, "Alexandra").unwrap();

        let members = store.list_family_members().unwrap();
        assert_eq!(members[0].name, "Alexandra");
    }

    #[test]
    fn rename_family_member_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.rename_family_member(999, "Nobody").unwrap();
    }

    #[test]
    fn delete_family_member_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_family_member(999).unwrap();
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_accounts_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_transactions_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;
        store.set_transaction_member(transaction_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_recurring_items_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_recurring_member(recurring_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_buckets_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None).unwrap();
        store.set_bucket_member(bucket_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_assets_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_asset_member(asset_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_assets().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_leaves_a_different_members_rows_untouched() {
        let store = Store::open_in_memory().unwrap();
        let alex = store.create_family_member("Alex").unwrap();
        let sam = store.create_family_member("Sam").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(sam)).unwrap();

        store.delete_family_member(alex).unwrap();

        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(sam));
    }

    #[test]
    fn save_transactions_gives_a_new_transaction_its_accounts_member_by_default() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));
    }

    #[test]
    fn save_transactions_leaves_member_null_when_the_account_has_none() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);

        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn apply_debt_payment_gives_the_generated_transaction_the_debt_accounts_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_member(loan, Some(member)).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let generated = store.all_transactions().unwrap().into_iter().find(|t| t.account_id == loan).unwrap();
        assert_eq!(generated.member_id, Some(member));
    }

    #[test]
    fn set_account_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);

        store.set_account_member(checking, Some(member)).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

        store.set_account_member(checking, None).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn set_bucket_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None).unwrap();

        store.set_bucket_member(bucket_id, Some(member)).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

        store.set_bucket_member(bucket_id, None).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
    }

    #[test]
    fn set_recurring_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();

        store.set_recurring_member(recurring_id, Some(member)).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

        store.set_recurring_member(recurring_id, None).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn set_asset_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        store.set_asset_member(asset_id, Some(member)).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

        store.set_asset_member(asset_id, None).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, None);
    }

    #[test]
    fn set_transaction_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;

        store.set_transaction_member(transaction_id, Some(member)).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

        store.set_transaction_member(transaction_id, None).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn bulk_set_transaction_member_applies_to_every_id_given() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store
            .save_transactions(
                checking,
                &[tx("2026-08-01", "Groceries", "-50.00"), tx("2026-08-02", "Gas", "-40.00")],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        store.bulk_set_transaction_member(&ids, Some(member)).unwrap();

        let all = store.all_transactions().unwrap();
        assert!(all.iter().all(|t| t.member_id == Some(member)));
    }

    #[test]
    fn list_accounts_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_buckets_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None).unwrap();
        store.set_bucket_member(bucket_id, Some(member)).unwrap();

        let buckets = store.list_buckets().unwrap();

        assert_eq!(buckets[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_recurring_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_recurring_member(recurring_id, Some(member)).unwrap();

        let recurring = store.list_recurring(far_future()).unwrap();

        assert_eq!(recurring[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_assets_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_asset_member(asset_id, Some(member)).unwrap();

        let assets = store.list_assets().unwrap();

        assert_eq!(assets[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn all_transactions_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;
        store.set_transaction_member(transaction_id, Some(member)).unwrap();

        let transactions = store.all_transactions().unwrap();

        assert_eq!(transactions[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn opening_a_pre_member_id_database_migrates_every_table_without_losing_data() {
        // Simulates a database from before family member attribution
        // existed: accounts/transactions/recurring/buckets/assets with no
        // `member_id` column on any of them.
        let dir = std::env::temp_dir().join(format!("meadow-member-id-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_member_id.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL,
                    starting_balance TEXT NOT NULL DEFAULT '0',
                    institution TEXT,
                    mask TEXT,
                    interest_rate TEXT,
                    excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT NOT NULL
                );
                CREATE TABLE recurring (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant TEXT NOT NULL,
                    category TEXT,
                    amount TEXT NOT NULL,
                    cadence TEXT NOT NULL,
                    anchor_date TEXT NOT NULL,
                    account_id INTEGER
                );
                CREATE TABLE buckets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    target_amount TEXT,
                    target_date TEXT,
                    account_id INTEGER
                );
                CREATE TABLE assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    asset_type TEXT NOT NULL,
                    value TEXT NOT NULL,
                    valued_on TEXT NOT NULL,
                    notes TEXT
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO accounts (id, name, account_type, starting_balance) VALUES (1, 'Everyday Checking', 'checking', '0')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (1, '2026-08-01', 'Groceries', '-50.00', 'fp1')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES ('Netflix', '-15.00', 'monthly', '2026-08-01', 1)",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO buckets (name, account_id) VALUES ('Emergency Fund', 1)", [])
                .unwrap();
            conn.execute(
                "INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('House', 'Real Estate', '300000.00', '2026-08-01')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let member = store.create_family_member("Alex").unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].member_id, None);
        store.set_account_member(accounts[0].id, Some(member)).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

        let transactions = store.all_transactions().unwrap();
        assert_eq!(transactions.len(), 1, "the pre-existing transaction must survive the migration");
        store.set_transaction_member(transactions[0].id, Some(member)).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

        let recurring = store.list_recurring(far_future()).unwrap();
        assert_eq!(recurring.len(), 1, "the pre-existing recurring item must survive the migration");
        store.set_recurring_member(recurring[0].id, Some(member)).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1, "the pre-existing bucket must survive the migration");
        store.set_bucket_member(buckets[0].id, Some(member)).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

        let assets = store.list_assets().unwrap();
        assert_eq!(assets.len(), 1, "the pre-existing asset must survive the migration");
        store.set_asset_member(assets[0].id, Some(member)).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn a_new_accounts_institution_and_mask_default_to_none() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].institution, None);
        assert_eq!(accounts[0].mask, None);
    }

    #[test]
    fn set_account_details_persists_institution_and_mask() {
        let store = Store::open_in_memory().unwrap();
        let id = store.get_or_create_account("Sapphire Preferred", AccountType::Credit).unwrap();

        store.set_account_details(id, Some("Chase"), Some("4821")).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].institution, Some("Chase".to_string()));
        assert_eq!(accounts[0].mask, Some("4821".to_string()));
    }

    #[test]
    fn set_account_details_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_account_details(999, Some("Chase"), Some("4821")).unwrap();
    }

    #[test]
    fn opening_a_pre_institution_database_migrates_it_without_losing_data() {
        // Simulates a database from before institution/mask existed: an
        // `accounts` table without those two columns.
        let dir = std::env::temp_dir().join(format!("meadow-institution-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_institution.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL,
                    starting_balance TEXT NOT NULL DEFAULT '0'
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '0')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].institution, None);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_pre_balance_database_migrates_it_without_losing_data() {
        // Simulates a real database created before account balances
        // existed: an `accounts` table with no `starting_balance` column.
        let dir = std::env::temp_dir().join(format!("meadow-balance-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_balance.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].account.name, "Everyday Checking");
        assert_eq!(accounts[0].starting_balance, Decimal::ZERO);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn check_duplicates_does_not_flag_the_same_content_in_a_different_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

        let same_content = vec![tx("2026-08-20", "Transfer", "-100.00")];
        store.save_transactions(checking, &same_content).unwrap();

        let flags = store.check_duplicates(credit, &same_content).unwrap();

        assert_eq!(flags, vec![false], "same content in a different account is not a duplicate");
    }

    #[test]
    fn check_duplicates_applies_within_the_same_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let same_content = vec![tx("2026-08-20", "Transfer", "-100.00")];
        store.save_transactions(checking, &same_content).unwrap();

        let flags = store.check_duplicates(checking, &same_content).unwrap();

        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn all_transactions_reports_which_account_each_row_belongs_to() {
        let store = Store::open_in_memory().unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store
            .save_transactions(credit, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].account_id, credit);
        assert_eq!(stored[0].account_name, "Sapphire Rewards");
    }

    // Transaction editing.

    #[test]
    fn update_transaction_amount_persists_the_new_amount() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

        assert_eq!(
            store.all_transactions().unwrap()[0].transaction.amount,
            "-7.25".parse().unwrap()
        );
    }

    #[test]
    fn update_transaction_amount_keeps_dedup_working_against_the_corrected_value() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

        // re-importing the same file (still says -6.75) should look new now,
        // since the stored row's fingerprint moved with the corrected amount
        let flags = store
            .check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        assert_eq!(flags, vec![false]);

        let flags = store
            .check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-7.25")])
            .unwrap();
        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn update_transaction_amount_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_transaction_amount(999, "1.00".parse().unwrap()).unwrap();
    }

    #[test]
    fn update_transaction_account_moves_it_to_the_new_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_account(id, savings).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].account_id, savings);
        assert_eq!(stored[0].account_name, "Nest Egg");
    }

    #[test]
    fn update_transaction_account_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.update_transaction_account(999, account).unwrap();
    }

    #[test]
    fn delete_transaction_removes_only_that_row() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Green Leaf Grocers", "-40.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        store.delete_transaction(ids[0]).unwrap();

        let remaining = store.all_transactions().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, ids[1]);
    }

    #[test]
    fn delete_transaction_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_transaction(999).unwrap();
    }

    // Applying a payment to a debt.

    #[test]
    fn applying_a_payment_reduces_a_loans_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
        assert_eq!(loan_account.current_balance, "9500.00".parse().unwrap());
    }

    #[test]
    fn applying_a_payment_increases_a_credit_cards_available_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        store.set_account_starting_balance(credit_card, "2000.00".parse().unwrap()).unwrap(); // credit limit
        store
            .save_transactions(credit_card, &[tx("2026-08-15", "Groceries", "-300.00")])
            .unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Credit Card Payment", "-200.00")])
            .unwrap();
        let source_id = store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description == "Credit Card Payment")
            .unwrap()
            .id;

        store
            .apply_debt_payment(source_id, credit_card, "200.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let card = accounts.iter().find(|a| a.id == credit_card).unwrap();
        // 2000 limit - 300 charge + 200 payment = 1900 available.
        assert_eq!(card.current_balance, "1900.00".parse().unwrap());
    }

    #[test]
    fn applying_a_payment_with_a_different_amount_than_the_source_transaction_uses_the_given_amount() {
        // A mortgage payment bundles principal + interest + escrow — only
        // the principal portion should reduce what's tracked as owed.
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let mortgage = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(mortgage, "300000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-01", "Mortgage Payment", "-1500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, mortgage, "900.00".parse().unwrap(), "2026-08-01".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let mortgage_account = accounts.iter().find(|a| a.id == mortgage).unwrap();
        assert_eq!(mortgage_account.current_balance, "299100.00".parse().unwrap());
    }

    #[test]
    fn unapplying_a_payment_removes_the_generated_transaction_and_restores_the_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        store.unapply_debt_payment(source_id).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
        assert_eq!(loan_account.current_balance, "10000.00".parse().unwrap());
        assert_eq!(store.all_transactions().unwrap().len(), 1);
    }

    #[test]
    fn unapplying_a_payment_that_was_never_applied_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.unapply_debt_payment(999).unwrap();
    }

    #[test]
    fn deleting_the_source_transaction_also_removes_its_generated_debt_payment() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();
        assert_eq!(store.all_transactions().unwrap().len(), 2);

        store.delete_transaction(source_id).unwrap();

        assert_eq!(store.all_transactions().unwrap().len(), 0);
    }

    #[test]
    fn all_transactions_reports_which_transactions_are_applied_to_a_debt() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        let before = store.all_transactions().unwrap();
        assert!(before.iter().find(|t| t.id == source_id).unwrap().applied_to_debt.is_none());

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let after = store.all_transactions().unwrap();
        let applied = after
            .iter()
            .find(|t| t.id == source_id)
            .unwrap()
            .applied_to_debt
            .as_ref()
            .unwrap();
        assert_eq!(applied.debt_account_id, loan);
        assert_eq!(applied.debt_account_name, "Car Loan");
        assert_eq!(applied.amount, "500.00".parse().unwrap());
    }

    // Split transactions.

    #[test]
    fn setting_splits_replaces_any_previous_set() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();
        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 2);

        // Replacing with a different set, including clearing entirely.
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();
        let splits = store.list_transaction_splits(id).unwrap();
        assert_eq!(splits.len(), 1);
        assert_eq!(splits[0].category, Some("Groceries".to_string()));

        store.set_transaction_splits(id, &[]).unwrap();
        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 0);
    }

    #[test]
    fn all_transactions_reports_split_count() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        assert_eq!(store.all_transactions().unwrap()[0].split_count, 0);

        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].split_count, 2);
    }

    #[test]
    fn deleting_a_transaction_deletes_its_splits() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.delete_transaction(id).unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 0);
    }

    #[test]
    fn monthly_budget_actuals_counts_split_lines_toward_their_own_categories_instead_of_the_parents() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Household", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
        let groceries = actuals.iter().find(|a| a.category == "Groceries").unwrap();
        let household = actuals.iter().find(|a| a.category == "Household").unwrap();

        // Split lines count toward their own categories (60 + 40); the
        // parent transaction's own "Groceries" category must not also
        // contribute its full $100, or Groceries would double-count.
        assert_eq!(groceries.actual, "60.00".parse().unwrap());
        assert_eq!(household.actual, "40.00".parse().unwrap());
    }

    #[test]
    fn renaming_a_category_updates_it_within_transaction_splits_too() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.rename_category("Groceries", "Food").unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, Some("Food".to_string()));
    }

    #[test]
    fn deleting_a_category_nulls_it_out_within_transaction_splits_too() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.delete_category("Groceries").unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, None);
    }

    // Tags.

    #[test]
    fn adding_and_removing_tags_on_a_transaction() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.add_tag(id, "reimbursable").unwrap();
        store.add_tag(id, "vacation").unwrap();
        let tags = store.all_transactions().unwrap()[0].tags.clone();
        assert_eq!(tags.len(), 2);
        assert!(tags.contains(&"reimbursable".to_string()));
        assert!(tags.contains(&"vacation".to_string()));

        store.remove_tag(id, "vacation").unwrap();
        let tags = store.all_transactions().unwrap()[0].tags.clone();
        assert_eq!(tags, vec!["reimbursable".to_string()]);
    }

    #[test]
    fn adding_the_same_tag_twice_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.add_tag(id, "reimbursable").unwrap();
        store.add_tag(id, "reimbursable").unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].tags, vec!["reimbursable".to_string()]);
    }

    #[test]
    fn list_all_tags_returns_distinct_tags_across_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-05", "Target", "-100.00"), tx("2026-08-06", "Costco", "-200.00")],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.add_tag(ids[0], "reimbursable").unwrap();
        store.add_tag(ids[1], "reimbursable").unwrap();
        store.add_tag(ids[1], "vacation").unwrap();

        let all_tags = store.list_all_tags().unwrap();

        assert_eq!(all_tags, vec!["reimbursable".to_string(), "vacation".to_string()]);
    }

    #[test]
    fn deleting_a_transaction_removes_its_tags() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.add_tag(id, "reimbursable").unwrap();

        store.delete_transaction(id).unwrap();

        assert_eq!(store.list_all_tags().unwrap(), Vec::<String>::new());
    }

    // Setup-data import (see setup_import.rs for the parser's own tests).

    fn setup_data(text: &str) -> crate::setup_import::SetupImportResult {
        // The parser is private-by-file; round-tripping through a temp file
        // exercises the same public load_setup_csv path the app uses. Tests
        // run in parallel within this one process, so the file path must be
        // unique per *call*, not just per process — an earlier version
        // derived it from the text's length plus byte sum, which gave two
        // calls passing the identical `FULL_TEMPLATE` (used by more than
        // one test below) the exact same path. That let their
        // write/read/delete sequences race: one test's `setup_data` could
        // observe another's in-flight write or have its file deleted out
        // from under it, intermittently reading back the wrong (or
        // momentarily missing) content — observed in practice as
        // `apply_setup_import_creates_every_section_through_the_normal_paths`
        // occasionally seeing zero accounts instead of two. A monotonic
        // counter guarantees every call gets its own file regardless of
        // content.
        static CALL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = CALL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("pennyworth-setup-import-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("template-{n:x}.csv"));
        std::fs::write(&path, text).unwrap();
        let result = crate::setup_import::load_setup_csv(&path).unwrap();
        std::fs::remove_file(&path).ok();
        result
    }

    const FULL_TEMPLATE: &str = "Accounts\n\
        Name,Type,Starting Balance,Institution,Mask\n\
        Everyday Checking,checking,1000.00,Ally,1234\n\
        Car Loan,loan,10000.00,,\n\
        \n\
        Categories\n\
        Name\n\
        Coffee Shops\n\
        \n\
        Budgets\n\
        Category,Group,Monthly Amount,Period\n\
        Coffee Shops,flexible,50.00,2026-08\n\
        \n\
        Buckets\n\
        Name,Target Amount,Target Date,Linked Account\n\
        Emergency Fund,5000.00,,Everyday Checking\n";

    #[test]
    fn apply_setup_import_creates_every_section_through_the_normal_paths() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(FULL_TEMPLATE);
        assert!(data.errors.is_empty(), "template must parse cleanly: {:?}", data.errors);

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.accounts_created, 2);
        assert_eq!(outcome.categories_created, 1);
        assert_eq!(outcome.budgets_set, 1);
        assert_eq!(outcome.buckets_created, 1);
        assert!(outcome.skipped.is_empty(), "nothing should be skipped: {:?}", outcome.skipped);

        let accounts = store.list_accounts(far_future()).unwrap();
        let checking = accounts.iter().find(|a| a.account.name == "Everyday Checking").unwrap();
        assert_eq!(checking.account.account_type, AccountType::Checking);
        assert_eq!(checking.starting_balance, "1000.00".parse().unwrap());
        assert_eq!(checking.institution, Some("Ally".to_string()));
        assert_eq!(checking.mask, Some("1234".to_string()));
        assert!(accounts.iter().any(|a| a.account.name == "Car Loan"));

        assert!(store.list_categories().unwrap().contains(&"Coffee Shops".to_string()));

        let budgets = store.list_budgets("2026-08").unwrap();
        let coffee = budgets.iter().find(|b| b.category == "Coffee Shops").unwrap();
        assert_eq!(coffee.monthly_amount, "50.00".parse().unwrap());
        assert_eq!(coffee.budget_group, "flexible");

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].name, "Emergency Fund");
        assert_eq!(buckets[0].target_amount, Some("5000.00".parse().unwrap()));
        // linked by name to the account this same import created
        assert_eq!(buckets[0].account_id, Some(checking.id));
    }

    #[test]
    fn applying_the_same_template_twice_does_not_error_or_duplicate() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(FULL_TEMPLATE);

        store.apply_setup_import(&data, "2026-08").unwrap();
        let second = store.apply_setup_import(&data, "2026-08").unwrap();

        // accounts/categories/budgets settle into the same state...
        assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
        assert_eq!(store.list_buckets().unwrap().len(), 1);
        let budgets = store.list_budgets("2026-08").unwrap();
        assert_eq!(budgets.iter().filter(|b| b.category == "Coffee Shops").count(), 1);
        // ...and the second run's bucket lands in skipped, not a hard error
        assert_eq!(second.buckets_created, 0);
        assert_eq!(second.skipped.len(), 1);
        assert!(second.skipped[0].contains("Emergency Fund"));
    }

    #[test]
    fn a_blank_budget_period_lands_in_the_default_period() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Budgets\nCategory,Group,Monthly Amount,Period\nGroceries,flexible,400.00,\n",
        );

        store.apply_setup_import(&data, "2026-09").unwrap();

        let budgets = store.list_budgets("2026-09").unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].category, "Groceries");
    }

    #[test]
    fn a_buckets_unknown_linked_account_is_skipped_but_the_bucket_is_still_created() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Buckets\nName,Target Amount,Target Date,Linked Account\nVacation,1000.00,,No Such Account\n",
        );

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.buckets_created, 1);
        assert_eq!(outcome.skipped.len(), 1);
        assert!(outcome.skipped[0].contains("No Such Account"));
        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets[0].name, "Vacation");
        assert_eq!(buckets[0].account_id, None);
    }

    #[test]
    fn importing_a_budget_registers_its_category_too() {
        // A budget row for a category the user never separately listed in
        // the Categories section must still leave that category selectable
        // everywhere, same as creating a budget line through the UI does.
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Budgets\nCategory,Group,Monthly Amount,Period\nBrand New Category,fixed,100.00,2026-08\n",
        );

        store.apply_setup_import(&data, "2026-08").unwrap();

        assert!(store.list_categories().unwrap().contains(&"Brand New Category".to_string()));
    }

    // Savings buckets.

    #[test]
    fn a_fresh_bucket_has_zero_saved_and_the_target_it_was_given() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_bucket("Emergency Fund", Some("1000.00".parse().unwrap()), None, None)
            .unwrap();

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].id, id);
        assert_eq!(buckets[0].name, "Emergency Fund");
        assert_eq!(buckets[0].target_amount, Some("1000.00".parse().unwrap()));
        assert_eq!(buckets[0].saved_amount, "0".parse().unwrap());
        assert_eq!(buckets[0].target_date, None);
        assert_eq!(buckets[0].account_id, None);
    }

    #[test]
    fn a_bucket_with_no_target_has_none() {
        let store = Store::open_in_memory().unwrap();
        store.create_bucket("Rainy Day", None, None, None).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].target_amount, None);
    }

    #[test]
    fn a_bucket_can_have_a_target_date_and_a_linked_account() {
        let store = Store::open_in_memory().unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        let target_date: NaiveDate = "2027-04-15".parse().unwrap();

        store
            .create_bucket("Japan Trip", Some("6000.00".parse().unwrap()), Some(target_date), Some(savings))
            .unwrap();

        let bucket = &store.list_buckets().unwrap()[0];
        assert_eq!(bucket.target_date, Some(target_date));
        assert_eq!(bucket.account_id, Some(savings));
        assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
    }

    #[test]
    fn update_bucket_details_changes_target_and_linked_account() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Japan Trip", None, None, None).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        let target_date: NaiveDate = "2027-04-15".parse().unwrap();

        store
            .update_bucket_details(id, Some("6000.00".parse().unwrap()), Some(target_date), Some(savings))
            .unwrap();

        let bucket = &store.list_buckets().unwrap()[0];
        assert_eq!(bucket.target_amount, Some("6000.00".parse().unwrap()));
        assert_eq!(bucket.target_date, Some(target_date));
        assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
    }

    #[test]
    fn update_bucket_details_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_bucket_details(999, Some("100.00".parse().unwrap()), None, None).unwrap();
    }

    #[test]
    fn contributions_accumulate_into_the_saved_amount_withdrawals_included() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Vacation", None, None, None).unwrap();

        store
            .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(
                id,
                "2026-08-15".parse().unwrap(),
                "150.00".parse().unwrap(),
                Some("bonus"),
            )
            .unwrap();
        store
            .add_bucket_contribution(id, "2026-08-20".parse().unwrap(), "-50.00".parse().unwrap(), None)
            .unwrap();

        assert_eq!(
            store.list_buckets().unwrap()[0].saved_amount,
            "300.00".parse().unwrap()
        );
    }

    #[test]
    fn each_buckets_saved_amount_is_independent() {
        let store = Store::open_in_memory().unwrap();
        let vacation = store.create_bucket("Vacation", None, None, None).unwrap();
        let emergency = store.create_bucket("Emergency Fund", None, None, None).unwrap();

        store
            .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
            .unwrap();

        let buckets = store.list_buckets().unwrap();
        let vacation_saved = buckets.iter().find(|b| b.id == vacation).unwrap().saved_amount;
        let emergency_saved = buckets.iter().find(|b| b.id == emergency).unwrap().saved_amount;
        assert_eq!(vacation_saved, "200.00".parse().unwrap());
        assert_eq!(emergency_saved, "500.00".parse().unwrap());
    }

    #[test]
    fn deleting_a_bucket_removes_its_contributions_too() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Vacation", None, None, None).unwrap();
        store
            .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();

        store.delete_bucket(id).unwrap();

        assert_eq!(store.list_buckets().unwrap().len(), 0);
        // re-creating a bucket of the same name must not resurrect the old contributions
        let new_id = store.create_bucket("Vacation", None, None, None).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "0".parse().unwrap());
        assert_ne!(id, new_id);
    }

    // Budgets.

    #[test]
    fn set_budget_creates_then_list_budgets_returns_it_sorted() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 2);
        assert_eq!(budgets[0].category, "Dining Out");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
        assert_eq!(budgets[1].category, "Groceries");
        assert_eq!(budgets[1].monthly_amount, "400.00".parse().unwrap());
    }

    #[test]
    fn set_budget_persists_the_group() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Paycheck", "0000-01", "6000.00".parse().unwrap(), "income").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap()[0].budget_group, "income");
    }

    #[test]
    fn setting_the_same_category_again_updates_rather_than_duplicates() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Groceries", "0000-01", "450.00".parse().unwrap(), "flexible").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].monthly_amount, "450.00".parse().unwrap());
    }

    #[test]
    fn setting_the_same_category_again_updates_the_group_too() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "nonmonthly").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap()[0].budget_group, "nonmonthly");
    }

    #[test]
    fn delete_budget_removes_it() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();

        store.delete_budget("Groceries", "0000-01").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
    }

    #[test]
    fn delete_budget_on_an_unknown_category_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_budget("Nonexistent", "0000-01").unwrap();
    }

    #[test]
    fn list_budgets_starts_empty_when_theres_nothing_earlier_to_copy_from() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.list_budgets("2026-08").unwrap(), vec![]);
    }

    #[test]
    fn a_new_month_copies_the_most_recent_earlier_periods_budget_as_a_starting_point() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();

        let september = store.list_budgets("2026-09").unwrap();

        assert_eq!(september.len(), 1);
        assert_eq!(september[0].category, "Groceries");
        assert_eq!(september[0].monthly_amount, "400.00".parse().unwrap());
    }

    #[test]
    fn editing_one_months_budget_does_not_affect_a_different_month() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-09").unwrap(); // materialize September from August, same as just viewing it

        store.set_budget("Groceries", "2026-09", "600.00".parse().unwrap(), "flexible").unwrap();

        let august = store.list_budgets("2026-08").unwrap();
        let september = store.list_budgets("2026-09").unwrap();

        assert_eq!(august[0].monthly_amount, "400.00".parse().unwrap(), "editing September must not change August");
        assert_eq!(september[0].monthly_amount, "600.00".parse().unwrap());
    }

    #[test]
    fn editing_a_months_budget_does_not_retroactively_change_an_earlier_month() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-07", "300.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-08").unwrap(); // materialize August from July

        store.set_budget("Groceries", "2026-08", "500.00".parse().unwrap(), "flexible").unwrap();

        let july = store.list_budgets("2026-07").unwrap();
        assert_eq!(july[0].monthly_amount, "300.00".parse().unwrap(), "editing August must not change July");
    }

    #[test]
    fn deleting_a_budget_line_in_one_month_does_not_delete_it_in_another() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-09").unwrap(); // materialize September too

        store.delete_budget("Groceries", "2026-09").unwrap();

        assert_eq!(store.list_budgets("2026-08").unwrap().len(), 1, "August's line must survive deleting September's");
        assert_eq!(store.list_budgets("2026-09").unwrap(), vec![]);
    }

    #[test]
    fn opening_a_pre_period_scoped_budgets_database_migrates_it_without_losing_data() {
        // Simulates a real database created before budgets were split per
        // month: a `budgets` table with `category` as its sole primary key.
        let dir = std::env::temp_dir().join(format!("meadow-budget-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_period_budgets.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE budgets (
                    category TEXT PRIMARY KEY,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible'
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO budgets (category, monthly_amount, budget_group) VALUES ('Groceries', '400.00', 'flexible')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let budgets = store.list_budgets("2026-08").unwrap();

        assert_eq!(budgets.len(), 1, "the pre-existing budget must survive the migration");
        assert_eq!(budgets[0].category, "Groceries");
        assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_database_with_period_scoped_budgets_but_no_tracking_table_still_finds_them() {
        // Simulates a database already migrated to the (category, period)
        // schema by an earlier build that predates `budget_periods` —
        // the tracker must be backfilled from what's actually in
        // `budgets`, not just seeded at migration time, or these rows
        // silently look untouched and become invisible.
        let dir = std::env::temp_dir().join(format!("meadow-budget-tracker-backfill-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("period_scoped_no_tracker.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE budgets (
                    category TEXT NOT NULL,
                    period TEXT NOT NULL,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible',
                    PRIMARY KEY (category, period)
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', '0000-01', '400.00', 'flexible')",
                [],
            )
            .unwrap();
            // deliberately no `budget_periods` table at all yet
        }

        let store = Store::open(&db_path).unwrap();
        let budgets = store.list_budgets("2026-08").unwrap();

        assert_eq!(budgets.len(), 1, "the pre-existing row must still be found and copied forward");
        assert_eq!(budgets[0].category, "Groceries");
        assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    // Reporting.

    #[test]
    fn total_saved_is_zero_with_no_buckets() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.total_saved().unwrap(), Decimal::ZERO);
    }

    #[test]
    fn total_saved_sums_contributions_across_every_bucket() {
        let store = Store::open_in_memory().unwrap();
        let vacation = store.create_bucket("Vacation", None, None, None).unwrap();
        let emergency = store.create_bucket("Emergency Fund", None, None, None).unwrap();
        store
            .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(vacation, "2026-08-15".parse().unwrap(), "-50.00".parse().unwrap(), None)
            .unwrap();

        assert_eq!(store.total_saved().unwrap(), "650.00".parse().unwrap());
    }

    #[test]
    fn income_total_sums_only_the_income_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"),
                    tx("2026-08-20", "Green Leaf Grocers", "-80.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Income", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Income", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

        assert_eq!(store.income_total().unwrap(), "6000.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_reports_only_this_months_spend_per_budgeted_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-20", "Fresh Market", "-60.00"),
                    tx("2026-07-25", "Old Month Grocers", "-999.00"), // different month, excluded
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals.len(), 1);
        assert_eq!(actuals[0].category, "Groceries");
        assert_eq!(actuals[0].budget_group, "flexible");
        assert_eq!(actuals[0].budgeted, "400.00".parse().unwrap());
        assert_eq!(actuals[0].actual, "140.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_reports_zero_spend_for_a_budgeted_category_with_no_transactions_yet() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals.len(), 1);
        assert_eq!(actuals[0].category, "Pet Care");
        assert_eq!(actuals[0].budgeted, "50.00".parse().unwrap());
        assert_eq!(actuals[0].actual, Decimal::ZERO);
    }

    #[test]
    fn monthly_budget_actuals_works_for_a_month_other_than_the_current_one() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2025-03-10", "Old Grocers", "-55.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let march_2025 = store.monthly_budget_actuals(2025, 3).unwrap();
        let august_2026 = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(march_2025[0].actual, "55.00".parse().unwrap());
        assert_eq!(august_2026[0].actual, Decimal::ZERO, "a different month must not see March's spend");
    }

    #[test]
    fn monthly_budget_actuals_reports_a_positive_actual_for_an_income_budget_line() {
        // Income transactions are stored as positive deposits, unlike
        // expense transactions which are negative — an income budget
        // line's "actual" must not be negated the way an expense line's is.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Employer Inc", "1200.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals[0].actual, "1200.00".parse().unwrap());
    }

    // Transactions for a category in a month (Budget page drill-down).

    #[test]
    fn transactions_for_category_in_month_returns_whole_transactions_in_that_category_and_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "City Power & Light", "-120.00"),
                    tx("2026-08-20", "Groceries R Us", "-60.00"), // different category
                    tx("2025-07-05", "City Power & Light", "-110.00"), // different month
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Utilities", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Utilities", CategorySource::User, None).unwrap();

        let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].transaction_id, ids[0]);
        assert_eq!(result[0].description, "City Power & Light");
        assert_eq!(result[0].amount, "-120.00".parse().unwrap());
        assert_eq!(result[0].account_name, "Test Checking");
        assert!(!result[0].is_split);
        assert_eq!(result[0].split_note, None);
    }

    #[test]
    fn transactions_for_category_in_month_includes_a_splits_own_line_instead_of_the_parent() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-10", "Costco", "-150.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-100.00".parse().unwrap(), None),
                    ("Household".to_string(), "-50.00".parse().unwrap(), Some("paper towels".to_string())),
                ],
            )
            .unwrap();

        let groceries = store.transactions_for_category_in_month("Groceries", 2026, 8).unwrap();
        let shopping = store.transactions_for_category_in_month("Shopping", 2026, 8).unwrap();

        assert_eq!(groceries.len(), 1);
        assert_eq!(groceries[0].transaction_id, id);
        assert_eq!(groceries[0].amount, "-100.00".parse().unwrap());
        assert!(groceries[0].is_split);
        assert_eq!(groceries[0].split_note, None);

        let household = store.transactions_for_category_in_month("Household", 2026, 8).unwrap();
        assert_eq!(household[0].split_note.as_deref(), Some("paper towels"));

        assert!(shopping.is_empty(), "a split transaction no longer counts under its own original category");
    }

    #[test]
    fn transactions_for_category_in_month_sorts_oldest_first() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-20", "Later Bill", "-40.00"), tx("2026-08-05", "Earlier Bill", "-30.00")],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Utilities", CategorySource::User, None).unwrap();
        }

        let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].description, "Earlier Bill");
        assert_eq!(result[1].description, "Later Bill");
    }

    // Budget threshold alerts.

    #[test]
    fn budget_alerts_for_month_is_empty_below_80_percent() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert!(alerts.is_empty(), "25% spent should not alert, got {alerts:?}");
    }

    #[test]
    fn budget_alerts_for_month_flags_a_category_at_80_percent_as_a_warning() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-320.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].category, "Groceries");
        assert_eq!(alerts[0].level, "warning");
    }

    #[test]
    fn budget_alerts_for_month_flags_a_category_spent_down_to_exactly_its_budget_as_a_warning_not_over() {
        // Landing exactly on budget (remaining == $0.00) isn't overspending
        // — only spending *past* it is. "over" is reserved for that.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-400.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, "warning");
        assert_eq!(alerts[0].pct, "100".parse().unwrap());
    }

    #[test]
    fn budget_alerts_for_month_flags_a_category_spent_past_its_budget_as_over() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-450.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, "over");
    }

    #[test]
    fn budget_alerts_for_month_never_flags_an_income_line() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Employer Inc", "9000.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert!(alerts.is_empty(), "exceeding an income budget should never alert, got {alerts:?}");
    }

    #[test]
    fn budget_alerts_for_month_never_flags_a_zero_budgeted_line() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Miscellaneous", "0000-01", "0.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Odds and Ends", "-50.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Miscellaneous", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert!(alerts.is_empty(), "a zero-budgeted line has nothing to alert against, got {alerts:?}");
    }

    // Anomaly flags.

    #[test]
    fn flags_a_transaction_far_above_its_categorys_recent_average_as_large() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Three prior Dining Out transactions averaging $20, all within
        // the trailing 180 days of the one being tested.
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"), // way above the $20 average
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();

        let large_flags: Vec<_> = flags.iter().filter(|f| f.kind == "large").collect();
        assert_eq!(large_flags.len(), 1);
        assert_eq!(large_flags[0].transaction_id, *ids.last().unwrap());
    }

    #[test]
    fn does_not_flag_a_large_transaction_in_a_category_with_too_little_history() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Only two prior transactions — below the 3-transaction minimum.
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();

        assert!(flags.iter().all(|f| f.kind != "large"), "too little history to judge, got {flags:?}");
    }

    #[test]
    fn flags_two_same_amount_similarly_described_transactions_within_a_few_days_as_duplicates_even_across_accounts() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")])
            .unwrap();
        store
            .save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")])
            .unwrap();

        let flags = store.anomaly_flags().unwrap();

        let dup_flags: Vec<_> = flags.iter().filter(|f| f.kind == "duplicate").collect();
        assert_eq!(dup_flags.len(), 2, "both sides of the pair should be flagged, got {flags:?}");
    }

    #[test]
    fn does_not_flag_transactions_that_only_share_amount_but_not_description() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-05", "Netflix", "-15.99"), tx("2026-08-06", "Spotify", "-15.99")],
            )
            .unwrap();

        let flags = store.anomaly_flags().unwrap();

        assert!(flags.iter().all(|f| f.kind != "duplicate"), "different merchants, got {flags:?}");
    }

    #[test]
    fn does_not_flag_matches_more_than_a_few_days_apart() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-01", "Netflix", "-15.99"), tx("2026-08-20", "Netflix", "-15.99")],
            )
            .unwrap();

        let flags = store.anomaly_flags().unwrap();

        assert!(flags.iter().all(|f| f.kind != "duplicate"), "19 days apart is a normal monthly bill, got {flags:?}");
    }

    // Large expenses in range (cash-flow chart's per-month drill-down).

    #[test]
    fn large_expenses_in_range_includes_a_large_anomaly_dated_within_the_range() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].transaction_id, *ids.last().unwrap());
        assert_eq!(result[0].description, "Fancy Steakhouse");
        assert_eq!(result[0].amount, "-200.00".parse().unwrap());
        assert_eq!(result[0].category.as_deref(), Some("Dining Out"));
        assert!(result[0].detail.contains("Dining Out"), "detail should explain why: {}", result[0].detail);
    }

    #[test]
    fn large_expenses_in_range_excludes_a_large_anomaly_dated_outside_the_range() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-07-01".parse().unwrap(), "2026-07-31".parse().unwrap())
            .unwrap();

        assert!(result.is_empty(), "the large expense is dated in August, not July: {result:?}");
    }

    #[test]
    fn large_expenses_in_range_excludes_duplicate_flags() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")])
            .unwrap();
        store
            .save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")])
            .unwrap();

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert!(result.is_empty(), "duplicates aren't large expenses: {result:?}");
    }

    #[test]
    fn large_expenses_in_range_sorts_by_amount_descending() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                    tx("2026-08-15", "Fanciest Steakhouse", "-500.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].description, "Fanciest Steakhouse");
        assert_eq!(result[1].description, "Fancy Steakhouse");
    }

    // Dashboard insights.

    #[test]
    fn dashboard_insights_is_empty_for_a_quiet_month() {
        let store = Store::open_in_memory().unwrap();
        let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();
        assert!(insights.is_empty());
    }

    #[test]
    fn dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
        // $100 spent in the first 10 days of a 31-day August projects to
        // $310 — well past the $200 budget (>1.1x).
        store
            .save_transactions(account, &[tx("2026-08-05", "Cafe", "-100.00")])
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-10".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "pace" && i.message.contains("Dining Out")),
            "expected a pace insight for Dining Out: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_skips_pace_projection_before_day_5_of_the_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-02", "Cafe", "-100.00")])
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        // Only 3 days into the month — too little signal to project from.
        let insights = store.dashboard_insights("2026-08-03".parse().unwrap()).unwrap();

        assert!(!insights.iter().any(|i| i.kind == "pace"), "expected no early-month pace insight: {insights:?}");
    }

    #[test]
    fn dashboard_insights_flags_a_month_over_month_category_jump() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-05", "Grocer", "-100.00"),
                    tx("2026-08-05", "Grocer", "-200.00"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "category_jump" && i.message.contains("Groceries")),
            "expected a category-jump insight for Groceries: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_surfaces_a_large_expense_in_the_current_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-05-01", "Cafe One", "-15.00"),
                    tx("2026-06-01", "Cafe Two", "-20.00"),
                    tx("2026-07-01", "Cafe Three", "-25.00"),
                    tx("2026-08-05", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "large_expense" && i.message.contains("Fancy Steakhouse")),
            "expected a large-expense insight: {insights:?}"
        );
    }

    // Recurring.

    #[test]
    fn next_occurrence_returns_the_anchor_itself_when_it_is_still_in_the_future() {
        let anchor: NaiveDate = "2026-09-01".parse().unwrap();
        let today: NaiveDate = "2026-08-20".parse().unwrap();
        assert_eq!(next_occurrence(anchor, "monthly", today), anchor);
    }

    #[test]
    fn next_occurrence_rolls_a_weekly_anchor_forward_past_today() {
        let anchor: NaiveDate = "2026-08-01".parse().unwrap(); // a Saturday
        let today: NaiveDate = "2026-08-20".parse().unwrap();
        // 2026-08-01, 08, 15, 22 — first occurrence on/after today
        assert_eq!(next_occurrence(anchor, "weekly", today), "2026-08-22".parse().unwrap());
    }

    #[test]
    fn next_occurrence_rolls_a_biweekly_anchor_forward() {
        let anchor: NaiveDate = "2026-08-01".parse().unwrap();
        let today: NaiveDate = "2026-08-20".parse().unwrap();
        // 08-01, 08-15, 08-29
        assert_eq!(next_occurrence(anchor, "biweekly", today), "2026-08-29".parse().unwrap());
    }

    #[test]
    fn next_occurrence_rolls_a_monthly_anchor_forward_across_months() {
        let anchor: NaiveDate = "2026-06-15".parse().unwrap();
        let today: NaiveDate = "2026-08-20".parse().unwrap();
        assert_eq!(next_occurrence(anchor, "monthly", today), "2026-09-15".parse().unwrap());
    }

    #[test]
    fn next_occurrence_clamps_a_monthly_anchor_to_a_shorter_month() {
        let anchor: NaiveDate = "2026-01-31".parse().unwrap();
        let today: NaiveDate = "2026-02-15".parse().unwrap();
        // February has no 31st — must clamp, not panic or skip to March
        assert_eq!(next_occurrence(anchor, "monthly", today), "2026-02-28".parse().unwrap());
    }

    #[test]
    fn next_occurrence_rolls_an_annual_anchor_forward_across_years() {
        let anchor: NaiveDate = "2024-03-01".parse().unwrap();
        let today: NaiveDate = "2026-08-20".parse().unwrap();
        assert_eq!(next_occurrence(anchor, "annual", today), "2027-03-01".parse().unwrap());
    }

    #[test]
    fn create_recurring_then_list_recurring_computes_next_date() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_recurring("Netflix", Some("Subscriptions"), "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
            .unwrap();

        let today: NaiveDate = "2026-08-20".parse().unwrap();
        let items = store.list_recurring(today).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, id);
        assert_eq!(items[0].merchant, "Netflix");
        assert_eq!(items[0].category, Some("Subscriptions".to_string()));
        assert_eq!(items[0].next_date, "2026-09-04".parse().unwrap());
    }

    #[test]
    fn list_recurring_includes_the_linked_accounts_name() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store
            .create_recurring("Rocket Mortgage", None, "-1840.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), Some(checking))
            .unwrap();

        let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(items[0].account_name, Some("Everyday Checking".to_string()));
    }

    #[test]
    fn delete_recurring_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
            .unwrap();

        store.delete_recurring(id).unwrap();

        assert_eq!(store.list_recurring("2026-08-20".parse().unwrap()).unwrap().len(), 0);
    }

    #[test]
    fn delete_recurring_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_recurring(999).unwrap();
    }

    #[test]
    fn update_recurring_changes_every_field() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let id = store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
            .unwrap();

        store
            .update_recurring(
                id,
                "Netflix (renamed)",
                Some("Subscriptions"),
                "-18.99".parse().unwrap(),
                "annual",
                "2026-07-01".parse().unwrap(),
                Some(checking),
            )
            .unwrap();

        let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].merchant, "Netflix (renamed)");
        assert_eq!(items[0].category, Some("Subscriptions".to_string()));
        assert_eq!(items[0].amount, "-18.99".parse().unwrap());
        assert_eq!(items[0].cadence, "annual");
        assert_eq!(items[0].anchor_date, "2026-07-01".parse().unwrap());
        assert_eq!(items[0].account_name, Some("Checking".to_string()));
    }

    #[test]
    fn update_recurring_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store
            .update_recurring(999, "Ghost", None, "-1.00".parse().unwrap(), "monthly", "2026-08-20".parse().unwrap(), None)
            .unwrap();
    }

    fn seed_txns(store: &Store, account: i64, merchant: &str, amount: &str, dates: &[&str]) {
        for date in dates {
            store.save_transactions(account, &[tx(date, merchant, amount)]).unwrap();
        }
    }

    #[test]
    fn detect_recurring_candidates_finds_a_monthly_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Netflix",
            "-15.49",
            &["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"],
        );

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].merchant, "Netflix");
        assert_eq!(candidates[0].amount, "-15.49".parse().unwrap());
        assert_eq!(candidates[0].cadence, "monthly");
        assert_eq!(candidates[0].occurrence_count, 4);
        assert_eq!(candidates[0].anchor_date, "2026-08-04".parse().unwrap());
    }

    #[test]
    fn detect_recurring_candidates_classifies_a_biweekly_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Cleaning Service",
            "-60.00",
            &["2026-06-05", "2026-06-19", "2026-07-03"],
        );

        let candidates = store.detect_recurring_candidates("2026-07-10".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].cadence, "biweekly");
    }

    #[test]
    fn detect_recurring_candidates_skips_a_pattern_that_looks_stopped() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Old Gym",
            "-40.00",
            &["2026-01-04", "2026-02-04", "2026-03-04"],
        );

        // Monthly cadence, but the most recent charge was ~5.5 months before
        // "today" — well past 2x the ~30-day cadence, so this reads as a
        // cancelled subscription rather than an active one.
        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_ignores_irregular_gaps() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Random Store",
            "-20.00",
            &["2026-01-05", "2026-03-20", "2026-08-01"],
        );

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_requires_at_least_three_occurrences() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Gym", "-40.00", &["2026-06-01", "2026-07-01"]);

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_excludes_a_merchant_already_tracked_as_recurring() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Netflix",
            "-15.49",
            &["2026-05-04", "2026-06-04", "2026-07-04"],
        );
        store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
            .unwrap();

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn dismiss_recurring_candidate_excludes_it_from_future_detection() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Spotify",
            "-9.99",
            &["2026-05-04", "2026-06-04", "2026-07-04"],
        );
        assert_eq!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().len(), 1);

        store
            .dismiss_recurring_candidate("Spotify", "-9.99".parse().unwrap(), "monthly")
            .unwrap();

        assert!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty());
    }

    #[test]
    fn detect_recurring_candidates_infers_the_majority_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        for (date, category) in [
            ("2026-05-04", "Subscriptions"),
            ("2026-06-04", "Subscriptions"),
            ("2026-07-04", "Entertainment"),
        ] {
            let mut t = tx(date, "Netflix", "-15.49");
            t.category = Some(category.to_string());
            store.save_transactions(account, &[t]).unwrap();
        }

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates[0].category, Some("Subscriptions".to_string()));
    }

    // Investments.

    #[test]
    fn create_holding_then_list_holdings_computes_value_and_gain() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();

        let id = store
            .create_holding(
                brokerage,
                "AAPL",
                "Apple Inc.",
                "8".parse().unwrap(),
                "231.20".parse().unwrap(),
                "1450.00".parse().unwrap(),
                Some("US Stocks"),
            )
            .unwrap();

        let holdings = store.list_holdings().unwrap();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].id, id);
        assert_eq!(holdings[0].account_name, "Individual Brokerage");
        assert_eq!(holdings[0].value, "1849.60".parse().unwrap());
        assert_eq!(holdings[0].gain_loss, "399.60".parse().unwrap());
    }

    #[test]
    fn a_holding_below_cost_basis_reports_a_loss() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "BTC",
                "Bitcoin",
                "0.012".parse().unwrap(),
                "40000".parse().unwrap(),
                "620.00".parse().unwrap(),
                Some("Crypto"),
            )
            .unwrap();

        let holdings = store.list_holdings().unwrap();
        assert_eq!(holdings[0].value, "480.00".parse().unwrap());
        assert_eq!(holdings[0].gain_loss, "-140.00".parse().unwrap());
    }

    #[test]
    fn update_holding_price_recomputes_value_and_gain() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "3.6".parse().unwrap(),
                "500.00".parse().unwrap(),
                "1780.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.update_holding_price(id, "552.10".parse().unwrap()).unwrap();

        let holdings = store.list_holdings().unwrap();
        assert_eq!(holdings[0].price, "552.10".parse().unwrap());
        assert_eq!(holdings[0].value, "1987.56".parse().unwrap());
    }

    #[test]
    fn update_holding_price_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_holding_price(999, "100.00".parse().unwrap()).unwrap();
    }

    #[test]
    fn delete_holding_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(brokerage, "AAPL", "Apple Inc.", "8".parse().unwrap(), "231.20".parse().unwrap(), "1450.00".parse().unwrap(), None)
            .unwrap();

        store.delete_holding(id).unwrap();

        assert_eq!(store.list_holdings().unwrap().len(), 0);
    }

    #[test]
    fn delete_holding_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_holding(999).unwrap();
    }

    #[test]
    fn list_distinct_holding_symbols_dedupes_across_accounts() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
        store
            .create_holding(brokerage, "AAPL", "Apple Inc.", "1".parse().unwrap(), "200".parse().unwrap(), "200".parse().unwrap(), None)
            .unwrap();
        store
            .create_holding(ira, "AAPL", "Apple Inc.", "2".parse().unwrap(), "200".parse().unwrap(), "400".parse().unwrap(), None)
            .unwrap();
        store
            .create_holding(brokerage, "MSFT", "Microsoft Corp.", "1".parse().unwrap(), "300".parse().unwrap(), "300".parse().unwrap(), None)
            .unwrap();

        let symbols = store.list_distinct_holding_symbols().unwrap();

        assert_eq!(symbols, vec!["AAPL".to_string(), "MSFT".to_string()]);
    }

    #[test]
    fn update_holding_prices_for_symbol_updates_all_matching_holdings() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
        store
            .create_holding(brokerage, "AAPL", "Apple Inc.", "1".parse().unwrap(), "200".parse().unwrap(), "200".parse().unwrap(), None)
            .unwrap();
        store
            .create_holding(ira, "AAPL", "Apple Inc.", "2".parse().unwrap(), "200".parse().unwrap(), "400".parse().unwrap(), None)
            .unwrap();
        store
            .create_holding(brokerage, "MSFT", "Microsoft Corp.", "1".parse().unwrap(), "300".parse().unwrap(), "300".parse().unwrap(), None)
            .unwrap();

        let updated = store.update_holding_prices_for_symbol("AAPL", "250".parse().unwrap()).unwrap();

        assert_eq!(updated, 2);
        let holdings = store.list_holdings().unwrap();
        for h in &holdings {
            if h.symbol == "AAPL" {
                assert_eq!(h.price, "250".parse().unwrap());
            } else {
                assert_eq!(h.price, "300".parse().unwrap());
            }
        }
    }

    #[test]
    fn update_holding_prices_for_symbol_on_unknown_symbol_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let updated = store.update_holding_prices_for_symbol("NOSUCH", "1".parse().unwrap()).unwrap();
        assert_eq!(updated, 0);
    }

    #[test]
    fn live_price_settings_default_when_never_set() {
        let store = Store::open_in_memory().unwrap();

        let settings = store.get_live_price_settings().unwrap();

        assert_eq!(settings.api_key, None);
        assert_eq!(settings.last_refreshed_at, None);
    }

    #[test]
    fn set_live_price_api_key_then_get_returns_it() {
        let store = Store::open_in_memory().unwrap();

        store.set_live_price_api_key(Some("demo-key")).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.api_key, Some("demo-key".to_string()));
    }

    #[test]
    fn set_live_price_api_key_none_clears_it() {
        let store = Store::open_in_memory().unwrap();
        store.set_live_price_api_key(Some("demo-key")).unwrap();

        store.set_live_price_api_key(None).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.api_key, None);
    }

    #[test]
    fn set_live_prices_last_refreshed_persists_timestamp() {
        let store = Store::open_in_memory().unwrap();
        let at = NaiveDateTime::parse_from_str("2026-08-30 14:05:00", "%Y-%m-%d %H:%M:%S").unwrap();

        store.set_live_prices_last_refreshed(at).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.last_refreshed_at, Some(at));
    }

    #[test]
    fn live_price_requests_used_today_is_zero_when_never_recorded() {
        let store = Store::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
    }

    #[test]
    fn record_live_price_request_increments_and_returns_the_new_count() {
        let store = Store::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

        assert_eq!(store.record_live_price_request(today).unwrap(), 1);
        assert_eq!(store.record_live_price_request(today).unwrap(), 2);
        assert_eq!(store.record_live_price_request(today).unwrap(), 3);
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 3);
    }

    #[test]
    fn record_live_price_request_resets_to_one_on_a_new_day() {
        let store = Store::open_in_memory().unwrap();
        let yesterday = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        store.record_live_price_request(yesterday).unwrap();
        store.record_live_price_request(yesterday).unwrap();

        let count = store.record_live_price_request(today).unwrap();

        assert_eq!(count, 1);
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 1);
        assert_eq!(store.live_price_requests_used_today(yesterday).unwrap(), 0);
    }

    #[test]
    fn opening_a_pre_request_tracking_database_migrates_it_without_losing_the_api_key() {
        // Simulates a database from before the daily request counter
        // existed: a `live_price_settings` table with just the original two
        // columns, already holding a saved API key.
        let dir = std::env::temp_dir().join(format!("pennyworth-live-price-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_request_tracking.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE live_price_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    api_key TEXT,
                    last_refreshed_at TEXT
                );",
            )
            .unwrap();
            conn.execute("INSERT INTO live_price_settings (id, api_key) VALUES (1, 'saved-key')", [])
                .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.api_key, Some("saved-key".to_string()), "the saved API key must survive the migration");

        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
        assert_eq!(store.record_live_price_request(today).unwrap(), 1);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    // Manual assets ("Property & Valuables").

    #[test]
    fn create_asset_then_list_assets_reads_it_back() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset(
                "Home",
                "real_estate",
                "350000.00".parse().unwrap(),
                "2026-08-01".parse().unwrap(),
                Some("Zillow estimate"),
            )
            .unwrap();

        let assets = store.list_assets().unwrap();

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].id, id);
        assert_eq!(assets[0].name, "Home");
        assert_eq!(assets[0].asset_type, "real_estate");
        assert_eq!(assets[0].value, "350000.00".parse().unwrap());
        assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
        assert_eq!(assets[0].notes.as_deref(), Some("Zillow estimate"));
    }

    #[test]
    fn update_asset_value_changes_value_and_valued_on() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset("Car", "vehicle", "20000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
            .unwrap();

        store.update_asset_value(id, "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap()).unwrap();

        let assets = store.list_assets().unwrap();
        assert_eq!(assets[0].value, "17000.00".parse().unwrap());
        assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
    }

    #[test]
    fn delete_asset_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset("Boat", "other", "5000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
            .unwrap();

        store.delete_asset(id).unwrap();

        assert_eq!(store.list_assets().unwrap().len(), 0);
    }

    #[test]
    fn delete_asset_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_asset(999).unwrap();
    }

    #[test]
    fn total_assets_value_sums_every_asset() {
        let store = Store::open_in_memory().unwrap();
        store
            .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store
            .create_asset("Car", "vehicle", "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        assert_eq!(store.total_assets_value().unwrap(), "367000.00".parse().unwrap());
    }

    #[test]
    fn total_assets_value_is_zero_with_no_assets() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.total_assets_value().unwrap(), Decimal::ZERO);
    }

    #[test]
    fn adding_an_asset_does_not_change_historical_net_worth() {
        // Locks in the deliberate design decision: manual assets carry only
        // a current value, so retroactively applying it to every past point
        // on the net-worth trend would misrepresent history — they feed the
        // *current* net-worth figure only (computed client-side from
        // `total_assets_value`), never `net_worth_as_of`.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let before = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

        store
            .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        let after = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(before, after);
    }

    // Debt payoff planner.

    #[test]
    fn debt_payoff_projection_with_no_debt_resolves_immediately() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();

        let plan = store
            .debt_payoff_projection("snowball", Decimal::ZERO, &[], "2026-08-20".parse().unwrap())
            .unwrap();

        assert!(plan.per_account.is_empty());
        assert_eq!(plan.total_months, Some(0));
        assert_eq!(plan.total_interest_paid, Decimal::ZERO);
    }

    #[test]
    fn debt_payoff_projection_excludes_an_account_marked_excluded_from_debt_payoff() {
        // A credit card the user pays off in full every month shouldn't be
        // dragged into a payoff plan just because it happens to carry a
        // balance at the moment they check.
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Paid Off Monthly Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store.set_account_excluded_from_debt_payoff(card, true).unwrap();

        let plan = store
            .debt_payoff_projection("snowball", Decimal::ZERO, &[(card, "50.00".parse().unwrap())], "2026-08-20".parse().unwrap())
            .unwrap();

        assert!(plan.per_account.is_empty());
        assert_eq!(plan.total_months, Some(0));
    }

    #[test]
    fn set_account_excluded_from_debt_payoff_can_be_reversed() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store.set_account_excluded_from_debt_payoff(card, true).unwrap();
        store.set_account_excluded_from_debt_payoff(card, false).unwrap();

        let plan = store
            .debt_payoff_projection("snowball", Decimal::ZERO, &[(card, "50.00".parse().unwrap())], "2026-08-20".parse().unwrap())
            .unwrap();

        assert_eq!(plan.per_account.len(), 1, "re-including the account should bring it back into the plan");
    }

    #[test]
    fn debt_payoff_projection_pays_off_a_zero_interest_loan_using_only_the_minimum() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "1200.00".parse().unwrap()).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert_eq!(plan.per_account.len(), 1);
        assert_eq!(plan.per_account[0].payoff_date, Some("2027-08-20".parse().unwrap()));
        assert_eq!(plan.per_account[0].total_interest_paid, Decimal::ZERO);
        assert_eq!(plan.total_months, Some(12));
    }

    #[test]
    fn debt_payoff_projection_snowball_pays_off_the_smaller_balance_first_and_rolls_its_minimum_forward() {
        let store = Store::open_in_memory().unwrap();
        let small = store.get_or_create_account("Small Debt", AccountType::Loan).unwrap();
        store.set_account_starting_balance(small, "100.00".parse().unwrap()).unwrap();
        let big = store.get_or_create_account("Big Debt", AccountType::Loan).unwrap();
        store.set_account_starting_balance(big, "1000.00".parse().unwrap()).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(small, "100.00".parse().unwrap()), (big, "10.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        let small_line = plan.per_account.iter().find(|l| l.account_id == small).unwrap();
        assert!(plan.per_account.iter().any(|l| l.account_id == big));

        // Small Debt clears in month 1 (its $100 minimum covers the whole
        // $100 balance in one shot).
        assert_eq!(small_line.payoff_date, Some("2026-09-20".parse().unwrap()));
        // Once freed, Small Debt's $100 minimum rolls into Big Debt on top
        // of its own $10 — $110/month clears $1000 in well under the ~100
        // months a flat $10/month alone would take.
        let big_months = plan.total_months.unwrap();
        assert!(big_months < 20, "expected the rolled-over minimum to accelerate payoff, got {big_months} months");
    }

    #[test]
    fn debt_payoff_projection_avalanche_prioritizes_the_higher_rate_debt() {
        let store = Store::open_in_memory().unwrap();
        let high_rate = store.get_or_create_account("High Rate Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(high_rate, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(high_rate, Some("25.00".parse().unwrap())).unwrap();
        let low_rate = store.get_or_create_account("Low Rate Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(low_rate, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(low_rate, Some("5.00".parse().unwrap())).unwrap();

        let plan = store
            .debt_payoff_projection(
                "avalanche",
                "200.00".parse().unwrap(),
                &[(high_rate, "10.00".parse().unwrap()), (low_rate, "10.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        let high_line = plan.per_account.iter().find(|l| l.account_id == high_rate).unwrap();
        let low_line = plan.per_account.iter().find(|l| l.account_id == low_rate).unwrap();
        assert!(
            high_line.payoff_date.unwrap() < low_line.payoff_date.unwrap(),
            "avalanche should clear the higher-rate card first: {high_line:?} vs {low_line:?}"
        );
    }

    #[test]
    fn debt_payoff_projection_extra_payment_shortens_the_timeline() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "5000.00".parse().unwrap()).unwrap();

        let without_extra = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap()
            .total_months
            .unwrap();
        let with_extra = store
            .debt_payoff_projection(
                "snowball",
                "200.00".parse().unwrap(),
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap()
            .total_months
            .unwrap();

        assert!(with_extra < without_extra);
    }

    #[test]
    fn debt_payoff_projection_accrues_interest_on_an_apr_bearing_debt() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "1200.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(card, Some("24.00".parse().unwrap())).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "110.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert!(plan.total_interest_paid > Decimal::ZERO);
        assert!(plan.per_account[0].payoff_date.is_some());
    }

    #[test]
    fn debt_payoff_projection_never_resolves_when_the_minimum_does_not_cover_interest() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(card, Some("36.00".parse().unwrap())).unwrap();

        // 36% APR = 3%/month = $30/month in interest on $1000 — a $5
        // minimum with no extra payment can never make a dent.
        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "5.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert_eq!(plan.total_months, None);
        assert_eq!(plan.per_account[0].payoff_date, None);
    }

    // Cash-flow forecast.

    #[test]
    fn cash_flow_forecast_stays_flat_with_no_transaction_history() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 30).unwrap();

        assert_eq!(points.len(), 31);
        assert!(points.iter().all(|p| p.balance == "1000.00".parse().unwrap()));
        assert_eq!(points[0].date, "2026-08-20".parse().unwrap());
        assert_eq!(points[30].date, "2026-09-19".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_projects_the_trailing_average_daily_net_forward() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
        // Earliest activity is 10 days before "today" (clamps the window to
        // 10 days, not the full 90) — balance there is $1000. Two more
        // transactions bring it to $1800 by today: a net gain of $800 over
        // 10 days = $80/day.
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-10", "Opening balance", "1000.00"),
                    tx("2026-08-15", "Paycheck", "500.00"),
                    tx("2026-08-20", "Side income", "300.00"),
                ],
            )
            .unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 10).unwrap();

        assert_eq!(points[0].balance, "1800.00".parse().unwrap());
        assert_eq!(points[1].balance, "1880.00".parse().unwrap());
        assert_eq!(points[10].balance, "2600.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_clamps_the_window_to_available_history_not_a_blind_90_days() {
        // If the $80/day-net test above instead divided by a blind 90 days
        // (rather than the 10 days of history that actually exist), the
        // slope would come out roughly 9x too shallow — this pins the
        // clamping behavior specifically.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-19", "Opening balance", "100.00"), tx("2026-08-20", "Deposit", "50.00")])
            .unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 1).unwrap();

        // 1 day of history, $50 net over that day -> $50/day slope.
        assert_eq!(points[0].balance, "150.00".parse().unwrap());
        assert_eq!(points[1].balance, "200.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_with_zero_days_returns_just_todays_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 0).unwrap();

        assert_eq!(points.len(), 1);
        assert_eq!(points[0].balance, "1000.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_only_starts_from_cash_group_accounts() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 5).unwrap();

        assert_eq!(points[0].balance, "1000.00".parse().unwrap(), "investment balance must not count");
    }

    // Cash flow aggregates.

    #[test]
    fn monthly_totals_sums_income_and_expense_separately_for_one_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Fresh Market", "-40.00"),
                    tx("2026-07-25", "Old Month Payroll", "2000.00"), // different month, excluded
                ],
            )
            .unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, "3000.00".parse().unwrap());
        assert_eq!(expense, "120.00".parse().unwrap());
    }

    #[test]
    fn spending_by_category_sums_expenses_within_a_date_range_sorted_descending() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Fresh Market", "-40.00"),
                    tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
                    tx("2026-07-01", "Old Grocers", "-999.00"), // outside range, excluded
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Dining Out", CategorySource::User, None).unwrap();

        let spend = store
            .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(
            spend,
            vec![
                ("Dining Out".to_string(), "200.00".parse().unwrap()),
                ("Groceries".to_string(), "120.00".parse().unwrap()),
            ]
        );
    }

    #[test]
    fn top_merchants_ranks_by_total_spend_and_respects_the_limit() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Green Leaf Grocers", "-40.00"),
                    tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                    tx("2026-08-14", "Corner Store", "-10.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
                ],
            )
            .unwrap();

        let top = store
            .top_merchants("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap(), 2)
            .unwrap();

        assert_eq!(
            top,
            vec![
                ("Ferrywood Coffee".to_string(), "200.00".parse().unwrap()),
                ("Green Leaf Grocers".to_string(), "120.00".parse().unwrap()),
            ]
        );
    }

    // Net worth history.

    #[test]
    fn net_worth_as_of_only_counts_transactions_up_to_that_date() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-07-15", "Payroll Deposit", "500.00"),
                    tx("2026-08-15", "Payroll Deposit", "500.00"), // after the cutoff below
                ],
            )
            .unwrap();

        let as_of_july: NaiveDate = "2026-07-31".parse().unwrap();
        let as_of_august: NaiveDate = "2026-08-31".parse().unwrap();

        assert_eq!(store.net_worth_as_of(as_of_july).unwrap(), "1500.00".parse().unwrap());
        assert_eq!(store.net_worth_as_of(as_of_august).unwrap(), "2000.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_counts_debt_as_negative() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
        store
            .save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]) // a charge -> $300 owed
            .unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // 1000 cash - 300 owed on the card = 700
        assert_eq!(net_worth, "700.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_counts_a_loans_starting_balance_as_debt_from_day_one() {
        // A loan's `starting_balance` is the amount already owed (unlike a
        // credit account's, which is a limit and starts at $0 owed) — so
        // with no transactions yet, the whole thing must count as debt.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // 1000 cash - 15000 owed on the loan = -14000
        assert_eq!(net_worth, "-14000.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_reduces_loan_debt_as_payments_are_made() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(loan, &[tx("2026-08-05", "Loan Payment", "-500.00")])
            .unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // Owed drops from 15000 to 14500 after a 500 payment.
        assert_eq!(net_worth, "-14500.00".parse().unwrap());
    }

    // Monthly balance rollover.

    #[test]
    fn roll_forward_monthly_balances_makes_current_balance_the_new_baseline() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(loan, &[tx("2026-08-05", "Payment", "-1000.00")])
            .unwrap(); // owed drops to 299000 during August

        let rolled = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();

        assert_eq!(rolled.len(), 1);
        assert_eq!(rolled[0].1, "Mortgage");
        assert_eq!(rolled[0].2, "299000.00".parse().unwrap());

        // "now" (well into September, no further transactions) reflects the reset directly.
        let accounts = store.list_accounts("2026-09-15".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].current_balance, "299000.00".parse().unwrap());
    }

    #[test]
    fn roll_forward_monthly_balances_is_a_no_op_the_second_time_in_the_same_month() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let first = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        let second = store.roll_forward_monthly_balances("2026-09-20".parse().unwrap()).unwrap();

        assert_eq!(first.len(), 1);
        assert!(second.is_empty(), "same month, already rolled — must not roll again or double-report");
    }

    #[test]
    fn roll_forward_monthly_balances_adds_a_fresh_reset_for_a_later_month() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-09-10", "Deposit", "200.00")])
            .unwrap();
        let october_roll = store.roll_forward_monthly_balances("2026-10-01".parse().unwrap()).unwrap();

        assert_eq!(october_roll.len(), 1);
        assert_eq!(october_roll[0].2, "1200.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_before_a_reset_is_unaffected_by_it() {
        // The whole point of resetting via a new row instead of mutating
        // starting_balance in place: a past lookup must keep using
        // whatever was true back then, never a later reset's value.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")])
            .unwrap();
        let before_reset = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // Roll forward into September, then add a large September transaction.
        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-09-15", "Big Deposit", "50000.00")])
            .unwrap();

        let after_reset_and_more_activity = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        assert_eq!(before_reset, "1500.00".parse().unwrap());
        assert_eq!(
            after_reset_and_more_activity, before_reset,
            "an August lookup must be untouched by a September reset or later transactions"
        );
    }

    #[test]
    fn list_accounts_only_sums_transactions_after_the_latest_reset() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")])
            .unwrap();

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-09-05", "Deposit", "100.00")])
            .unwrap();

        let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();

        // 1500 (reset baseline) + 100 (September's only transaction) = 1600,
        // NOT 1000 + 500 + 100 = 1600 double-counted differently, and
        // definitely not re-summing August's 500 on top of the reset.
        assert_eq!(accounts[0].current_balance, "1600.00".parse().unwrap());
    }
}
