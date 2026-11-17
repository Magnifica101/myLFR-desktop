use super::*;
use std::io::Cursor;

fn assert_invalid_size(error: AppError) {
    assert!(
        matches!(&error, AppError::BackupInvalid(message) if message.contains("size") || message.contains("large")),
        "{error}"
    );
    assert_eq!(
        crate::error::CommandError::from(error).code,
        "BACKUP_INVALID"
    );
}

fn package(path: &Path, data: &[u8], declared_size: u64, digest: &str) {
    let manifest = BackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        created_at: "2026-09-10T00:00:00Z".to_owned(),
        application_version: "0.1.0".to_owned(),
        schema_version: CURRENT_SCHEMA_VERSION,
        catalogue_version: 1,
        database_sha256: digest.to_owned(),
        database_size: declared_size,
    };
    let mut archive = ZipWriter::new(File::create(path).unwrap());
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive.start_file(MANIFEST_ENTRY, options).unwrap();
    archive
        .write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    archive.start_file(DATABASE_ENTRY, options).unwrap();
    archive.write_all(data).unwrap();
    archive.finish().unwrap();
}

// Change only ZIP metadata; retain the original Deflate stream and CRC unless
// testing CRC failure. These tiny fixtures do not need huge decompression bombs.
fn patch_metadata(path: &Path, name: &str, size: Option<u32>, corrupt_crc: bool) -> u64 {
    let (local, central, original_size, crc) = {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let entry = archive.by_name(name).unwrap();
        (
            entry.header_start() as usize,
            entry.central_header_start() as usize,
            entry.size(),
            entry.crc32(),
        )
    };
    let mut bytes = fs::read(path).unwrap();
    assert_eq!(&bytes[local..local + 4], b"PK\x03\x04");
    assert_eq!(&bytes[central..central + 4], b"PK\x01\x02");
    if let Some(size) = size {
        bytes[local + 22..local + 26].copy_from_slice(&size.to_le_bytes());
        bytes[central + 24..central + 28].copy_from_slice(&size.to_le_bytes());
    }
    if corrupt_crc {
        let wrong_crc = (crc ^ 1).to_le_bytes();
        bytes[local + 14..local + 18].copy_from_slice(&wrong_crc);
        bytes[central + 16..central + 20].copy_from_slice(&wrong_crc);
    }
    fs::write(path, bytes).unwrap();
    original_size
}

#[test]
fn bounded_manifest_checks_actual_length_and_limit() {
    let bytes = vec![b' '; MAX_MANIFEST_BYTES as usize];
    assert_eq!(
        read_manifest_bytes(&mut bytes.as_slice(), MAX_MANIFEST_BYTES).unwrap(),
        bytes
    );
    for declared in [0, MAX_MANIFEST_BYTES - 1, MAX_MANIFEST_BYTES + 1] {
        assert_invalid_size(read_manifest_bytes(&mut bytes.as_slice(), declared).unwrap_err());
    }
    let mut overflow = Cursor::new(vec![b' '; MAX_MANIFEST_BYTES as usize + 20]);
    assert_invalid_size(read_manifest_bytes(&mut overflow, MAX_MANIFEST_BYTES).unwrap_err());
    assert_eq!(overflow.position(), MAX_MANIFEST_BYTES + 1);
    assert_invalid_size(read_manifest_bytes(&mut &b"short"[..], 6).unwrap_err());
}

#[test]
fn streamed_database_checks_limits_and_never_writes_excess() {
    for size in [0, 1, 17, 64 * 1024 + 3] {
        let data = vec![42; size];
        let mut output = Vec::new();
        assert_eq!(
            stream_database(&mut data.as_slice(), &mut output, size as u64, size as u64).unwrap(),
            sha256(&data)
        );
        assert_eq!(output, data);
    }
    let mut input = Cursor::new(vec![42; 30]);
    let mut output = Vec::new();
    assert_invalid_size(stream_database(&mut input, &mut output, 17, 17).unwrap_err());
    assert_eq!(input.position(), 18);
    assert_eq!(output, vec![42; 17]);

    let mut input = Cursor::new(vec![42; 18]);
    let mut output = Vec::new();
    assert_invalid_size(stream_database(&mut input, &mut output, 18, 17).unwrap_err());
    assert_eq!(input.position(), 0);
    assert!(output.is_empty());
    assert_invalid_size(stream_database(&mut &b"short"[..], &mut output, 6, 17).unwrap_err());
}

#[test]
fn extraction_rejects_dishonest_deflate_sizes_for_both_entries() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("crafted.mylfr-backup");
    let data = vec![42; 1024];
    for entry in [MANIFEST_ENTRY, DATABASE_ENTRY] {
        for delta in [-1_i64, 1] {
            let database_size =
                (data.len() as i64 + if entry == DATABASE_ENTRY { delta } else { 0 }) as u64;
            package(&path, &data, database_size, &sha256(&data));
            let size = patch_metadata(&path, entry, None, false);
            patch_metadata(&path, entry, Some((size as i64 + delta) as u32), false);
            let output = TempDir::new().unwrap();
            assert_invalid_size(extract_and_validate(&path, output.path()).unwrap_err());
            if entry == MANIFEST_ENTRY {
                assert!(!output.path().join(DATABASE_ENTRY).exists());
            } else {
                assert!(
                    fs::metadata(output.path().join(DATABASE_ENTRY))
                        .unwrap()
                        .len()
                        <= database_size
                );
            }
        }
    }
}

