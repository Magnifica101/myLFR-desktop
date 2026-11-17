pub mod backup;
pub mod catalogue;
pub mod crash_cause;
#[cfg(windows)]
mod crash_handler;
pub mod db;
pub mod diagnostics;
pub mod error;
pub mod models;
pub mod reminder;
pub mod session;
pub mod updates;
pub mod validation;

#[cfg(test)]
mod tests;

#[cfg(feature = "desktop")]
mod commands;

#[cfg(all(feature = "desktop", windows))]
mod webview_failures;

#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::Manager;

    let seed = catalogue::parse_seed(include_str!("../resources/fishstock-catalogue.json"))
        .expect("bundled fishstock catalogue must be valid");
    let state_seed = seed.clone();

    #[cfg(windows)]
    crash_cause::keep_windows_crash_records();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let data_directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_directory)?;
            crate::diagnostics::init(data_directory.join("diagnostics.log"));
            crate::session::begin(&data_directory.join("sessions"), env!("CARGO_PKG_VERSION"));
            #[cfg(debug_assertions)]
            crate::session::crash_for_testing_if_asked();
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| webview_failures::watch(&webview.controller()))?;
            }
            let database = db::Database::open(data_directory.join("mylfr.sqlite3"), &state_seed)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(commands::AppState::new(database, state_seed.clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_business_profile,
            commands::save_business_profile,
            commands::get_business_logo,
            commands::set_business_logo,
            commands::clear_business_logo,
            commands::get_notice_acknowledgement,
            commands::acknowledge_notice,
            commands::get_fishing_year_start_month,
            commands::set_fishing_year_start_month,
            commands::list_fishers,
            commands::get_fisher,
            commands::upsert_fisher,
            commands::set_fisher_archived,
            commands::remove_fisher,
            commands::list_vessels,
            commands::get_vessel,
            commands::find_vessel_by_number,
            commands::upsert_vessel,
            commands::remove_vessel,
            commands::search_fishstocks,
            commands::list_favorite_fishstocks,
            commands::set_fishstock_favorite,
            commands::list_user_fishstocks,
            commands::add_user_fishstock,
            commands::update_user_fishstock,
            commands::remove_user_fishstock,
            commands::list_landings,
            commands::list_landing_years,
            commands::list_previous_landing_fishstocks,
            commands::get_landing,
            commands::save_landing,
            commands::delete_landing,
            commands::list_landing_revisions,
            commands::get_landing_revision,
            commands::list_deleted_landings,
            commands::dashboard_metrics,
            commands::landing_report,
            commands::full_export,
            commands::get_backup_status,
            commands::choose_backup_directory,
            commands::open_backup_folder,
            commands::backup_now,
            commands::select_backup_for_restore,
            commands::restore_backup,
            commands::get_app_info,
            commands::open_approved_external_link,
            commands::begin_app_update_check,
            commands::get_update_status,
            commands::set_app_update_mode,
            commands::dismiss_update_reminder,
            commands::check_app_update,
            commands::install_app_update,
            commands::save_export_file,
            commands::export_diagnostics,
            commands::diagnostics_report,
            commands::open_issue_tracker,
        ])
        .build(tauri::generate_context!())
        .expect("error while running myLFR Desktop")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                crate::session::end();
            }
        });
}
