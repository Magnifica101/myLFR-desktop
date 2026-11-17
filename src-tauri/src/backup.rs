use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Utc};
use rusqlite::{Connection, OpenFlags, backup::Backup, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use uuid::Uuid;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::db::{
    CURRENT_SCHEMA_VERSION, Database, MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_MIGRATIONS,
};
use crate::error::{AppError, AppResult};
use crate::models::{BackupStatus, CatalogueDocument};

const DATABASE_ENTRY: &str = "mylfr.sqlite3";
const MANIFEST_ENTRY: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 32 * 1024;
const MAX_DATABASE_BYTES: u64 = 512_000_000;
const STALE_HOURS: i64 = 48;
pub(crate) const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: u32,
    created_at: String,
    application_version: String,
    schema_version: i64,
    catalogue_version: i64,
    database_sha256: String,
    database_size: u64,
}

pub fn set_backup_directory(database: &mut Database, directory: &Path) -> AppResult<BackupStatus> {
    if !directory.is_dir() {
        return Err(AppError::Validation(
            "Choose an existing backup directory.".to_owned(),
        ));
    }
    let canonical = directory.canonicalize()?;
    database.connection_mut().execute(
        "UPDATE app_settings SET backup_directory = ?1 WHERE id = 1",
        [plain_windows_path(&canonical.display().to_string())],
    )?;
    backup_status(database)
}

pub fn backup_status(database: &Database) -> AppResult<BackupStatus> {
    let (directory, last_at, last_path): (Option<String>, Option<String>, Option<String>) =
        database.connection().query_row(
            "SELECT backup_directory, last_backup_at, last_backup_path FROM app_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    // Folders saved before paths were simplified still carry the prefix.
    let directory = directory.map(|path| plain_windows_path(&path));
    let last_path = last_path.map(|path| plain_windows_path(&path));
    let destination_available = directory
        .as_deref()
        .is_some_and(|path| Path::new(path).is_dir());
    let same_device_warning = directory
        .as_deref()
        .filter(|_| destination_available)
        .is_some_and(|path| {
            !cloud_synced(path) && same_storage_volume(database.path(), Path::new(path))
        });
    let is_stale = last_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_none_or(|value| {
            Utc::now()
                .signed_duration_since(value.with_timezone(&Utc))
                .num_hours()
                >= STALE_HOURS
        });
    Ok(BackupStatus {
        backup_directory: directory,
        last_backup_at: last_at,
        last_backup_path: last_path,
        destination_available,
        same_device_warning,
        is_stale,
    })
}

/// Windows returns chosen folders in its long-path form (`\\?\C:\...`). Receivers
/// should never see that prefix, and it makes the same drive look like a
/// different one. Rust adds it back itself when a path is too long.
fn plain_windows_path(path: &str) -> String {
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    match path.strip_prefix(r"\\?\") {
        Some(rest) if has_drive_letter(rest) => rest.to_owned(),
        _ => path.to_owned(),
    }
}

fn has_drive_letter(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// The drive (`C:`) or network share (`\\SERVER\SHARE`) a Windows path is on.
#[cfg(any(windows, test))]
fn windows_volume(path: &str) -> Option<String> {
    let path = plain_windows_path(path);
    if has_drive_letter(&path) {
        return Some(path[..2].to_ascii_uppercase());
    }
    let mut parts = path.strip_prefix(r"\\")?.split('\\');
    let server = parts.next().filter(|part| !part.is_empty())?;
    let share = parts.next().filter(|part| !part.is_empty())?;
    Some(format!(r"\\{server}\{share}").to_uppercase())
}

#[cfg(any(windows, test))]
fn is_within_windows_folder(path: &str, folder: &str) -> bool {
    let path = plain_windows_path(path).to_lowercase();
    let folder = plain_windows_path(folder);
    let folder = folder.trim_end_matches('\\').to_lowercase();
    !folder.is_empty() && (path == folder || path.starts_with(&format!("{folder}\\")))
}

/// A OneDrive folder is copied off the computer, so it is not "the same drive"
/// even though it sits on C:. OneDrive is the only sync service Windows records
/// the location of; others can be dismissed in Settings.
#[cfg(windows)]
fn cloud_synced(directory: &str) -> bool {
    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(std::env::var_os)
        .any(|folder| is_within_windows_folder(directory, &folder.to_string_lossy()))
}

#[cfg(not(windows))]
fn cloud_synced(_directory: &str) -> bool {
    false
}

#[cfg(windows)]
fn same_storage_volume(database_path: &Path, backup_directory: &Path) -> bool {
    let database = windows_volume(&database_path.to_string_lossy());
    database.is_some() && database == windows_volume(&backup_directory.to_string_lossy())
}

#[cfg(unix)]
fn same_storage_volume(database_path: &Path, backup_directory: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    let database_directory = database_path.parent().unwrap_or(database_path);
    match (
        std::fs::metadata(database_directory),
        std::fs::metadata(backup_directory),
    ) {
        (Ok(database), Ok(backup)) => database.dev() == backup.dev(),
        _ => false,
    }
}

#[cfg(not(any(windows, unix)))]
fn same_storage_volume(_database_path: &Path, _backup_directory: &Path) -> bool {
    false
}

pub fn backup_now(database: &mut Database, application_version: &str) -> AppResult<PathBuf> {
    let directory: Option<String> = database.connection().query_row(
        "SELECT backup_directory FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    let directory = directory.ok_or_else(|| {
        AppError::Validation("Choose a backup directory before backing up.".to_owned())
    })?;
    let directory = PathBuf::from(plain_windows_path(&directory));
    if !directory.is_dir() {
        return Err(AppError::Validation(
            "The configured backup directory is unavailable.".to_owned(),
        ));
    }

    let temporary = TempDir::new_in(&directory)?;
    let database_copy = temporary.path().join(DATABASE_ENTRY);
    let mut destination = Connection::open(&database_copy)?;
    let backup = Backup::new(database.connection(), &mut destination)?;
    backup.run_to_completion(128, std::time::Duration::from_millis(10), None)?;
    drop(backup);
    let integrity: String =
        destination.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(AppError::BackupInvalid(format!(
            "SQLite integrity check failed: {integrity}"
        )));
    }
    drop(destination);

    let database_bytes = fs::read(&database_copy)?;
    let created_at = Utc::now();
    let manifest = BackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        created_at: created_at.to_rfc3339(),
        application_version: application_version.to_owned(),
        schema_version: database.schema_version()?,
        catalogue_version: database.connection().query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )?,
        database_sha256: sha256(&database_bytes),
        database_size: database_bytes.len() as u64,
    };
    let filename = format!(
        "myLFR-backup-{}.mylfr-backup",
        created_at.format("%Y%m%d-%H%M%S")
    );
    let final_path = directory.join(filename);
    let pending_path = temporary.path().join("backup.pending");
    let mut archive = ZipWriter::new(File::create(&pending_path)?);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive.start_file(MANIFEST_ENTRY, options)?;
    archive.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    archive.start_file(DATABASE_ENTRY, options)?;
    archive.write_all(&database_bytes)?;
    archive.finish()?.sync_all()?;
    fs::rename(&pending_path, &final_path)?;

    database.connection_mut().execute(
        "UPDATE app_settings SET last_backup_at = ?1, last_backup_path = ?2 WHERE id = 1",
        params![created_at.to_rfc3339(), final_path.display().to_string()],
    )?;
    prune_backups(&directory)?;
    Ok(final_path)
}

