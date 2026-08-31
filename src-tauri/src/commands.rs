use budget_core::categorizer;
use budget_core::classifier::Classifier;
use budget_core::importer;
use budget_core::learner;
use budget_core::models::AccountType;
use budget_core::rules::RuleSet;
use budget_core::store::{CategorySource, Store};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::Mutex;

/// Writes arbitrary text (CSV export content) to a path the user already
/// picked via a native save dialog on the frontend — the frontend builds
/// the CSV itself (it already holds exactly the filtered/visible rows to
/// export), this just does the actual filesystem write, which sandboxed
/// frontend JS can't do directly.
///
/// Prepends a UTF-8 byte-order-mark: without one, Excel (and other Windows
/// tools) guesses the file is Windows-1252 rather than UTF-8, and any
/// non-ASCII character (an em dash, a curly quote, an accented name) comes
/// back as mojibake. `setup_import::load_setup_csv` strips a leading BOM
/// back out when reading a file this produced, so the round trip is safe.
/// Returns the currently-resolved data file path, for display on the
/// Reports tab's Settings section.
/// The data file path this session is actually using right now — may
/// differ from what `resolve_db_path` computed at launch, since
/// `relocate_data_file`/`restore_backup` update it in place rather than
/// requiring a restart. A poisoned lock (only possible if an earlier panic
/// happened mid-update) still yields a usable path rather than taking down
/// every command that reads it.
fn current_db_path(paths: &crate::config::AppPaths) -> std::path::PathBuf {
    paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn get_data_file_location(paths: tauri::State<crate::config::AppPaths>) -> String {
    current_db_path(&paths).to_string_lossy().to_string()
}

/// Copies the live database to `new_dir/pennyworth.db` (via `Store::backup_to`,
/// safe against a live connection), points `config.json` at it, then swaps
/// this session's live connection over to the new file in place. The old
/// file is deliberately left behind, untouched.
///
/// This used to ask for (and, briefly, automatically trigger) a full app
/// restart instead. Automatic restart via `tauri-plugin-process`'s
/// `relaunch()` turned out to be unreliable on Windows in real testing — a
/// second WebView2 instance racing the first one's teardown occasionally
/// left the relaunched window stuck on a native "can't reach this page"
/// error (a `Chrome_WidgetWin_0` window-class unregister failure). Hot-
/// swapping the connection instead sidesteps that whole class of bug by
/// never opening a second window at all.
#[tauri::command]
pub fn relocate_data_file(
    new_dir: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let new_dir = std::path::PathBuf::from(new_dir);
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let new_db_path = new_dir.join("pennyworth.db");
    if new_db_path.exists() {
        return Err(format!(
            "{} already has a pennyworth.db — pick an empty folder.",
            new_dir.display()
        ));
    }

    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.backup_to(&new_db_path).map_err(|e| e.to_string())?;
    crate::config::write_db_location_config(&paths.config_path, &new_db_path).map_err(|e| e.to_string())?;
    *state = AppState::open(&new_db_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = new_db_path.clone();

    Ok(new_db_path.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct BackupDto {
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn list_backups(paths: tauri::State<crate::config::AppPaths>) -> Result<Vec<BackupDto>, String> {
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths));
    Ok(crate::backups::list_backups(&backups_dir)?
        .into_iter()
        .map(|b| BackupDto {
            filename: b.filename,
            created_at: b.created_at,
            size_bytes: b.size_bytes,
        })
        .collect())
}

/// Manual "Back up now" — always creates one, bypassing the 24h automatic
/// throttle (`backups::create_backup_if_due`, called only at launch).
#[tauri::command]
pub fn create_backup_now(
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths));
    crate::backups::create_backup(&state.store, &backups_dir, chrono::Local::now().naive_local())
}

/// Restores `filename` into a brand-new file (see `backups::restore_backup`
/// for why it's never written into the already-open live path), points
/// `config.json` at it, and swaps this session's live connection over to it
/// — same in-place hot-swap as `relocate_data_file`, and for the same
/// reason (see its doc comment).
#[tauri::command]
pub fn restore_backup(
    filename: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let live_db_path = current_db_path(&paths);
    let backups_dir = crate::backups::backups_dir_for(&live_db_path);
    let restored_path = crate::backups::restore_backup(&state.store, &backups_dir, &filename, &live_db_path)?;
    crate::config::write_db_location_config(&paths.config_path, &restored_path).map_err(|e| e.to_string())?;
    *state = AppState::open(&restored_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = restored_path;
    Ok(())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

fn parse_amount(amount: &str) -> Result<Decimal, String> {
    amount.parse().map_err(|_| format!("invalid amount: {amount}"))
}

fn parse_date(date: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| format!("invalid date: {date}"))
}

/// Everything the app needs across command calls. The classifier isn't
/// kept here — it's cheap to retrain from `store.labeled_history()` on
/// demand (see `classifier.rs`), so keeping a stale copy around would just
/// be a bug waiting to happen.
pub struct AppState {
    pub store: Store,
    pub rules: RuleSet,
}

pub type AppStateHandle = Mutex<AppState>;

impl AppState {
    pub fn open(db_path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let store = Store::open(db_path).map_err(|e| e.to_string())?;
        let mut rules = store.load_rules().map_err(|e| e.to_string())?;
        if rules.is_empty() {
            rules = RuleSet::seeded();
        }
        Ok(AppState { store, rules })
    }
}

#[derive(Serialize)]
pub struct TransactionDto {
    pub id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category: Option<String>,
    pub category_source: Option<String>,
    pub confidence: Option<f64>,
    pub account_id: i64,
    pub account_name: String,
    pub applied_to_debt: Option<AppliedDebtPaymentDto>,
    pub split_count: i64,
    pub tags: Vec<String>,
}

#[derive(Serialize)]
pub struct AppliedDebtPaymentDto {
    pub debt_account_id: i64,
    pub debt_account_name: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct TransactionSplitDto {
    pub id: i64,
    pub category: Option<String>,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct AccountDto {
    pub id: i64,
    pub name: String,
    pub account_type: String,
    pub starting_balance: String,
    pub current_balance: String,
    pub institution: Option<String>,
    pub mask: Option<String>,
    pub interest_rate: Option<String>,
    pub excluded_from_debt_payoff: bool,
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub inserted: usize,
    pub row_errors: usize,
}

/// One parsed CSV row awaiting the user's review — every row is shown, not
/// just duplicates, so the user can pick which to include and which
/// account each belongs to before anything is written.
#[derive(Serialize)]
pub struct ImportRow {
    pub index: usize,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub is_duplicate: bool,
}

#[derive(Serialize)]
pub struct ImportPreview {
    pub rows: Vec<ImportRow>,
    pub row_errors: usize,
}

#[derive(Serialize)]
pub struct BucketDto {
    pub id: i64,
    pub name: String,
    pub target_amount: Option<String>,
    pub saved_amount: String,
    pub target_date: Option<String>,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
}

#[derive(Serialize)]
pub struct ReportBudgetLineDto {
    pub category: String,
    pub budget_group: String,
    pub budgeted: String,
    pub actual: String,
}

#[derive(Serialize)]
pub struct ReportDto {
    pub total_saved: String,
    pub income_total: String,
    pub month_label: String,
    pub budget_actuals: Vec<ReportBudgetLineDto>,
}

#[derive(Serialize)]
pub struct HoldingDto {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: String,
    pub price: String,
    pub cost_basis: String,
    pub asset_class: Option<String>,
    pub value: String,
    pub gain_loss: String,
}

#[derive(Serialize)]
pub struct RecurringDto {
    pub id: i64,
    pub merchant: String,
    pub category: Option<String>,
    pub amount: String,
    pub cadence: String,
    pub anchor_date: String,
    pub next_date: String,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
}

#[derive(Serialize)]
pub struct RecurringCandidateDto {
    pub merchant: String,
    pub category: Option<String>,
    pub amount: String,
    pub cadence: String,
    pub anchor_date: String,
    pub occurrence_count: usize,
}

#[derive(Serialize)]
pub struct Stats {
    pub total: usize,
    pub auto_categorized: usize,
    pub user_confirmed: usize,
    pub uncategorized: usize,
}

fn build_classifier(state: &AppState) -> Result<Classifier, String> {
    let history = state.store.labeled_history().map_err(|e| e.to_string())?;
    let examples: Vec<(&str, &str)> = history.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();
    Ok(Classifier::train(&examples))
}

/// Runs the categorizer over every transaction that doesn't have a category
/// yet, persisting whatever it decides. Shared by import and by anything
/// else that adds uncategorized rows.
/// Returns the ids of every row it actually assigned a category to, so
/// callers that need to show the user exactly what changed (see
/// `recategorize_uncategorized`) don't have to separately diff the ledger.
fn categorize_uncategorized(state: &mut AppState) -> Result<Vec<i64>, String> {
    let classifier = build_classifier(state)?;
    let all = state.store.all_transactions().map_err(|e| e.to_string())?;
    let mut categorized_ids = Vec::new();
    for stored in all {
        if stored.transaction.category.is_some() {
            continue;
        }
        if let Some((category, source, confidence)) =
            categorizer::categorize(&stored.transaction.description, &state.rules, Some(&classifier))
        {
            state
                .store
                .set_category(stored.id, &category, source, confidence)
                .map_err(|e| e.to_string())?;
            categorized_ids.push(stored.id);
        }
    }
    Ok(categorized_ids)
}

/// Re-runs categorization over whatever's still Uncategorized right now —
/// the manual "try again" for the ledger's "Categorize uncategorized"
/// button, using whatever rules/classifier training exist at this moment
/// (which may have improved since these rows were first imported, e.g.
/// after the user has corrected enough similar transactions by hand).
/// Returns the ids of the rows it categorized, so the UI can show the user
/// exactly those rows to review and correct.
#[tauri::command]
pub fn recategorize_uncategorized(state: tauri::State<AppStateHandle>) -> Result<Vec<i64>, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    categorize_uncategorized(&mut state)
}

/// Parses the file and flags which rows already exist in `account_id`
/// (the account picked before choosing the file) — every row is returned,
/// not just duplicates, so the review screen can show the whole import
/// and let the user decide, row by row, what to include and which
/// account it actually belongs to.
#[tauri::command]
pub fn preview_import(
    path: String,
    invert_amounts: bool,
    account_id: i64,
    state: tauri::State<AppStateHandle>,
) -> Result<ImportPreview, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let loaded = importer::load_transactions(&path, invert_amounts).map_err(|e| e.to_string())?;
    let row_errors = loaded.errors.len();
    let flags = state
        .store
        .check_duplicates(account_id, &loaded.transactions)
        .map_err(|e| e.to_string())?;

    let rows = loaded
        .transactions
        .iter()
        .zip(flags.iter())
        .enumerate()
        .map(|(index, (tx, is_duplicate))| ImportRow {
            index,
            date: tx.date.to_string(),
            description: tx.description.clone(),
            amount: tx.amount.to_string(),
            is_duplicate: *is_duplicate,
        })
        .collect();

    Ok(ImportPreview { rows, row_errors })
}

/// Inserts exactly the rows the user chose to keep on the review screen,
/// each into whichever account they assigned it to (defaulting to
/// `default_account_id`, the one picked before the file was chosen).
/// Unlike the old preview-time duplicate check, nothing here re-decides
/// what counts as a duplicate — the user already made that call by
/// checking or unchecking each row.
#[tauri::command]
pub fn commit_import(
    path: String,
    invert_amounts: bool,
    default_account_id: i64,
    included_indices: Vec<usize>,
    account_overrides: std::collections::HashMap<usize, i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<ImportSummary, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let loaded = importer::load_transactions(&path, invert_amounts).map_err(|e| e.to_string())?;
    let row_errors = loaded.errors.len();

    let included: std::collections::HashSet<usize> = included_indices.into_iter().collect();
    let mut by_account: std::collections::HashMap<i64, Vec<budget_core::models::Transaction>> =
        std::collections::HashMap::new();
    for (index, tx) in loaded.transactions.into_iter().enumerate() {
        if !included.contains(&index) {
            continue;
        }
        let account_id = account_overrides.get(&index).copied().unwrap_or(default_account_id);
        by_account.entry(account_id).or_default().push(tx);
    }

    let mut inserted = 0;
    for (account_id, txns) in by_account {
        let save_report = state.store.save_transactions(account_id, &txns).map_err(|e| e.to_string())?;
        inserted += save_report.inserted;
    }

    categorize_uncategorized(&mut state)?;

    Ok(ImportSummary { inserted, row_errors })
}

#[derive(Serialize)]
pub struct SetupAccountRowDto {
    pub index: usize,
    pub name: String,
    pub account_type: String,
    pub starting_balance: Option<String>,
    pub institution: Option<String>,
    pub mask: Option<String>,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupCategoryRowDto {
    pub index: usize,
    pub name: String,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupBudgetRowDto {
    pub index: usize,
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: String,
    pub period: Option<String>,
    pub will_update: bool,
}

#[derive(Serialize)]
pub struct SetupBucketRowDto {
    pub index: usize,
    pub name: String,
    pub target_amount: Option<String>,
    pub target_date: Option<String>,
    pub linked_account_name: Option<String>,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupImportPreviewDto {
    pub accounts: Vec<SetupAccountRowDto>,
    pub categories: Vec<SetupCategoryRowDto>,
    pub budgets: Vec<SetupBudgetRowDto>,
    pub buckets: Vec<SetupBucketRowDto>,
    pub row_errors: usize,
}

#[derive(Serialize)]
pub struct SetupImportSummaryDto {
    pub accounts_created: usize,
    pub categories_created: usize,
    pub budgets_set: usize,
    pub buckets_created: usize,
    pub skipped: Vec<String>,
    pub row_errors: usize,
}

fn current_month_key() -> String {
    use chrono::Datelike;
    let today = chrono::Local::now().date_naive();
    format!("{:04}-{:02}", today.year(), today.month())
}

/// Parses the setup template and flags what already exists — a pure read,
/// so the review screen can show what an import would do before anything
/// is written. Same convention as `preview_import`'s duplicate flags.
#[tauri::command]
pub fn preview_setup_import(
    path: String,
    state: tauri::State<AppStateHandle>,
) -> Result<SetupImportPreviewDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let data = budget_core::setup_import::load_setup_csv(&path).map_err(|e| e.to_string())?;

    let today = chrono::Local::now().date_naive();
    let existing_accounts = state.store.list_accounts(today).map_err(|e| e.to_string())?;
    let existing_categories = state.store.list_categories().map_err(|e| e.to_string())?;
    let existing_buckets = state.store.list_buckets().map_err(|e| e.to_string())?;
    let default_period = current_month_key();

    let accounts = data
        .accounts
        .iter()
        .enumerate()
        .map(|(index, row)| SetupAccountRowDto {
            index,
            name: row.name.clone(),
            account_type: row.account_type.clone(),
            starting_balance: row.starting_balance.map(|a| a.to_string()),
            institution: row.institution.clone(),
            mask: row.mask.clone(),
            already_exists: existing_accounts
                .iter()
                .any(|a| a.account.name.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    let categories = data
        .categories
        .iter()
        .enumerate()
        .map(|(index, row)| SetupCategoryRowDto {
            index,
            name: row.name.clone(),
            already_exists: existing_categories.iter().any(|c| c.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    let mut budgets = Vec::with_capacity(data.budgets.len());
    for (index, row) in data.budgets.iter().enumerate() {
        let period = row.period.clone().unwrap_or_else(|| default_period.clone());
        let existing_lines = state.store.list_budgets(&period).map_err(|e| e.to_string())?;
        budgets.push(SetupBudgetRowDto {
            index,
            category: row.category.clone(),
            budget_group: row.budget_group.clone(),
            monthly_amount: row.monthly_amount.to_string(),
            period: row.period.clone(),
            will_update: existing_lines.iter().any(|b| b.category.eq_ignore_ascii_case(&row.category)),
        });
    }

    let buckets = data
        .buckets
        .iter()
        .enumerate()
        .map(|(index, row)| SetupBucketRowDto {
            index,
            name: row.name.clone(),
            target_amount: row.target_amount.map(|a| a.to_string()),
            target_date: row.target_date.map(|d| d.to_string()),
            linked_account_name: row.linked_account_name.clone(),
            already_exists: existing_buckets.iter().any(|b| b.name.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    Ok(SetupImportPreviewDto {
        accounts,
        categories,
        budgets,
        buckets,
        row_errors: data.errors.len(),
    })
}

/// Applies exactly the rows the user kept checked on the review screen —
/// re-parsing the file rather than trusting client-echoed row data back,
/// same reasoning as `commit_import`.
#[tauri::command]
pub fn commit_setup_import(
    path: String,
    included_accounts: Vec<usize>,
    included_categories: Vec<usize>,
    included_budgets: Vec<usize>,
    included_buckets: Vec<usize>,
    state: tauri::State<AppStateHandle>,
) -> Result<SetupImportSummaryDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let mut data = budget_core::setup_import::load_setup_csv(&path).map_err(|e| e.to_string())?;
    let row_errors = data.errors.len();

    fn keep<T>(rows: Vec<T>, included: &[usize]) -> Vec<T> {
        let included: std::collections::HashSet<usize> = included.iter().copied().collect();
        rows.into_iter()
            .enumerate()
            .filter(|(i, _)| included.contains(i))
            .map(|(_, row)| row)
            .collect()
    }
    data.accounts = keep(data.accounts, &included_accounts);
    data.categories = keep(data.categories, &included_categories);
    data.budgets = keep(data.budgets, &included_budgets);
    data.buckets = keep(data.buckets, &included_buckets);

    let outcome = state
        .store
        .apply_setup_import(&data, &current_month_key())
        .map_err(|e| e.to_string())?;

    Ok(SetupImportSummaryDto {
        accounts_created: outcome.accounts_created,
        categories_created: outcome.categories_created,
        budgets_set: outcome.budgets_set,
        buckets_created: outcome.buckets_created,
        skipped: outcome.skipped,
        row_errors,
    })
}

#[tauri::command]
pub fn create_account(
    name: String,
    account_type: String,
    starting_balance: Option<String>,
    institution: Option<String>,
    mask: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    let id = state
        .store
        .get_or_create_account(&name, account_type)
        .map_err(|e| e.to_string())?;
    if let Some(balance) = starting_balance {
        let balance = parse_amount(&balance)?;
        state
            .store
            .set_account_starting_balance(id, balance)
            .map_err(|e| e.to_string())?;
    }
    if institution.is_some() || mask.is_some() {
        state
            .store
            .set_account_details(id, institution.as_deref(), mask.as_deref())
            .map_err(|e| e.to_string())?;
    }
    Ok(id)
}

#[tauri::command]
pub fn list_accounts(state: tauri::State<AppStateHandle>) -> Result<Vec<AccountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let accounts = state.store.list_accounts(today).map_err(|e| e.to_string())?;

    Ok(accounts
        .into_iter()
        .map(|a| AccountDto {
            id: a.id,
            name: a.account.name,
            account_type: a.account.account_type.as_str().to_string(),
            starting_balance: a.starting_balance.to_string(),
            current_balance: a.current_balance.to_string(),
            institution: a.institution,
            mask: a.mask,
            interest_rate: a.interest_rate.map(|r| r.to_string()),
            excluded_from_debt_payoff: a.excluded_from_debt_payoff,
        })
        .collect())
}

#[tauri::command]
pub fn set_account_interest_rate(
    id: i64,
    rate: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rate = rate.map(|r| parse_amount(&r)).transpose()?;
    state.store.set_account_interest_rate(id, rate).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_excluded_from_debt_payoff(
    id: i64,
    excluded: bool,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_account_excluded_from_debt_payoff(id, excluded).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_details(
    id: i64,
    institution: Option<String>,
    mask: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state
        .store
        .set_account_details(id, institution.as_deref(), mask.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_starting_balance(
    id: i64,
    balance: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let balance = parse_amount(&balance)?;
    state
        .store
        .set_account_starting_balance(id, balance)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_account_type(
    id: i64,
    account_type: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    state.store.update_account_type(id, account_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(id: i64, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_account(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_transactions(state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let stored = state.store.all_transactions().map_err(|e| e.to_string())?;

    Ok(stored
        .into_iter()
        .map(|s| TransactionDto {
            id: s.id,
            date: s.transaction.date.to_string(),
            description: s.transaction.description,
            amount: s.transaction.amount.to_string(),
            category: s.transaction.category,
            category_source: s.category_source.map(CategorySource::as_str).map(str::to_string),
            confidence: s.confidence,
            account_id: s.account_id,
            account_name: s.account_name,
            applied_to_debt: s.applied_to_debt.map(|d| AppliedDebtPaymentDto {
                debt_account_id: d.debt_account_id,
                debt_account_name: d.debt_account_name,
                amount: d.amount.to_string(),
            }),
            split_count: s.split_count,
            tags: s.tags,
        })
        .collect())
}

#[tauri::command]
pub fn add_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.add_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.remove_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_tags(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.list_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_transaction_splits(
    transaction_id: i64,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<TransactionSplitDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let splits = state.store.list_transaction_splits(transaction_id).map_err(|e| e.to_string())?;
    Ok(splits
        .into_iter()
        .map(|s| TransactionSplitDto {
            id: s.id,
            category: s.category,
            amount: s.amount.to_string(),
            note: s.note,
        })
        .collect())
}

#[tauri::command]
pub fn set_transaction_splits(
    transaction_id: i64,
    splits: Vec<(String, String, Option<String>)>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let splits = splits
        .into_iter()
        .map(|(category, amount, note)| Ok((category, parse_amount(&amount)?, note)))
        .collect::<Result<Vec<_>, String>>()?;
    state.store.set_transaction_splits(transaction_id, &splits).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn correct_category(
    id: i64,
    category: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let description = state
        .store
        .all_transactions()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .map(|t| t.transaction.description)
        .ok_or_else(|| format!("no transaction with id {id}"))?;

    state
        .store
        .set_category(id, &category, CategorySource::User, None)
        .map_err(|e| e.to_string())?;

    // teach the rule engine — and persist the rule so it survives a restart
    learner::learn_from_correction(&mut state.rules, &description, &category);
    state
        .store
        .upsert_rule(description.trim(), &category)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Same as `correct_category`, applied to every id in one call — used by
/// the ledger's multi-select bulk-edit action so N selected rows cost one
/// round trip instead of N. Each transaction still teaches the rule
/// learner from its own description, same as if you'd corrected it one
/// at a time; an id that no longer exists is skipped rather than erroring,
/// same "harmless no-op" convention as the rest of this file.
#[tauri::command]
pub fn bulk_correct_category(
    ids: Vec<i64>,
    category: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let transactions = state.store.all_transactions().map_err(|e| e.to_string())?;
    for id in ids {
        let Some(description) = transactions
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.transaction.description.clone())
        else {
            continue;
        };

        state
            .store
            .set_category(id, &category, CategorySource::User, None)
            .map_err(|e| e.to_string())?;

        learner::learn_from_correction(&mut state.rules, &description, &category);
        state
            .store
            .upsert_rule(description.trim(), &category)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Same as `delete_transaction`, applied to every id in one call — used by
/// the ledger's multi-select bulk-delete action.
#[tauri::command]
pub fn bulk_delete_transactions(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    for id in ids {
        state.store.delete_transaction(id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Re-reads persisted rules into `state.rules` — needed after any command
/// that edits the `rules` table directly in the store (rename/delete
/// category), so the in-memory rule set categorization actually uses stays
/// in sync without requiring an app restart.
fn reload_rules(state: &mut AppState) -> Result<(), String> {
    let mut rules = state.store.load_rules().map_err(|e| e.to_string())?;
    if rules.is_empty() {
        rules = RuleSet::seeded();
    }
    state.rules = rules;
    Ok(())
}

#[tauri::command]
pub fn list_categories(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.list_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_category(name: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.create_category(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_category(
    old_name: String,
    new_name: String,
    state: tauri::State<AppStateHandle>,
) -> Result<usize, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let affected = state
        .store
        .rename_category(&old_name, &new_name)
        .map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}

#[tauri::command]
pub fn delete_category(name: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let affected = state.store.delete_category(&name).map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}

#[tauri::command]
pub fn update_transaction_amount(
    id: i64,
    amount: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .update_transaction_amount(id, amount)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_account(
    id: i64,
    account_id: i64,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state
        .store
        .update_transaction_account(id, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_transaction(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_transaction(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_debt_payment(
    source_transaction_id: i64,
    debt_account_id: i64,
    amount: String,
    date: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let date = parse_date(&date)?;
    state
        .store
        .apply_debt_payment(source_transaction_id, debt_account_id, amount, date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unapply_debt_payment(source_transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.unapply_debt_payment(source_transaction_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_bucket(
    name: String,
    target_amount: Option<String>,
    target_date: Option<String>,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let target_amount = target_amount.map(|a| parse_amount(&a)).transpose()?;
    let target_date = target_date.map(|d| parse_date(&d)).transpose()?;
    state
        .store
        .create_bucket(&name, target_amount, target_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_buckets(state: tauri::State<AppStateHandle>) -> Result<Vec<BucketDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let buckets = state.store.list_buckets().map_err(|e| e.to_string())?;
    Ok(buckets
        .into_iter()
        .map(|b| BucketDto {
            id: b.id,
            name: b.name,
            target_amount: b.target_amount.map(|a| a.to_string()),
            saved_amount: b.saved_amount.to_string(),
            target_date: b.target_date.map(|d| d.to_string()),
            account_id: b.account_id,
            account_name: b.account_name,
        })
        .collect())
}

#[tauri::command]
pub fn update_bucket_details(
    id: i64,
    target_amount: Option<String>,
    target_date: Option<String>,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let target_amount = target_amount.map(|a| parse_amount(&a)).transpose()?;
    let target_date = target_date.map(|d| parse_date(&d)).transpose()?;
    state
        .store
        .update_bucket_details(id, target_amount, target_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bucket_contribution(
    bucket_id: i64,
    date: String,
    amount: String,
    note: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&date)?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .add_bucket_contribution(bucket_id, date, amount, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bucket(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_bucket(id).map_err(|e| e.to_string())
}

/// `period` ("YYYY-MM") scopes the change to that one month only — see
/// `Store::set_budget`. The frontend gets a category's budgeted amount
/// for a specific month from `budget_actuals_for_month`/`get_report`
/// (both already period-scoped), so there's no separate un-scoped
/// "list all budgets" command any more — that was the shape of the bug
/// this fixes (one global row per category shared by every month).
#[tauri::command]
pub fn set_budget(
    category: String,
    period: String,
    monthly_amount: String,
    budget_group: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let monthly_amount = parse_amount(&monthly_amount)?;
    state
        .store
        .set_budget(&category, &period, monthly_amount, &budget_group)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_budget(category: String, period: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_budget(&category, &period).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report(state: tauri::State<AppStateHandle>) -> Result<ReportDto, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let (year, month) = (today.year(), today.month());

    let total_saved = state.store.total_saved().map_err(|e| e.to_string())?;
    let income_total = state.store.income_total().map_err(|e| e.to_string())?;
    let budget_actuals = state
        .store
        .monthly_budget_actuals(year, month)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|a| ReportBudgetLineDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
        })
        .collect();

    Ok(ReportDto {
        total_saved: total_saved.to_string(),
        income_total: income_total.to_string(),
        month_label: today.format("%B %Y").to_string(),
        budget_actuals,
    })
}

/// Budget-vs-actual for an arbitrary month, for the Budget page's
/// prev/next month navigation — `get_report` above is deliberately
/// pinned to the current month for the Reports dashboard.
#[tauri::command]
pub fn budget_actuals_for_month(
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<ReportBudgetLineDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let actuals = state
        .store
        .monthly_budget_actuals(year, month)
        .map_err(|e| e.to_string())?;
    Ok(actuals
        .into_iter()
        .map(|a| ReportBudgetLineDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct CategoryTransactionDto {
    pub transaction_id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub account_name: String,
    pub is_split: bool,
    pub split_note: Option<String>,
}

/// Line items behind one Budget page row — clicking a category (e.g.
/// "Utilities") shows every transaction (or split line) that counted
/// toward that category's "actual" for the month being viewed.
#[tauri::command]
pub fn transactions_for_category(
    category: String,
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<CategoryTransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let items = state
        .store
        .transactions_for_category_in_month(&category, year, month)
        .map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|t| CategoryTransactionDto {
            transaction_id: t.transaction_id,
            date: t.date.to_string(),
            description: t.description,
            amount: t.amount.to_string(),
            account_name: t.account_name,
            is_split: t.is_split,
            split_note: t.split_note,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BudgetAlertDto {
    pub category: String,
    pub budget_group: String,
    pub budgeted: String,
    pub actual: String,
    pub pct: String,
    pub level: String,
}

#[tauri::command]
pub fn budget_alerts_for_month(
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<BudgetAlertDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let alerts = state.store.budget_alerts_for_month(year, month).map_err(|e| e.to_string())?;
    Ok(alerts
        .into_iter()
        .map(|a| BudgetAlertDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
            pct: a.pct.to_string(),
            level: a.level,
        })
        .collect())
}

#[derive(Serialize)]
pub struct InsightDto {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

#[tauri::command]
pub fn dashboard_insights(state: tauri::State<AppStateHandle>) -> Result<Vec<InsightDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let insights = state.store.dashboard_insights(today).map_err(|e| e.to_string())?;
    Ok(insights
        .into_iter()
        .map(|i| InsightDto {
            severity: i.severity,
            kind: i.kind,
            message: i.message,
        })
        .collect())
}

#[derive(Deserialize)]
pub struct MinimumPaymentInput {
    pub account_id: i64,
    pub minimum_payment: String,
}

#[derive(Serialize)]
pub struct DebtPayoffLineDto {
    pub account_id: i64,
    pub account_name: String,
    pub starting_balance: String,
    pub payoff_date: Option<String>,
    pub total_interest_paid: String,
}

#[derive(Serialize)]
pub struct DebtPayoffPlanDto {
    pub per_account: Vec<DebtPayoffLineDto>,
    pub total_months: Option<u32>,
    pub total_interest_paid: String,
}

#[tauri::command]
pub fn debt_payoff_projection(
    strategy: String,
    extra_payment: String,
    minimums: Vec<MinimumPaymentInput>,
    state: tauri::State<AppStateHandle>,
) -> Result<DebtPayoffPlanDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let extra_payment = parse_amount(&extra_payment)?;
    let mut minimum_payments = Vec::with_capacity(minimums.len());
    for m in minimums {
        minimum_payments.push((m.account_id, parse_amount(&m.minimum_payment)?));
    }
    let today = chrono::Local::now().date_naive();
    let plan = state
        .store
        .debt_payoff_projection(&strategy, extra_payment, &minimum_payments, today)
        .map_err(|e| e.to_string())?;
    Ok(DebtPayoffPlanDto {
        per_account: plan
            .per_account
            .into_iter()
            .map(|l| DebtPayoffLineDto {
                account_id: l.account_id,
                account_name: l.account_name,
                starting_balance: l.starting_balance.to_string(),
                payoff_date: l.payoff_date.map(|d| d.to_string()),
                total_interest_paid: l.total_interest_paid.to_string(),
            })
            .collect(),
        total_months: plan.total_months,
        total_interest_paid: plan.total_interest_paid.to_string(),
    })
}

#[derive(Serialize)]
pub struct AnomalyFlagDto {
    pub transaction_id: i64,
    pub kind: String,
    pub detail: String,
}

#[tauri::command]
pub fn list_anomaly_flags(state: tauri::State<AppStateHandle>) -> Result<Vec<AnomalyFlagDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let flags = state.store.anomaly_flags().map_err(|e| e.to_string())?;
    Ok(flags
        .into_iter()
        .map(|f| AnomalyFlagDto {
            transaction_id: f.transaction_id,
            kind: f.kind,
            detail: f.detail,
        })
        .collect())
}

#[tauri::command]
pub fn get_stats(state: tauri::State<AppStateHandle>) -> Result<Stats, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let all = state.store.all_transactions().map_err(|e| e.to_string())?;

    let mut stats = Stats {
        total: all.len(),
        auto_categorized: 0,
        user_confirmed: 0,
        uncategorized: 0,
    };
    for t in &all {
        match t.category_source {
            Some(CategorySource::User) => stats.user_confirmed += 1,
            Some(CategorySource::Rule) | Some(CategorySource::Classifier) => stats.auto_categorized += 1,
            None => stats.uncategorized += 1,
        }
    }
    Ok(stats)
}

#[tauri::command]
pub fn create_recurring(
    merchant: String,
    category: Option<String>,
    amount: String,
    cadence: String,
    anchor_date: String,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    state
        .store
        .create_recurring(&merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recurring(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let items = state.store.list_recurring(today).map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|r| RecurringDto {
            id: r.id,
            merchant: r.merchant,
            category: r.category,
            amount: r.amount.to_string(),
            cadence: r.cadence,
            anchor_date: r.anchor_date.to_string(),
            next_date: r.next_date.to_string(),
            account_id: r.account_id,
            account_name: r.account_name,
        })
        .collect())
}

#[tauri::command]
pub fn delete_recurring(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_recurring(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_recurring(
    id: i64,
    merchant: String,
    category: Option<String>,
    amount: String,
    cadence: String,
    anchor_date: String,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    state
        .store
        .update_recurring(id, &merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recurring_candidates(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringCandidateDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let candidates = state.store.detect_recurring_candidates(today).map_err(|e| e.to_string())?;
    Ok(candidates
        .into_iter()
        .map(|c| RecurringCandidateDto {
            merchant: c.merchant,
            category: c.category,
            amount: c.amount.to_string(),
            cadence: c.cadence,
            anchor_date: c.anchor_date.to_string(),
            occurrence_count: c.occurrence_count,
        })
        .collect())
}

#[tauri::command]
pub fn dismiss_recurring_candidate(
    merchant: String,
    amount: String,
    cadence: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .dismiss_recurring_candidate(&merchant, amount, &cadence)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_holding(
    account_id: i64,
    symbol: String,
    name: String,
    shares: String,
    price: String,
    cost_basis: String,
    asset_class: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let shares = parse_amount(&shares)?;
    let price = parse_amount(&price)?;
    let cost_basis = parse_amount(&cost_basis)?;
    state
        .store
        .create_holding(account_id, &symbol, &name, shares, price, cost_basis, asset_class.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_holdings(state: tauri::State<AppStateHandle>) -> Result<Vec<HoldingDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let holdings = state.store.list_holdings().map_err(|e| e.to_string())?;
    Ok(holdings
        .into_iter()
        .map(|h| HoldingDto {
            id: h.id,
            account_id: h.account_id,
            account_name: h.account_name,
            symbol: h.symbol,
            name: h.name,
            shares: h.shares.to_string(),
            price: h.price.to_string(),
            cost_basis: h.cost_basis.to_string(),
            asset_class: h.asset_class,
            value: h.value.to_string(),
            gain_loss: h.gain_loss.to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn update_holding_price(id: i64, price: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let price = parse_amount(&price)?;
    state.store.update_holding_price(id, price).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_holding(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_holding(id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AssetDto {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: String,
    pub valued_on: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn create_asset(
    name: String,
    asset_type: String,
    value: String,
    valued_on: String,
    notes: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let value = parse_amount(&value)?;
    let valued_on = parse_date(&valued_on)?;
    state
        .store
        .create_asset(&name, &asset_type, value, valued_on, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_assets(state: tauri::State<AppStateHandle>) -> Result<Vec<AssetDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let assets = state.store.list_assets().map_err(|e| e.to_string())?;
    Ok(assets
        .into_iter()
        .map(|a| AssetDto {
            id: a.id,
            name: a.name,
            asset_type: a.asset_type,
            value: a.value.to_string(),
            valued_on: a.valued_on.to_string(),
            notes: a.notes,
        })
        .collect())
}

#[tauri::command]
pub fn update_asset_value(
    id: i64,
    value: String,
    valued_on: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let value = parse_amount(&value)?;
    let valued_on = parse_date(&valued_on)?;
    state.store.update_asset_value(id, value, valued_on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_asset(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_asset(id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct MonthTotalDto {
    pub month_label: String,
    pub year: i32,
    pub month: u32,
    pub income: String,
    pub expense: String,
}

#[derive(Serialize)]
pub struct CategoryAmountDto {
    pub category: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct MerchantAmountDto {
    pub description: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct CashFlowDto {
    pub months: Vec<MonthTotalDto>,
    pub top_categories: Vec<CategoryAmountDto>,
    pub top_merchants: Vec<MerchantAmountDto>,
    pub total_income: String,
    pub total_expense: String,
}

/// Bundles everything the Cash Flow page needs for a trailing window of
/// `months` months (including the current one) into one round-trip, same
/// reasoning as `get_report`.
#[tauri::command]
pub fn get_cash_flow(months: u32, state: tauri::State<AppStateHandle>) -> Result<CashFlowDto, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();

    let mut year_months = Vec::with_capacity(months as usize);
    let (mut y, mut m) = (today.year(), today.month());
    for _ in 0..months {
        year_months.push((y, m));
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    year_months.reverse();

    let mut month_totals = Vec::with_capacity(year_months.len());
    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    for (year, month) in &year_months {
        let (income, expense) = state.store.monthly_totals(*year, *month).map_err(|e| e.to_string())?;
        total_income += income;
        total_expense += expense;
        let label = chrono::NaiveDate::from_ymd_opt(*year, *month, 1)
            .expect("a year/month this loop generated must be valid")
            .format("%b")
            .to_string();
        month_totals.push(MonthTotalDto {
            month_label: label,
            year: *year,
            month: *month,
            income: income.to_string(),
            expense: expense.to_string(),
        });
    }

    let (start_year, start_month) = year_months[0];
    let start_date = chrono::NaiveDate::from_ymd_opt(start_year, start_month, 1)
        .expect("the first generated year/month must be valid");

    let top_categories = state
        .store
        .spending_by_category(start_date, today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .take(6)
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect();
    let top_merchants = state
        .store
        .top_merchants(start_date, today, 8)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(description, amount)| MerchantAmountDto {
            description,
            amount: amount.to_string(),
        })
        .collect();

    Ok(CashFlowDto {
        months: month_totals,
        top_categories,
        top_merchants,
        total_income: total_income.to_string(),
        total_expense: total_expense.to_string(),
    })
}

/// Every (year, month) from `from` through `to` inclusive, ascending. The
/// 1200-month (100-year) cap is just a safety valve against an accidentally
/// reversed or nonsensical range looping forever, not a real limit anyone
/// would hit.
fn month_range(from_year: i32, from_month: u32, to_year: i32, to_month: u32) -> Vec<(i32, u32)> {
    let mut year_months = Vec::new();
    let (mut y, mut m) = (from_year, from_month);
    loop {
        year_months.push((y, m));
        if (y, m) == (to_year, to_month) || year_months.len() > 1200 {
            break;
        }
        if m == 12 {
            m = 1;
            y += 1;
        } else {
            m += 1;
        }
    }
    year_months
}

fn month_totals_for_range(
    store: &Store,
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    label_format: &str,
) -> Result<Vec<MonthTotalDto>, String> {
    let mut result = Vec::new();
    for (year, month) in month_range(from_year, from_month, to_year, to_month) {
        let (income, expense) = store.monthly_totals(year, month).map_err(|e| e.to_string())?;
        let label = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .expect("a year/month this loop generated must be valid")
            .format(label_format)
            .to_string();
        result.push(MonthTotalDto {
            month_label: label,
            year,
            month,
            income: income.to_string(),
            expense: expense.to_string(),
        });
    }
    Ok(result)
}

/// Cash flow for an explicit `[from, to]` month range instead of a fixed
/// trailing window — powers the Cash Flow page's custom date-range
/// picker. `get_cash_flow` (trailing-window) is unchanged and still used
/// for the page's default view.
#[tauri::command]
pub fn cash_flow_for_range(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<CashFlowDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let month_totals = month_totals_for_range(&state.store, from_year, from_month, to_year, to_month, "%b '%y")?;

    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    for line in &month_totals {
        total_income += Decimal::from_str(&line.income).map_err(|_| "invalid income total".to_string())?;
        total_expense += Decimal::from_str(&line.expense).map_err(|_| "invalid expense total".to_string())?;
    }

    let start_date = chrono::NaiveDate::from_ymd_opt(from_year, from_month, 1)
        .ok_or_else(|| format!("invalid start month: {from_year:04}-{from_month:02}"))?;
    let end_date = last_day_of_month(to_year, to_month);

    let top_categories = state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .take(6)
        .map(|(category, amount)| CategoryAmountDto { category, amount: amount.to_string() })
        .collect();
    let top_merchants = state
        .store
        .top_merchants(start_date, end_date, 8)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(description, amount)| MerchantAmountDto { description, amount: amount.to_string() })
        .collect();

    Ok(CashFlowDto {
        months: month_totals,
        top_categories,
        top_merchants,
        total_income: total_income.to_string(),
        total_expense: total_expense.to_string(),
    })
}

/// Every category's spend for one month, uncapped — unlike `top_categories`
/// on `CashFlowDto`, which caps at 6 for the summary cards. Powers the
/// "Top categories" card's month-over-month trend: a category in the
/// *current* month's top 6 still needs an accurate prior-month figure
/// even if that category wouldn't itself have made the prior month's
/// top-6 cut.
#[tauri::command]
pub fn category_spending_for_month(
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<CategoryAmountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let start_date = chrono::NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| format!("invalid month: {year:04}-{month:02}"))?;
    let end_date = last_day_of_month(year, month);
    Ok(state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto { category, amount: amount.to_string() })
        .collect())
}

#[derive(Serialize)]
pub struct LargeExpenseDto {
    pub transaction_id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category: Option<String>,
    pub detail: String,
}

#[derive(Serialize)]
pub struct MonthExpenseDetailDto {
    pub month_label: String,
    pub categories: Vec<CategoryAmountDto>,
    pub large_expenses: Vec<LargeExpenseDto>,
}

/// Drill-down for one bar of the cash-flow chart: where that month's
/// expenses went by category, plus any unusually large charges that
/// occurred (see `Store::large_expenses_in_range`) — clicking a bar opens
/// this to answer "what drove this month's number."
#[tauri::command]
pub fn month_expense_detail(
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<MonthExpenseDetailDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let start_date = chrono::NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| format!("invalid month: {year:04}-{month:02}"))?;
    let end_date = last_day_of_month(year, month);

    let categories = state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto { category, amount: amount.to_string() })
        .collect();

    let large_expenses = state
        .store
        .large_expenses_in_range(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| LargeExpenseDto {
            transaction_id: e.transaction_id,
            date: e.date.to_string(),
            description: e.description,
            amount: e.amount.to_string(),
            category: e.category,
            detail: e.detail,
        })
        .collect();

    let month_label = start_date.format("%B %Y").to_string();

    Ok(MonthExpenseDetailDto { month_label, categories, large_expenses })
}

#[derive(Serialize)]
pub struct YoyCashFlowDto {
    pub current: Vec<MonthTotalDto>,
    pub prior_year: Vec<MonthTotalDto>,
}

/// The same `[from, to]` month range paired month-by-month against the
/// identical range exactly one year earlier — a month with no prior-year
/// data just comes back as zeros (`monthly_totals` sums an empty match
/// set to zero, no special-casing needed), not an error.
#[tauri::command]
pub fn year_over_year_cash_flow(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<YoyCashFlowDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let current = month_totals_for_range(&state.store, from_year, from_month, to_year, to_month, "%b")?;
    let prior_year =
        month_totals_for_range(&state.store, from_year - 1, from_month, to_year - 1, to_month, "%b")?;
    Ok(YoyCashFlowDto { current, prior_year })
}

#[derive(Serialize)]
pub struct ForecastPointDto {
    pub date: String,
    pub balance: String,
}

#[tauri::command]
pub fn cash_flow_forecast(days: i64, state: tauri::State<AppStateHandle>) -> Result<Vec<ForecastPointDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let points = state.store.cash_flow_forecast(today, days).map_err(|e| e.to_string())?;
    Ok(points
        .into_iter()
        .map(|p| ForecastPointDto {
            date: p.date.to_string(),
            balance: p.balance.to_string(),
        })
        .collect())
}

fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .expect("a valid next month always exists for a valid year/month")
        .pred_opt()
        .expect("the day before the 1st always exists")
}

#[derive(Serialize)]
pub struct NetWorthPointDto {
    pub month_label: String,
    pub value: String,
}

/// Net worth for each of the trailing `months` months (including the
/// current one) — past months are valued as of their last day, the
/// current month as of today, matching how a real net-worth trend should
/// read (not "as of the end of a month that hasn't happened yet").
#[tauri::command]
pub fn net_worth_history(months: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<NetWorthPointDto>, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();

    let mut year_months = Vec::with_capacity(months as usize);
    let (mut y, mut m) = (today.year(), today.month());
    for _ in 0..months {
        year_months.push((y, m));
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    year_months.reverse();

    let last_index = year_months.len().saturating_sub(1);
    let mut points = Vec::with_capacity(year_months.len());
    for (i, (year, month)) in year_months.into_iter().enumerate() {
        let as_of = if i == last_index { today } else { last_day_of_month(year, month) };
        let value = state.store.net_worth_as_of(as_of).map_err(|e| e.to_string())?;
        let label = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .expect("a year/month this loop generated must be valid")
            .format("%b")
            .to_string();
        points.push(NetWorthPointDto { month_label: label, value: value.to_string() });
    }
    Ok(points)
}

/// Spending by category for the current calendar month only — feeds the
/// Dashboard's spending donut, distinct from Cash Flow's multi-month
/// range version.
#[tauri::command]
pub fn spending_this_month(state: tauri::State<AppStateHandle>) -> Result<Vec<CategoryAmountDto>, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let start_of_month = chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .expect("the 1st of the current month must be valid");

    Ok(state
        .store
        .spending_by_category(start_of_month, today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct RolledAccountDto {
    pub account_id: i64,
    pub account_name: String,
    pub new_balance: String,
}

/// Rolls every account's balance forward into a fresh monthly reset if
/// this is the first time it's happened this calendar month (see
/// `Store::roll_forward_monthly_balances`) — safe to call on every app
/// launch. Returns only the accounts that just got a *fresh* reset in
/// this call, so the UI can show a one-time "here's what changed" note
/// instead of nagging every time the app opens.
#[tauri::command]
pub fn check_monthly_rollover(state: tauri::State<AppStateHandle>) -> Result<Vec<RolledAccountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let rolled = state.store.roll_forward_monthly_balances(today).map_err(|e| e.to_string())?;
    Ok(rolled
        .into_iter()
        .map(|(account_id, account_name, new_balance)| RolledAccountDto {
            account_id,
            account_name,
            new_balance: new_balance.to_string(),
        })
        .collect())
}