#[test]
fn extraction_checks_crc_at_exact_eof_and_sha256() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("crafted.mylfr-backup");
    let data = vec![42; 1024];
    for entry in [MANIFEST_ENTRY, DATABASE_ENTRY] {
        package(&path, &data, data.len() as u64, &sha256(&data));
        patch_metadata(&path, entry, None, true);
        let output = TempDir::new().unwrap();
        let error = extract_and_validate(&path, output.path()).unwrap_err();
        assert!(
            matches!(error, AppError::BackupInvalid(ref message) if message.contains("data or size")),
            "{error}"
        );
    }
    package(&path, &data, data.len() as u64, &"0".repeat(64));
    let output = TempDir::new().unwrap();
    let error = extract_and_validate(&path, output.path()).unwrap_err();
    assert!(
        matches!(error, AppError::BackupInvalid(ref message) if message.contains("checksum")),
        "{error}"
    );

    package(&path, &data, data.len() as u64, &sha256(&data));
    let (manifest, extracted) = extract_and_validate(&path, output.path()).unwrap();
    assert_eq!(fs::read(extracted).unwrap(), data);
    assert_eq!(manifest.database_sha256, sha256(&data));
}

#[test]
fn rejected_size_preserves_live_database_and_cleans_staging_files() {
    let directory = TempDir::new().unwrap();
    let records = vec![crate::models::CatalogueRecord {
        code: "BCO1".to_owned(),
        description: "Test stock".to_owned(),
        reporting_unit: "greenweightKg".to_owned(),
        is_active: true,
    }];
    let seed = CatalogueDocument {
        schema_version: 2,
        catalogue_version: 1,
        generated_at: "2026-09-10T00:00:00Z".to_owned(),
        source: "test".to_owned(),
        records_sha256: sha256(&serde_json::to_vec(&records).unwrap()),
        records,
    };
    let mut database = Database::open(directory.path().join(DATABASE_ENTRY), &seed).unwrap();
    let input = crate::models::BusinessProfileInput {
        lfr_name: "Live sentinel".to_owned(),
        client_number: "LFR001".to_owned(),
        street_number: String::new(),
        street_name: String::new(),
        street_type: String::new(),
        suburb: String::new(),
        city: String::new(),
        postcode: String::new(),
    };
    database.save_business_profile(input.clone()).unwrap();
    let backups = TempDir::new().unwrap();
    let path = backups.path().join("crafted.mylfr-backup");
    let entries = || {
        let mut names = fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        names.sort();
        names
    };
    let before = entries();
    for entry in [MANIFEST_ENTRY, DATABASE_ENTRY] {
        let data = vec![42; 1024];
        package(
            &path,
            &data,
            if entry == DATABASE_ENTRY {
                1
            } else {
                data.len() as u64
            },
            &sha256(&data),
        );
        patch_metadata(&path, entry, Some(1), false);
        assert_invalid_size(validate_backup(&path).unwrap_err());
        assert_invalid_size(restore_backup(&mut database, &path, &seed).unwrap_err());
        assert_eq!(
            database.get_business_profile().unwrap().unwrap().lfr_name,
            "Live sentinel"
        );
        database.save_business_profile(input.clone()).unwrap();
        assert_eq!(entries(), before);
    }
}

#[test]
fn windows_long_path_prefix_is_removed_for_display() {
    assert_eq!(
        plain_windows_path(r"\\?\C:\Users\me\OneDrive\myLFR backups"),
        r"C:\Users\me\OneDrive\myLFR backups"
    );
    assert_eq!(
        plain_windows_path(r"\\?\UNC\server\share\backups"),
        r"\\server\share\backups"
    );
    assert_eq!(plain_windows_path(r"D:\backups"), r"D:\backups");
    // A volume GUID path has no plainer form, so it is left alone.
    assert_eq!(
        plain_windows_path(r"\\?\Volume{1234}\backups"),
        r"\\?\Volume{1234}\backups"
    );
    assert_eq!(plain_windows_path("/home/me/backups"), "/home/me/backups");
}

#[test]
fn windows_volume_ignores_long_path_prefix_and_case() {
    let database = r"C:\Users\me\AppData\Local\nz.co.mylfr.desktop\mylfr.sqlite3";
    assert_eq!(
        windows_volume(database),
        windows_volume(r"\\?\c:\Users\me\OneDrive\backups")
    );
    assert_ne!(windows_volume(database), windows_volume(r"\\?\E:\backups"));
    assert_eq!(
        windows_volume(r"\\?\UNC\Server\Share\backups"),
        windows_volume(r"\\SERVER\share\other")
    );
    assert_ne!(
        windows_volume(r"\\server\share\backups"),
        windows_volume(r"\\server\other\backups")
    );
    assert_eq!(windows_volume("relative"), None);
}

#[test]
fn onedrive_folder_match_respects_folder_boundaries() {
    let onedrive = r"C:\Users\me\OneDrive";
    assert!(is_within_windows_folder(
        r"\\?\C:\Users\me\OneDrive\Desktop\myLFR backups",
        onedrive
    ));
    assert!(is_within_windows_folder(r"c:\users\me\onedrive", onedrive));
    assert!(is_within_windows_folder(
        r"C:\Users\me\OneDrive\backups",
        r"C:\Users\me\OneDrive\"
    ));
    assert!(!is_within_windows_folder(
        r"C:\Users\me\OneDrive - Old\backups",
        onedrive
    ));
    assert!(!is_within_windows_folder(
        r"C:\Users\me\Documents",
        onedrive
    ));
    assert!(!is_within_windows_folder(r"C:\anything", ""));
}