pub fn validate_backup(path: &Path) -> AppResult<(i64, i64)> {
    let temporary = TempDir::new()?;
    let (manifest, database_path) = extract_and_validate(path, temporary.path())?;
    validate_sqlite_file(
        &database_path,
        manifest.schema_version,
        manifest.catalogue_version,
    )?;
    Ok((manifest.schema_version, manifest.catalogue_version))
}

pub fn restore_backup(
    database: &mut Database,
    backup_path: &Path,
    seed: &CatalogueDocument,
) -> AppResult<()> {
    let app_data_directory = database
        .path()
        .parent()
        .ok_or_else(|| {
            AppError::BackupInvalid("Database path has no parent directory.".to_owned())
        })?
        .to_path_buf();
    let temporary = TempDir::new_in(&app_data_directory)?;
    let (manifest, extracted) = extract_and_validate(backup_path, temporary.path())?;
    validate_sqlite_file(
        &extracted,
        manifest.schema_version,
        manifest.catalogue_version,
    )?;
    prepare_database_for_restore(&extracted, seed)?;

    database
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    let live_path = database.path().to_path_buf();
    let rollback_path =
        app_data_directory.join(format!("mylfr-pre-restore-{}.sqlite3", Uuid::new_v4()));

    let placeholder = Connection::open_in_memory()?;
    let old_connection = std::mem::replace(database.connection_mut(), placeholder);
    drop(old_connection);
    remove_sidecars(&live_path);
    fs::rename(&live_path, &rollback_path)?;
    if let Err(error) = fs::rename(&extracted, &live_path) {
        let rollback_result = fs::rename(&rollback_path, &live_path);
        *database = Database::open(&live_path, seed).map_err(|reopen_error| {
            AppError::BackupInvalid(format!(
                "Restore replacement failed ({error}); rollback result: {rollback_result:?}; original database could not reopen ({reopen_error}). Safety path: {}",
                rollback_path.display()
            ))
        })?;
        return Err(AppError::BackupInvalid(format!(
            "Restore replacement failed and the original database was reopened: {error}"
        )));
    }

    match Database::open(&live_path, seed) {
        Ok(reopened) => {
            *database = reopened;
            let _ = fs::remove_file(&rollback_path);
            Ok(())
        }
        Err(error) => {
            remove_sidecars(&live_path);
            let _ = fs::remove_file(&live_path);
            let _ = fs::rename(&rollback_path, &live_path);
            *database = Database::open(&live_path, seed).map_err(|rollback_error| {
                AppError::BackupInvalid(format!(
                    "Restore failed ({error}) and rollback could not reopen the original database ({rollback_error}). Safety copy: {}",
                    rollback_path.display()
                ))
            })?;
            Err(AppError::BackupInvalid(format!(
                "Restore failed and was rolled back: {error}"
            )))
        }
    }
}

