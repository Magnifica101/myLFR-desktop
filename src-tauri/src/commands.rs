#![cfg(feature = "desktop")]

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::Utc;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::backup;
use crate::db::Database;
use crate::error::{AppError, CommandError, CommandResult};
use crate::models::*;
use crate::updates;

pub struct AppState {
    pub database: Mutex<Database>,
    pub seed: CatalogueDocument,
    pending_restore: Mutex<Option<PendingRestore>>,
}

impl AppState {
    pub fn new(database: Database, seed: CatalogueDocument) -> Self {
        Self {
            database: Mutex::new(database),
            seed,
            pending_restore: Mutex::new(None),
        }
    }
}

struct PendingRestore {
    token: String,
    path: PathBuf,
    selected_at: Instant,
}

fn database<'a>(state: &'a State<'_, AppState>) -> CommandResult<MutexGuard<'a, Database>> {
    state.database.lock().map_err(|_| CommandError {
        code: "DATABASE_ERROR",
        message: "The local database is temporarily unavailable.".to_owned(),
    })
}

fn command<T>(result: Result<T, AppError>) -> CommandResult<T> {
    result.map_err(Into::into)
}

fn attempt_daily_backup(database: &mut Database) {
    let Ok(status) = backup::backup_status(database) else {
        return;
    };
    if status.backup_directory.is_none() || !status.destination_available {
        return;
    }
    let backed_up_today = status.last_backup_at.as_deref().is_some_and(|value| {
        value.get(0..10) == Some(Utc::now().format("%Y-%m-%d").to_string().as_str())
    });
    if !backed_up_today {
        if let Err(error) = backup::backup_now(database, env!("CARGO_PKG_VERSION")) {
            eprintln!("Daily backup failed: {error}");
        }
    }
}

#[tauri::command]
pub fn get_business_profile(state: State<'_, AppState>) -> CommandResult<Option<BusinessProfile>> {
    command(database(&state)?.get_business_profile())
}

