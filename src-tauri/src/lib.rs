mod backups;
mod commands;
mod config;
mod live_prices;
mod profiles;
mod updater;

use commands::{AppState, AppStateHandle};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            // automated UI testing never touches the user's real data —
            // this substitutes for the *whole* notion of "default
            // location" (including where config.json lives), not just the
            // final db_path, so a test that relocates/restores never
            // touches the real AppData folder's config.json either. Unset
            // in every normal launch, so real usage is unaffected.
            //
            // The default directory is where config.json lives (the one
            // fixed, discoverable location) even after the user relocates
            // their actual database elsewhere via the Reports tab's
            // Settings section — see config::resolve_db_path.
            let default_dir = match std::env::var_os("PENNYWORTH_DB_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&default_dir)?;
            let config_path = default_dir.join("config.json");
            let db_path = config::resolve_db_path(&config_path, &default_dir);

            let state = AppState::open(&db_path).map_err(std::io::Error::other)?;

            // A failed automatic backup (disk full, permissions, ...)
            // must never block the user from opening the app — logged,
            // not propagated with `?`.
            let backups_dir = backups::backups_dir_for(&db_path);
            if let Err(e) = backups::create_backup_if_due(&state.store, &backups_dir, chrono::Local::now().naive_local()) {
                eprintln!("automatic backup failed (continuing anyway): {e}");
            }

            app.manage::<AppStateHandle>(Mutex::new(state));
            app.manage(config::AppPaths { config_path, db_path: Mutex::new(db_path) });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::write_text_file,
            commands::download_update_asset,
            commands::get_data_file_location,
            commands::relocate_data_file,
            commands::list_backups,
            commands::create_backup_now,
            commands::restore_backup,
            commands::list_profiles,
            commands::create_profile,
            commands::switch_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::preview_setup_import,
            commands::commit_setup_import,
            commands::preview_import,
            commands::commit_import,
            commands::list_transactions,
            commands::correct_category,
            commands::bulk_correct_category,
            commands::bulk_delete_transactions,
            commands::bulk_create_recurring_from_transactions,
            commands::get_stats,
            commands::create_account,
            commands::list_accounts,
            commands::set_account_starting_balance,
            commands::set_account_interest_rate,
            commands::set_account_excluded_from_debt_payoff,
            commands::update_account_type,
            commands::delete_account,
            commands::set_account_details,
            commands::set_account_member,
            commands::create_family_member,
            commands::list_family_members,
            commands::rename_family_member,
            commands::delete_family_member,
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
            commands::set_transaction_member,
            commands::bulk_set_transaction_member,
            commands::create_bucket,
            commands::list_buckets,
            commands::update_bucket_details,
            commands::set_bucket_member,
            commands::add_bucket_contribution,
            commands::delete_bucket,
            commands::set_budget,
            commands::delete_budget,
            commands::get_report,
            commands::budget_actuals_for_month,
            commands::transactions_for_category,
            commands::budget_alerts_for_month,
            commands::dashboard_insights,
            commands::debt_payoff_projection,
            commands::list_anomaly_flags,
            commands::create_recurring,
            commands::update_recurring,
            commands::set_recurring_member,
            commands::list_recurring,
            commands::delete_recurring,
            commands::list_recurring_candidates,
            commands::dismiss_recurring_candidate,
            commands::create_holding,
            commands::list_holdings,
            commands::update_holding_price,
            commands::delete_holding,
            commands::get_live_price_settings,
            commands::set_live_price_api_key,
            commands::fetch_live_quote,
            commands::refresh_live_prices,
            commands::create_asset,
            commands::list_assets,
            commands::update_asset_value,
            commands::set_asset_member,
            commands::delete_asset,
            commands::get_cash_flow,
            commands::cash_flow_for_range,
            commands::category_spending_for_month,
            commands::month_expense_detail,
            commands::year_over_year_cash_flow,
            commands::cash_flow_forecast,
            commands::net_worth_history,
            commands::spending_this_month,
            commands::check_monthly_rollover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