fn prepare_database_for_restore(path: &Path, seed: &CatalogueDocument) -> AppResult<()> {
    let mut restored = Database::open(path, seed)?;
    restored.normalize_restored_state(seed)?;
    let (busy, log_frames, checkpointed_frames): (i64, i64, i64) = restored
        .connection()
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if busy != 0 || log_frames != checkpointed_frames {
        return Err(AppError::BackupInvalid(
            "Restored database could not be finalized safely.".to_owned(),
        ));
    }
    drop(restored);
    remove_sidecars(path);
    validate_sqlite_file(
        path,
        CURRENT_SCHEMA_VERSION,
        i64::from(seed.catalogue_version),
    )
}

fn extract_and_validate(path: &Path, output: &Path) -> AppResult<(BackupManifest, PathBuf)> {
    if path.extension().and_then(|value| value.to_str()) != Some("mylfr-backup") {
        return Err(AppError::BackupInvalid(
            "Select a .mylfr-backup file.".to_owned(),
        ));
    }
    let mut archive = ZipArchive::new(File::open(path)?)?;
    if archive.len() != 2 {
        return Err(AppError::BackupInvalid(
            "Backup package contains unexpected files.".to_owned(),
        ));
    }
    let manifest: BackupManifest = {
        let mut entry = archive.by_name(MANIFEST_ENTRY)?;
        let declared_size = entry.size();
        let bytes = read_manifest_bytes(&mut entry, declared_size)?;
        serde_json::from_slice(&bytes)?
    };
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(AppError::BackupInvalid(
            "Unsupported backup format.".to_owned(),
        ));
    }
    let database_path = output.join(DATABASE_ENTRY);
    let database_sha256 = {
        let mut entry = archive.by_name(DATABASE_ENTRY)?;
        if entry.size() != manifest.database_size || entry.size() > MAX_DATABASE_BYTES {
            return Err(AppError::BackupInvalid(
                "Backup database size is invalid.".to_owned(),
            ));
        }
        let mut destination = File::create(&database_path)?;
        // The file is closed on both success and failure before callers can
        // validate SQLite or clean up their temporary directory (also on Windows).
        stream_database(
            &mut entry,
            &mut destination,
            manifest.database_size,
            MAX_DATABASE_BYTES,
        )?
    };
    if database_sha256 != manifest.database_sha256 {
        return Err(AppError::BackupInvalid(
            "Backup checksum does not match.".to_owned(),
        ));
    }
    Ok((manifest, database_path))
}

fn read_manifest_bytes(reader: &mut impl Read, declared_size: u64) -> AppResult<Vec<u8>> {
    if declared_size > MAX_MANIFEST_BYTES {
        return Err(AppError::BackupInvalid(
            "Backup manifest is too large.".to_owned(),
        ));
    }
    // ZIP metadata is untrusted: bound the actual output and probe one byte
    // beyond the declared size instead of trusting the decompressor to stop.
    let mut bytes = Vec::new();
    reader
        .take(declared_size + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| invalid_entry_data(error, "manifest"))?;
    if bytes.len() as u64 != declared_size {
        return Err(AppError::BackupInvalid(
            "Backup manifest size is invalid.".to_owned(),
        ));
    }
    Ok(bytes)
}