#[tauri::command]
pub fn save_business_profile(
    state: State<'_, AppState>,
    input: BusinessProfileInput,
) -> CommandResult<BusinessProfile> {
    let mut database = database(&state)?;
    let result = command(database.save_business_profile(input))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn get_business_logo(state: State<'_, AppState>) -> CommandResult<Option<BusinessLogo>> {
    command(database(&state)?.get_business_logo())
}

/// Store the report logo the webview has already downscaled. The bytes arrive
/// from an untrusted webview, so they are decoded and checked against the PNG
/// header here before anything reaches the database.
#[tauri::command]
pub fn set_business_logo(
    state: State<'_, AppState>,
    data_base64: String,
    width: i64,
    height: i64,
) -> CommandResult<BusinessLogo> {
    let bytes = STANDARD.decode(data_base64).map_err(|_| {
        CommandError::from(AppError::Validation("Logo image is invalid.".to_owned()))
    })?;
    command(crate::validation::logo_png(&bytes, width, height))?;
    let mut database = database(&state)?;
    let result = command(database.set_business_logo(bytes, width, height))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn clear_business_logo(state: State<'_, AppState>) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.clear_business_logo())?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn get_notice_acknowledgement(
    state: State<'_, AppState>,
) -> CommandResult<Option<NoticeAcknowledgement>> {
    command(database(&state)?.get_notice_acknowledgement())
}

#[tauri::command]
pub fn acknowledge_notice(
    state: State<'_, AppState>,
    version: i64,
) -> CommandResult<NoticeAcknowledgement> {
    command(database(&state)?.acknowledge_notice(version))
}

#[tauri::command]
pub fn get_fishing_year_start_month(state: State<'_, AppState>) -> CommandResult<i64> {
    command(database(&state)?.get_fishing_year_start_month())
}

#[tauri::command]
pub fn set_fishing_year_start_month(
    state: State<'_, AppState>,
    start_month: i64,
) -> CommandResult<i64> {
    let mut database = database(&state)?;
    let result = command(database.set_fishing_year_start_month(start_month))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn list_fishers(
    state: State<'_, AppState>,
    include_archived: bool,
) -> CommandResult<Vec<Fisher>> {
    command(database(&state)?.list_fishers(include_archived))
}

#[tauri::command]
pub fn get_fisher(state: State<'_, AppState>, id: String) -> CommandResult<Fisher> {
    command(database(&state)?.get_fisher(&id))
}

#[tauri::command]
pub fn upsert_fisher(state: State<'_, AppState>, input: FisherInput) -> CommandResult<Fisher> {
    let mut database = database(&state)?;
    let result = command(database.upsert_fisher(input))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn set_fisher_archived(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> CommandResult<Fisher> {
    let mut database = database(&state)?;
    let result = command(database.set_fisher_archived(&id, archived))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn remove_fisher(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.remove_fisher(&id))?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn list_vessels(state: State<'_, AppState>, fisher_id: String) -> CommandResult<Vec<Vessel>> {
    command(database(&state)?.list_vessels(&fisher_id))
}

#[tauri::command]
pub fn get_vessel(
    state: State<'_, AppState>,
    fisher_id: String,
    id: String,
) -> CommandResult<Vessel> {
    command(database(&state)?.get_vessel(&fisher_id, &id))
}

#[tauri::command]
pub fn find_vessel_by_number(
    state: State<'_, AppState>,
    number: String,
) -> CommandResult<Option<RegisteredVessel>> {
    command(database(&state)?.find_vessel_by_number(&number))
}

#[tauri::command]
pub fn upsert_vessel(
    state: State<'_, AppState>,
    fisher_id: String,
    input: VesselInput,
) -> CommandResult<Vessel> {
    let mut database = database(&state)?;
    let result = command(database.upsert_vessel(&fisher_id, input))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn remove_vessel(
    state: State<'_, AppState>,
    fisher_id: String,
    id: String,
) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.remove_vessel(&fisher_id, &id))?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn search_fishstocks(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> CommandResult<Vec<Fishstock>> {
    command(database(&state)?.search_fishstocks(&query, limit.unwrap_or(30)))
}

#[tauri::command]
pub fn list_favorite_fishstocks(state: State<'_, AppState>) -> CommandResult<Vec<Fishstock>> {
    command(database(&state)?.list_favorite_fishstocks())
}

#[tauri::command]
pub fn set_fishstock_favorite(
    state: State<'_, AppState>,
    code: String,
    favorite: bool,
) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.set_fishstock_favorite(&code, favorite))?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn list_user_fishstocks(state: State<'_, AppState>) -> CommandResult<Vec<UserFishstock>> {
    command(database(&state)?.list_user_fishstocks())
}

#[tauri::command]
pub fn add_user_fishstock(
    state: State<'_, AppState>,
    input: UserFishstockInput,
) -> CommandResult<UserFishstock> {
    let mut database = database(&state)?;
    let fishstock = command(database.add_user_fishstock(input))?;
    attempt_daily_backup(&mut database);
    Ok(fishstock)
}

#[tauri::command]
pub fn update_user_fishstock(
    state: State<'_, AppState>,
    code: String,
    input: UserFishstockInput,
) -> CommandResult<UserFishstock> {
    let mut database = database(&state)?;
    let fishstock = command(database.update_user_fishstock(&code, input))?;
    attempt_daily_backup(&mut database);
    Ok(fishstock)
}

#[tauri::command]
pub fn remove_user_fishstock(state: State<'_, AppState>, code: String) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.remove_user_fishstock(&code))?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn list_landings(
    state: State<'_, AppState>,
    filters: LandingFilters,
) -> CommandResult<Vec<Landing>> {
    command(database(&state)?.list_landings(filters))
}

#[tauri::command]
pub fn list_landing_years(state: State<'_, AppState>) -> CommandResult<Vec<i64>> {
    command(database(&state)?.list_landing_years())
}

#[tauri::command]
pub fn list_previous_landing_fishstocks(
    state: State<'_, AppState>,
    fisher_id: String,
    vessel_id: Option<String>,
    exclude_landing_id: Option<String>,
) -> CommandResult<Vec<Fishstock>> {
    command(database(&state)?.list_previous_landing_fishstocks(
        &fisher_id,
        vessel_id.as_deref(),
        exclude_landing_id.as_deref(),
    ))
}

#[tauri::command]
pub fn get_landing(state: State<'_, AppState>, id: String) -> CommandResult<Landing> {
    command(database(&state)?.get_landing(&id))
}

#[tauri::command]
pub fn save_landing(state: State<'_, AppState>, input: LandingInput) -> CommandResult<Landing> {
    let mut database = database(&state)?;
    let result = command(database.save_landing(input))?;
    attempt_daily_backup(&mut database);
    Ok(result)
}

#[tauri::command]
pub fn delete_landing(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let mut database = database(&state)?;
    command(database.delete_landing(&id))?;
    attempt_daily_backup(&mut database);
    Ok(())
}

#[tauri::command]
pub fn list_landing_revisions(
    state: State<'_, AppState>,
    landing_id: String,
) -> CommandResult<Vec<LandingRevision>> {
    command(database(&state)?.list_landing_revisions(&landing_id))
}

#[tauri::command]
pub fn get_landing_revision(
    state: State<'_, AppState>,
    revision_id: String,
) -> CommandResult<LandingRevision> {
    command(database(&state)?.get_landing_revision(&revision_id))
}

#[tauri::command]
pub fn list_deleted_landings(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> CommandResult<Vec<LandingRevision>> {
    command(database(&state)?.list_deleted_landings(limit.unwrap_or(200)))
}

#[tauri::command]
pub fn dashboard_metrics(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
    fishing_year_start_month: i64,
) -> CommandResult<DashboardMetrics> {
    command(database(&state)?.dashboard_metrics(&from_date, &to_date, fishing_year_start_month))
}

#[tauri::command]
pub fn landing_report(
    state: State<'_, AppState>,
    filters: LandingFilters,
) -> CommandResult<ReportResult> {
    command(database(&state)?.report(filters))
}

#[tauri::command]
pub fn full_export(state: State<'_, AppState>) -> CommandResult<FullExport> {
    command(database(&state)?.full_export())
}

#[tauri::command]
pub fn get_backup_status(state: State<'_, AppState>) -> CommandResult<BackupStatus> {
    let database = database(&state)?;
    command(backup::backup_status(&database))
}

#[tauri::command]
pub fn open_backup_folder(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let database = database(&state)?;
    let status = command(backup::backup_status(&database))?;
    let directory = status.backup_directory.ok_or_else(|| {
        CommandError::from(AppError::Validation(
            "Choose a backup folder before opening it.".to_owned(),
        ))
    })?;
    let directory = PathBuf::from(directory);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(AppError::Validation(
            "The configured backup folder is unavailable.".to_owned(),
        )
        .into());
    }
    app.opener()
        .open_path(directory.display().to_string(), None::<&str>)
        .map_err(|error| AppError::Io(std::io::Error::other(error.to_string())).into())
}

#[tauri::command]
pub async fn choose_backup_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<BackupStatus>> {
    let Some(directory) = app
        .dialog()
        .file()
        .set_title("Choose myLFR backup folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let directory = directory.into_path().map_err(|_| {
        CommandError::from(AppError::Validation(
            "The selected backup folder is not a local filesystem path.".to_owned(),
        ))
    })?;
    let mut database = database(&state)?;
    command(backup::set_backup_directory(&mut database, &directory)).map(Some)
}

#[tauri::command]
pub fn backup_now(state: State<'_, AppState>) -> CommandResult<String> {
    let mut database = database(&state)?;
    command(
        backup::backup_now(&mut database, env!("CARGO_PKG_VERSION"))
            .map(|path| path.display().to_string()),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSelection {
    token: String,
    schema_version: i64,
    catalogue_version: i64,
}

#[tauri::command]
pub async fn select_backup_for_restore(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<BackupSelection>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Restore a myLFR backup")
        .add_filter("myLFR backup", &["mylfr-backup"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| {
        CommandError::from(AppError::Validation(
            "The selected backup is not a local filesystem file.".to_owned(),
        ))
    })?;
    let (schema_version, catalogue_version) = command(backup::validate_backup(&path))?;
    let token = uuid::Uuid::new_v4().to_string();
    let mut pending = state.pending_restore.lock().map_err(|_| CommandError {
        code: "BACKUP_INVALID",
        message: "The selected backup authorization could not be recorded.".to_owned(),
    })?;
    *pending = Some(PendingRestore {
        token: token.clone(),
        path,
        selected_at: Instant::now(),
    });
    Ok(Some(BackupSelection {
        token,
        schema_version,
        catalogue_version,
    }))
}

#[tauri::command]
pub fn restore_backup(state: State<'_, AppState>, token: String) -> CommandResult<()> {
    let path = {
        let mut pending = state.pending_restore.lock().map_err(|_| CommandError {
            code: "BACKUP_INVALID",
            message: "The selected backup authorization is unavailable.".to_owned(),
        })?;
        let selected = pending.as_ref().ok_or_else(|| {
            CommandError::from(AppError::Validation(
                "Select the backup again before restoring.".to_owned(),
            ))
        })?;
        if selected.token != token || selected.selected_at.elapsed() > Duration::from_secs(600) {
            return Err(AppError::Validation(
                "The backup selection is invalid or has expired. Select it again.".to_owned(),
            )
            .into());
        }
        pending.take().expect("pending restore was checked").path
    };
    let mut database = database(&state)?;
    command(backup::restore_backup(&mut database, &path, &state.seed))
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> CommandResult<AppInfo> {
    command(database(&state)?.app_info(env!("CARGO_PKG_VERSION")))
}

#[tauri::command]
pub fn open_approved_external_link(app: tauri::AppHandle, url: String) -> CommandResult<()> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| {
        CommandError::from(AppError::Validation("External link is invalid.".to_owned()))
    })?;
    let approved_hosts = ["register.kupe.fishserve.co.nz", "www.legislation.govt.nz"];
    if parsed.scheme() != "https"
        || !parsed
            .host_str()
            .is_some_and(|host| approved_hosts.contains(&host))
    {
        return Err(AppError::Validation(
            "That external link is not approved by myLFR Desktop.".to_owned(),
        )
        .into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Io(std::io::Error::other(error.to_string())).into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheck {
    status: &'static str,
    version: Option<String>,
    /// The release notes published with the available version.
    notes: Option<String>,
}

#[tauri::command]
pub fn get_update_status(state: State<'_, AppState>) -> CommandResult<updates::UpdateStatus> {
    let database = database(&state)?;
    command(updates::read_update_status(
        database.connection(),
        Utc::now(),
    ))
}

#[tauri::command]
pub fn set_app_update_mode(
    state: State<'_, AppState>,
    mode: String,
) -> CommandResult<updates::UpdateStatus> {
    let database = database(&state)?;
    command(updates::set_update_mode(
        database.connection(),
        command(updates::UpdateMode::parse(&mode))?,
    ))?;
    command(updates::read_update_status(
        database.connection(),
        Utc::now(),
    ))
}

#[tauri::command]
pub fn dismiss_update_reminder(state: State<'_, AppState>) -> CommandResult<updates::UpdateStatus> {
    let database = database(&state)?;
    command(updates::dismiss_update_reminder(
        database.connection(),
        Utc::now(),
    ))?;
    command(updates::read_update_status(
        database.connection(),
        Utc::now(),
    ))
}

/// What the install command reports while it works, so the confirmation can
/// show that something is happening.
#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum UpdateProgress {
    BackingUp,
    #[serde(rename_all = "camelCase")]
    Downloading {
        downloaded: u64,
        total: Option<u64>,
    },
    Installing,
}

/// Development builds only: with `MYLFR_DEV_FAKE_UPDATE` set to a version,
/// checks report that version as available and installing it only pretends,
/// so the update screens can be seen without a published release.
fn fake_update_version() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("MYLFR_DEV_FAKE_UPDATE")
        .ok()
        .filter(|version| !version.trim().is_empty())
}

/// Answers whether an update check is due without recording one.
///
/// Asking must not consume the interval: the recording happens only once a
/// check has actually reached the server.
#[tauri::command]
pub fn begin_app_update_check(state: State<'_, AppState>) -> CommandResult<bool> {
    let database = database(&state)?;
    command(updates::is_app_update_check_due(
        database.connection(),
        Utc::now(),
    ))
}

#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    manual: bool,
) -> CommandResult<AppUpdateCheck> {
    if let Some(version) = fake_update_version() {
        return Ok(AppUpdateCheck {
            status: "available",
            version: Some(version),
            notes: Some(
                "Development preview of the update screens. Nothing is downloaded or installed."
                    .to_owned(),
            ),
        });
    }
    // A check the receiver asks for always runs; only automatic checks keep
    // to the once-a-day interval.
    if !manual {
        let database = database(&state)?;
        if !command(updates::is_app_update_check_due(
            database.connection(),
            Utc::now(),
        ))? {
            return Ok(AppUpdateCheck {
                status: "throttled",
                version: None,
                notes: None,
            });
        }
    }
    // Only now that the check has reached the server and returned a result is
    // the interval consumed. A failure above leaves the stored timestamp alone
    // so an offline user can retry as soon as they have a connection.
    let update = configured_updater(&app)?
        .check()
        .await
        .map_err(check_error)?;
    {
        let database = database(&state)?;
        command(updates::record_app_update_check(
            database.connection(),
            Utc::now(),
        ))?;
    }
    Ok(match update {
        Some(update) => AppUpdateCheck {
            status: "available",
            version: Some(update.version),
            notes: update.body.filter(|notes| !notes.trim().is_empty()),
        },
        None => AppUpdateCheck {
            status: "current",
            version: None,
            notes: None,
        },
    })
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    version: String,
    backup_first: bool,
    on_progress: Channel<UpdateProgress>,
) -> CommandResult<()> {
    if fake_update_version().is_some() {
        // Walk through the stages without backing up, downloading, or
        // installing anything.
        tauri::async_runtime::spawn_blocking(move || {
            if backup_first {
                let _ = on_progress.send(UpdateProgress::BackingUp);
                std::thread::sleep(Duration::from_secs(2));
            }
            let total = 27 * 1024 * 1024;
            for step in 1..=10 {
                std::thread::sleep(Duration::from_millis(400));
                let _ = on_progress.send(UpdateProgress::Downloading {
                    downloaded: total * step / 10,
                    total: Some(total),
                });
            }
            let _ = on_progress.send(UpdateProgress::Installing);
            std::thread::sleep(Duration::from_secs(3));
        })
        .await
        .ok();
        return Err(
            AppError::Validation("Development preview: nothing was installed.".to_owned()).into(),
        );
    }
    let update = configured_updater(&app)?
        .check()
        .await
        .map_err(check_error)?
        .ok_or_else(|| {
            CommandError::from(AppError::UpdateInvalid(
                "The selected application update is no longer available.".to_owned(),
            ))
        })?;
    if update.version != version {
        return Err(AppError::UpdateInvalid(
            "The available application update changed. Check for updates again.".to_owned(),
        )
        .into());
    }
    // The update migrates the database on next launch, so the backup is
    // taken before anything is downloaded, and a failed backup stops here.
    if backup_first {
        let _ = on_progress.send(UpdateProgress::BackingUp);
        let mut database = database(&state)?;
        backup::backup_now(&mut database, env!("CARGO_PKG_VERSION")).map_err(|error| {
            CommandError::from(AppError::Validation(format!(
                "The backup failed, so the update was not installed: {error}"
            )))
        })?;
    }
    let mut downloaded = 0_u64;
    let mut reported = 0_u64;
    let bytes = update
        .download(
            |chunk_length, total| {
                downloaded += chunk_length as u64;
                // Report about every 256 KB rather than every chunk.
                if downloaded - reported >= 256 * 1024 || total == Some(downloaded) {
                    reported = downloaded;
                    let _ = on_progress.send(UpdateProgress::Downloading { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(check_error)?;
    verify_windows_update_authenticode(&bytes)?;
    let _ = on_progress.send(UpdateProgress::Installing);
    // On Windows the installer takes over and this process exits without an
    // exit event, so close the session first to keep it from being recorded
    // as a crash.
    #[cfg(windows)]
    crate::session::end();
    update.install(&bytes).map_err(|error| {
        crate::session::resume();
        update_error(error)
    })?;
    Ok(())
}

#[tauri::command]
pub async fn save_export_file(
    app: AppHandle,
    default_name: String,
    file_type: String,
    data_base64: String,
) -> CommandResult<bool> {
    let (label, extension) = export_type(&file_type)?;
    let default_name = validated_default_filename(&default_name, extension)?;
    let bytes = STANDARD.decode(data_base64).map_err(|_| {
        CommandError::from(AppError::Validation("Export data is invalid.".to_owned()))
    })?;
    if bytes.len() > 100 * 1024 * 1024 {
        return Err(AppError::Validation("Export is larger than 100 MB.".to_owned()).into());
    }
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(label, &[extension])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|_| {
        CommandError::from(AppError::Validation(
            "The selected export destination is not a local filesystem path.".to_owned(),
        ))
    })?;
    command(write_export_file(&path, extension, &bytes))?;
    Ok(true)
}

/// Where problem reports are filed. Bug reports go to the public GitHub issue
/// tracker; security reports go through private vulnerability reporting
/// instead, as described in SECURITY.md.
pub const ISSUE_TRACKER_NEW_URL: &str =
    "https://github.com/Magnifica101/myLFR-desktop/issues/new?template=bug_report.yml";

/// Build the sanitised problem report. Shared by the clipboard and file paths
/// so both always deliver byte-identical content.
fn diagnostics_json(state: &State<'_, AppState>) -> CommandResult<String> {
    let database = database(state)?;
    let info = command(database.app_info(env!("CARGO_PKG_VERSION")))?;
    let backup = command(backup::backup_status(&database))?;
    drop(database);
    let diagnostics = serde_json::json!({
        "applicationVersion": info.version,
        "schemaVersion": info.schema_version,
        "catalogueVersion": info.catalogue_version,
        "operatingSystem": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "backupConfigured": backup.backup_directory.is_some(),
        "backupDestinationAvailable": backup.destination_available,
        "backupIsStale": backup.is_stale,
        "recentErrors": crate::diagnostics::recent(100),
        "generatedAt": Utc::now().to_rfc3339(),
        "privacy": "Includes app and database versions, backup status, and recent sanitised error and crash entries only. No business profile, permit holder, vessel, landing, database path, or backup path is included."
    });
    command(serde_json::to_string_pretty(&diagnostics).map_err(AppError::from))
}

/// Return the problem report as text so the user can paste it into an email.
#[tauri::command]
pub fn diagnostics_report(state: State<'_, AppState>) -> CommandResult<String> {
    diagnostics_json(&state)
}

/// Open the bug report form in the user's browser with the app version filled
/// in. The URL is built from constants only, so no caller-supplied text
/// reaches the shell.
#[tauri::command]
pub fn open_issue_tracker(app: AppHandle) -> CommandResult<()> {
    let url = format!(
        "{ISSUE_TRACKER_NEW_URL}&version={}",
        env!("CARGO_PKG_VERSION")
    );
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Io(std::io::Error::other(error.to_string())).into())
}

#[tauri::command]
pub async fn export_diagnostics(app: AppHandle, state: State<'_, AppState>) -> CommandResult<bool> {
    let bytes = diagnostics_json(&state)?.into_bytes();
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(format!(
            "myLFR-diagnostics-{}.json",
            Utc::now().format("%Y-%m-%d")
        ))
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|_| {
        CommandError::from(AppError::Validation(
            "The selected diagnostics destination is not a local filesystem path.".to_owned(),
        ))
    })?;
    command(write_export_file(&path, "json", &bytes))?;
    Ok(true)
}

fn configured_updater(app: &AppHandle) -> CommandResult<tauri_plugin_updater::Updater> {
    let builder = app.updater_builder();
    #[cfg(feature = "updater-pilot")]
    let builder = {
        let invalid_ca = || {
            CommandError::from(AppError::UpdateInvalid(
                "The updater pilot does not have a valid test certificate.".to_owned(),
            ))
        };
        if app.config().identifier != "nz.co.mylfr.desktop.updater-pilot" {
            return Err(invalid_ca());
        }
        let ca = STANDARD
            .decode(option_env!("MYLFR_PILOT_UPDATE_CA").ok_or_else(invalid_ca)?)
            .map_err(|_| invalid_ca())?;
        let ca = pilot_update_http::Certificate::from_der(&ca).map_err(|_| invalid_ca())?;
        builder.no_proxy().configure_client(move |client| {
            client
                .tls_certs_only([ca.clone()])
                .redirect(pilot_update_http::redirect::Policy::none())
        })
    };
    builder.build().map_err(update_error)
}

/// Errors from reaching the update server. Failing to connect, a network error,
/// and a server with no release information all mean the same thing to the
/// user, and none of them counts as a check.
fn check_error(error: tauri_plugin_updater::Error) -> CommandError {
    use tauri_plugin_updater::Error;
    match &error {
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => {
            crate::diagnostics::record_error("UPDATE_UNREACHABLE", &error.to_string());
            AppError::UpdateUnreachable(
                "myLFR couldn't get update information from the update server. Check your internet connection and try again later.".to_owned(),
            )
            .into()
        }
        _ => update_error(error),
    }
}

fn update_error(error: tauri_plugin_updater::Error) -> CommandError {
    AppError::UpdateInvalid(format!(
        "The application update could not be verified or installed: {error}"
    ))
    .into()
}

fn export_type(file_type: &str) -> CommandResult<(&'static str, &'static str)> {
    match file_type {
        "json" => Ok(("JSON", "json")),
        "xlsx" => Ok(("Excel", "xlsx")),
        "pdf" => Ok(("PDF", "pdf")),
        _ => Err(AppError::Validation("Unsupported export file type.".to_owned()).into()),
    }
}

fn validated_default_filename(default_name: &str, extension: &str) -> CommandResult<String> {
    let invalid = default_name.is_empty()
        || default_name.chars().count() > 160
        || default_name.chars().any(|character| {
            matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        });
    if invalid {
        return Err(AppError::Validation("Export filename is invalid.".to_owned()).into());
    }
    let suffix = format!(".{extension}");
    Ok(
        if default_name
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
        {
            default_name.to_owned()
        } else {
            format!("{default_name}{suffix}")
        },
    )
}

fn write_export_file(path: &Path, extension: &str, bytes: &[u8]) -> Result<(), AppError> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case(extension))
    {
        return Err(AppError::Validation(format!(
            "Select a .{extension} destination for this export."
        )));
    }
    let parent = path
        .parent()
        .filter(|value| value.is_dir())
        .ok_or_else(|| AppError::Validation("Export directory does not exist.".to_owned()))?;
    let pending = parent.join(format!(".mylfr-export-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&pending, bytes)?;
    if let Err(error) = std::fs::rename(&pending, path) {
        let _ = std::fs::remove_file(&pending);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_windows_update_authenticode(_bytes: &[u8]) -> CommandResult<()> {
    Ok(())
}

#[cfg(windows)]
fn verify_windows_update_authenticode(bytes: &[u8]) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    // The app has no console, so a console child would otherwise flash a
    // window on screen while the update is checked.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    if bytes.len() < 2 || &bytes[..2] != b"MZ" {
        return Err(AppError::SignatureInvalid(
            "The downloaded Windows update is not an executable installer.".to_owned(),
        )
        .into());
    }
    let expected = match crate::updates::windows_update_publisher(
        option_env!("MYLFR_WINDOWS_SIGNER_THUMBPRINT"),
        option_env!("MYLFR_UNSIGNED_WINDOWS_RELEASE"),
    )? {
        crate::updates::WindowsUpdatePublisher::Pinned(thumbprint) => thumbprint,
        // Unsigned releases rely on the Tauri updater signature alone.
        crate::updates::WindowsUpdatePublisher::NotRequired => return Ok(()),
    };
    let temporary = tempfile::Builder::new()
        .prefix("mylfr-update-authenticode-")
        .tempdir()
        .map_err(AppError::from)?;
    let installer = temporary.path().join("update-installer.exe");
    std::fs::write(&installer, bytes).map_err(AppError::from)?;
    let system_root = std::env::var_os("SystemRoot").ok_or_else(|| {
        CommandError::from(AppError::UpdateInvalid(
            "Windows signature verification is unavailable.".to_owned(),
        ))
    })?;
    let powershell = PathBuf::from(system_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    // A caller running PowerShell 7 can pass module paths that Windows
    // PowerShell cannot load. Use the security module shipped with this shell.
    let script = r#"
$ErrorActionPreference = 'Stop'
try {
    $module = Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'
    Import-Module -Name $module
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $env:MYLFR_UPDATE_INSTALLER_PATH
    if ($signature.Status -ne 'Valid') { exit 10 }
    if ($signature.SignerCertificate.Thumbprint -ne $env:MYLFR_UPDATE_EXPECTED_THUMBPRINT) { exit 11 }
    exit 0
} catch {
    exit 12
}
"#;
    let status = Command::new(powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .env_remove("PSModulePath")
        .env("MYLFR_UPDATE_INSTALLER_PATH", &installer)
        .env("MYLFR_UPDATE_EXPECTED_THUMBPRINT", expected)
        .output()
        .map_err(|error| {
            AppError::UpdateInvalid(format!(
                "Windows could not start the update signature check: {error}"
            ))
        })?
        .status;
    match status.code() {
        Some(0) => Ok(()),
        Some(10) => Err(AppError::SignatureInvalid(
            "Windows could not verify the downloaded update's signature.".to_owned(),
        )
        .into()),
        Some(11) => Err(AppError::SignatureInvalid(
            "The downloaded Windows update was signed by a different publisher.".to_owned(),
        )
        .into()),
        _ => Err(AppError::UpdateInvalid(format!(
            "Windows could not run the update signature check ({status})."
        ))
        .into()),
    }
}
