mod commands;

use commands::{AppState, AppStateHandle};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Identifier (tauri.conf.json) and this filename were renamed
            // from "com.joeyf.meadow" / "meadow.db" to "com.joeyf.pennywise"
            // / "pennywise.db" alongside the Meadow -> Penny Wise rebrand,
            // and again to "com.joeyf.pennyworth" / "pennyworth.db"
            // alongside the Penny Wise -> Penny Worth rebrand. Each time, the
            // pre-existing database was copied by hand from the old AppData
            // folder into the new one at rename time — this does not
            // auto-migrate on its own.
            //
            // PENNYWORTH_DB_DIR lets E2E tests (see e2e/) point the app at a
            // throwaway directory instead of the real AppData folder, so
            // automated UI testing never touches the user's real data.
            // Unset in every normal launch, so real usage is unaffected.
            let data_dir = match std::env::var_os("PENNYWORTH_DB_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("pennyworth.db");

            let state = AppState::open(&db_path).map_err(std::io::Error::other)?;
            app.manage::<AppStateHandle>(Mutex::new(state));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::write_text_file,
            commands::preview_setup_import,
            commands::commit_setup_import,
            commands::preview_import,
            commands::commit_import,
            commands::list_transactions,
            commands::correct_category,
            commands::bulk_correct_category,
            commands::bulk_delete_transactions,
            commands::get_stats,
            commands::create_account,
            commands::list_accounts,
            commands::set_account_starting_balance,
            commands::update_account_type,
            commands::delete_account,
            commands::set_account_details,
            commands::recategorize_uncategorized,
            commands::list_categories,
            commands::create_category,
            commands::rename_category,
            commands::delete_category,
            commands::update_transaction_amount,
            commands::update_transaction_account,
            commands::delete_transaction,
            commands::apply_debt_payment,
            commands::unapply_debt_payment,
            commands::get_transaction_splits,
            commands::set_transaction_splits,
            commands::add_tag,
            commands::remove_tag,
            commands::list_all_tags,
            commands::create_bucket,
            commands::list_buckets,
            commands::update_bucket_details,
            commands::add_bucket_contribution,
            commands::delete_bucket,
            commands::set_budget,
            commands::delete_budget,
            commands::get_report,
            commands::budget_actuals_for_month,
            commands::transactions_for_category,
            commands::budget_alerts_for_month,
            commands::list_anomaly_flags,
            commands::create_recurring,
            commands::list_recurring,
            commands::delete_recurring,
            commands::create_holding,
            commands::list_holdings,
            commands::update_holding_price,
            commands::delete_holding,
            commands::get_cash_flow,
            commands::cash_flow_for_range,
            commands::category_spending_for_month,
            commands::month_expense_detail,
            commands::year_over_year_cash_flow,
            commands::net_worth_history,
            commands::spending_this_month,
            commands::check_monthly_rollover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