fn stream_database(
    reader: &mut impl Read,
    destination: &mut impl Write,
    declared_size: u64,
    maximum_size: u64,
) -> AppResult<String> {
    let invalid_size = || AppError::BackupInvalid("Backup database size is invalid.".to_owned());
    if declared_size > maximum_size {
        return Err(invalid_size());
    }
    let mut remaining = declared_size;
    let mut buffer = [0_u8; 64 * 1024];
    let mut digest = Sha256::new();
    loop {
        // Once all declared bytes have been consumed, a one-byte read detects
        // excess output and reaches EOF/CRC validation for legitimate entries.
        let read_length = remaining.min(buffer.len() as u64).max(1) as usize;
        let count = match reader.read(&mut buffer[..read_length]) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(|error| invalid_entry_data(error, "database"))?,
        };
        if count == 0 {
            if remaining != 0 {
                return Err(invalid_size());
            }
            return Ok(hex::encode(digest.finalize()));
        }
        if count as u64 > remaining {
            return Err(invalid_size());
        }
        destination.write_all(&buffer[..count])?;
        digest.update(&buffer[..count]);
        remaining -= count as u64;
    }
}

fn invalid_entry_data(error: std::io::Error, entry: &str) -> AppError {
    // The ZIP reader can reject an entry's size or CRC before our own checks.
    if error.kind() == std::io::ErrorKind::InvalidData {
        AppError::BackupInvalid(format!("Backup {entry} data or size is invalid."))
    } else {
        error.into()
    }
}

fn validate_sqlite_file(
    path: &Path,
    manifest_schema_version: i64,
    manifest_catalogue_version: i64,
) -> AppResult<()> {
    if !(MIN_SUPPORTED_SCHEMA_VERSION..=CURRENT_SCHEMA_VERSION).contains(&manifest_schema_version) {
        return Err(AppError::BackupInvalid(
            "Backup schema version is incompatible with this application.".to_owned(),
        ));
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.pragma_update(None, "trusted_schema", "OFF")?;
    connection.pragma_update(None, "query_only", "ON")?;
    let application_id: i64 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if application_id != 0x4D4C4652 {
        return Err(AppError::BackupInvalid(
            "This database is not a myLFR Desktop database.".to_owned(),
        ));
    }
    let schema_version: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if schema_version != manifest_schema_version {
        return Err(AppError::BackupInvalid(
            "Backup schema version is incompatible with this application.".to_owned(),
        ));
    }
    validate_authoritative_schema(&connection, schema_version)?;
    let catalogue_version: i64 = connection.query_row(
        "SELECT catalogue_version FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    if catalogue_version != manifest_catalogue_version {
        return Err(AppError::BackupInvalid(
            "Backup catalogue version does not match its manifest.".to_owned(),
        ));
    }
    let mut foreign_key_check = connection.prepare("PRAGMA foreign_key_check")?;
    if foreign_key_check.query([])?.next()?.is_some() {
        return Err(AppError::BackupInvalid(
            "Backup database contains invalid foreign-key references.".to_owned(),
        ));
    }
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(AppError::BackupInvalid(format!(
            "Backup database integrity check failed: {integrity}"
        )));
    }
    Ok(())
}

type SchemaObject = (String, String, String, Option<String>);

fn validate_authoritative_schema(connection: &Connection, schema_version: i64) -> AppResult<()> {
    let actual = schema_objects(connection)?;
    let expected_connection = Connection::open_in_memory()?;
    for &(migration_version, sql) in SCHEMA_MIGRATIONS {
        if migration_version > schema_version {
            break;
        }
        expected_connection.execute_batch(sql)?;
        expected_connection.pragma_update(None, "user_version", migration_version)?;
    }
    let expected = schema_objects(&expected_connection)?;
    if actual != expected {
        return Err(AppError::BackupInvalid(
            "Backup database schema does not match the authoritative myLFR schema.".to_owned(),
        ));
    }
    Ok(())
}

fn schema_objects(connection: &Connection) -> AppResult<Vec<SchemaObject>> {
    // A backup can forge SQLite-reserved names. Compare those objects too,
    // including the automatic indexes generated by the authoritative migrations.
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn prune_backups(directory: &Path) -> AppResult<()> {
    let mut entries = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_ok_and(|value| value.is_file())
                && entry.file_name().to_str().is_some_and(|value| {
                    value.starts_with("myLFR-backup-") && value.ends_with(".mylfr-backup")
                })
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));

    let mut keep = HashSet::new();
    for entry in entries.iter().take(30) {
        keep.insert(entry.path());
    }
    let mut months = HashMap::<(i32, u32), PathBuf>::new();
    for entry in &entries {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let date: DateTime<Utc> = modified.into();
        months
            .entry((date.year(), date.month()))
            .or_insert_with(|| entry.path());
    }
    let mut monthly = months.into_iter().collect::<Vec<_>>();
    monthly.sort_by_key(|(month, _)| std::cmp::Reverse(*month));
    for (_, path) in monthly.into_iter().take(12) {
        keep.insert(path);
    }
    for entry in entries {
        let path = entry.path();
        if !keep.contains(&path) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn remove_sidecars(path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
        let _ = fs::remove_file(sidecar);
    }
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
#[path = "backup_tests.rs"]
mod tests;
