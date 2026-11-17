use std::io::{Read, Write};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use crate::backup;
use crate::db::{
    CURRENT_SCHEMA_VERSION, Database, FISHING_YEAR_DEFAULT_MIGRATION, INITIAL_MIGRATION,
    MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_MIGRATIONS,
};
use crate::error::AppError;
use crate::models::{
    BusinessProfileInput, CatalogueDocument, CatalogueRecord, FisherInput, LandingInput,
    LandingItemInput, UserFishstockInput, VesselInput,
};
use crate::reminder::{is_update_reminder_due, local_date_of, reminder_date};
use crate::updates::{
    UpdateMode, dismiss_update_reminder, is_app_update_check_due, read_update_status,
    record_app_update_check, set_update_mode, update_status,
};
use crate::validation;

fn seed() -> CatalogueDocument {
    catalogue(
        1,
        vec![
            CatalogueRecord {
                code: "BCO1".to_owned(),
                description: "Blue Cod Auckland (East)".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
            CatalogueRecord {
                code: "BCOET".to_owned(),
                description: "Blue Cod Extra Territorial (200 mile limit)".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
            CatalogueRecord {
                code: "HOK1".to_owned(),
                description: "Hoki".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
            CatalogueRecord {
                code: "SNA1".to_owned(),
                description: "Snapper Auckland (East)".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
            CatalogueRecord {
                code: "SNA2".to_owned(),
                description: "Snapper Central (East)".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
            CatalogueRecord {
                code: "SNAET".to_owned(),
                description: "Snapper Extra Territorial (200 mile limit)".to_owned(),
                reporting_unit: "greenweightKg".to_owned(),
                is_active: true,
            },
        ],
    )
}

fn catalogue(version: u32, records: Vec<CatalogueRecord>) -> CatalogueDocument {
    let records_sha256 = hex::encode(Sha256::digest(serde_json::to_vec(&records).unwrap()));
    CatalogueDocument {
        schema_version: 2,
        catalogue_version: version,
        generated_at: "2026-08-09T00:00:00Z".to_owned(),
        source: "test".to_owned(),
        records_sha256,
        records,
    }
}

fn open_database(directory: &TempDir) -> Database {
    Database::open(directory.path().join("mylfr.sqlite3"), &seed()).unwrap()
}

fn catalogue_version(database: &Database) -> i64 {
    database
        .connection()
        .query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn create_database_at_schema(path: &std::path::Path, schema_version: i64) {
    assert!((MIN_SUPPORTED_SCHEMA_VERSION..=CURRENT_SCHEMA_VERSION).contains(&schema_version));
    let connection = rusqlite::Connection::open(path).unwrap();
    for &(migration_version, sql) in SCHEMA_MIGRATIONS {
        if migration_version > schema_version {
            break;
        }
        connection.execute_batch(sql).unwrap();
        connection
            .pragma_update(None, "user_version", migration_version)
            .unwrap();
    }
    connection
        .pragma_update(None, "application_id", 0x4D4C4652_i64)
        .unwrap();
}

fn write_schema_backup(
    database_path: &std::path::Path,
    backup_path: &std::path::Path,
    application_version: &str,
) {
    let database_bytes = std::fs::read(database_path).unwrap();
    let connection = rusqlite::Connection::open(database_path).unwrap();
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let catalogue_version: i64 = connection
        .query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    drop(connection);

    let manifest = serde_json::json!({
        "formatVersion": backup::BACKUP_FORMAT_VERSION,
        "createdAt": "2026-08-28T00:00:00Z",
        "applicationVersion": application_version,
        "schemaVersion": schema_version,
        "catalogueVersion": catalogue_version,
        "databaseSha256": hex::encode(Sha256::digest(&database_bytes)),
        "databaseSize": database_bytes.len(),
    });
    let mut writer = zip::ZipWriter::new(std::fs::File::create(backup_path).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("manifest.json", options).unwrap();
    writer
        .write_all(&serde_json::to_vec_pretty(&manifest).unwrap())
        .unwrap();
    writer.start_file("mylfr.sqlite3", options).unwrap();
    writer.write_all(&database_bytes).unwrap();
    writer.finish().unwrap();
}

/// `Some(true)` active, `Some(false)` retired, `None` absent from the table.
fn fishstock_active(database: &Database, code: &str) -> Option<bool> {
    database
        .connection()
        .query_row(
            "SELECT is_active FROM fishstock_codes WHERE code = ?1",
            [code],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .unwrap()
}

fn fisher(database: &mut Database, permit_number: &str) -> crate::models::Fisher {
    let registration = (1234 + database.list_fishers(true).unwrap().len()).to_string();
    database
        .upsert_fisher(FisherInput {
            id: None,
            name: "Harbour Fishing Ltd".to_owned(),
            permit_number: permit_number.to_owned(),
            vessels: vec![VesselInput {
                id: None,
                name: "Southern Star".to_owned(),
                vessel_number: registration,
                is_archived: false,
                link_existing: false,
            }],
        })
        .unwrap()
}

#[test]
fn reopening_never_applies_a_bundled_catalogue_to_an_existing_database() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("mylfr.sqlite3");
    {
        let mut database = Database::open(&path, &seed()).unwrap();
        database.add_user_fishstock(user_stock("NEW1", 9)).unwrap();
    }

    // A later build bundles a newer catalogue that drops HOK1 and adds TAR1.
    // The official list is frozen, so it must not be applied: doing so would
    // also switch off every stock the receiver added.
    let bundled = catalogue(
        2,
        vec![CatalogueRecord {
            code: "TAR1".to_owned(),
            description: "Tarakihi Auckland (East)".to_owned(),
            reporting_unit: "greenweightKg".to_owned(),
            is_active: true,
        }],
    );
    let database = Database::open(&path, &bundled).unwrap();
    assert_eq!(catalogue_version(&database), 1);
    assert_eq!(fishstock_active(&database, "HOK1"), Some(true));
    assert_eq!(fishstock_active(&database, "TAR1"), None);
    assert_eq!(fishstock_active(&database, "NEW1"), Some(true));
}

fn user_stock(code: &str, fishing_year_start_month: i64) -> UserFishstockInput {
    UserFishstockInput {
        code: code.to_owned(),
        description: format!("Receiver stock {code}"),
        reporting_unit: "greenweightKg".to_owned(),
        fishing_year_start_month,
    }
}

fn landing_with(
    database: &mut Database,
    fisher_id: &str,
    date: &str,
    code: &str,
    quantity: i64,
) -> crate::models::Landing {
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher_id.to_owned(),
            vessel_id: None,
            landing_date: date.to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: code.to_owned(),
                quantity,
            }],
        })
        .unwrap()
}

#[test]
fn receivers_can_add_fishstocks_but_the_official_list_is_read_only() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);

    let added = database
        .add_user_fishstock(UserFishstockInput {
            code: " sna11 ".to_owned(),
            description: " Snapper typo ".to_owned(),
            reporting_unit: "greenweightKg".to_owned(),
            fishing_year_start_month: 9,
        })
        .unwrap();
    assert_eq!(added.code, "SNA11");
    assert_eq!(added.description, "Snapper typo");
    assert_eq!(added.landing_count, 0);
    assert_eq!(database.list_user_fishstocks().unwrap(), vec![added]);
    let found = database.search_fishstocks("SNA11", 5).unwrap();
    assert!(found[0].is_user_added);
    assert!(
        !database.search_fishstocks("SNA1", 5).unwrap()[0].is_user_added,
        "an exact official match still ranks first and is not receiver-added"
    );

    // A code already in the list is refused, whether official or receiver-added.
    for code in ["sna1", "SNA11"] {
        assert!(matches!(
            database.add_user_fishstock(user_stock(code, 9)),
            Err(AppError::Conflict(_))
        ));
    }
    assert!(
        database.add_user_fishstock(user_stock("BAD1", 5)).is_err(),
        "the fishing year must be February, April, or October"
    );
    let mut wrong_unit = user_stock("BAD2", 9);
    wrong_unit.reporting_unit = "tonnes".to_owned();
    assert!(database.add_user_fishstock(wrong_unit).is_err());
    assert!(database.add_user_fishstock(user_stock("BAD 3", 9)).is_err());

    // Official stocks can be neither edited nor removed.
    assert!(
        database
            .update_user_fishstock("SNA1", user_stock("SNA1", 9))
            .is_err()
    );
    assert!(database.remove_user_fishstock("SNA1").is_err());
    assert_eq!(fishstock_active(&database, "SNA1"), Some(true));
}

#[test]
fn a_receiver_fishstock_locks_its_code_and_unit_once_a_landing_uses_it() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database.add_user_fishstock(user_stock("XYZ1", 9)).unwrap();
    database.set_fishstock_favorite("XYZ1", true).unwrap();

    // Unused: everything can change, and the favourite follows the new code.
    let renamed = database
        .update_user_fishstock(
            "XYZ1",
            UserFishstockInput {
                code: "XYZ2".to_owned(),
                description: "Corrected".to_owned(),
                reporting_unit: "count".to_owned(),
                fishing_year_start_month: 3,
            },
        )
        .unwrap();
    assert_eq!(renamed.code, "XYZ2");
    assert_eq!(renamed.reporting_unit, "count");
    assert!(renamed.is_favorite);
    assert_eq!(fishstock_active(&database, "XYZ1"), None);
    assert!(
        database
            .update_user_fishstock("XYZ2", user_stock("SNA1", 9))
            .is_err(),
        "a code cannot be renamed onto one already in the list"
    );

    let permit_holder = fisher(&mut database, "USER-001");
    let landing = landing_with(&mut database, &permit_holder.id, "2026-06-01", "XYZ2", 5);

    // Used: the code and unit are locked; the name and year are not.
    let mut new_code = user_stock("XYZ3", 3);
    new_code.description = "Corrected".to_owned();
    new_code.reporting_unit = "count".to_owned();
    assert!(database.update_user_fishstock("XYZ2", new_code).is_err());
    let mut new_unit = user_stock("XYZ2", 3);
    new_unit.description = "Corrected".to_owned();
    assert!(database.update_user_fishstock("XYZ2", new_unit).is_err());
    let updated = database
        .update_user_fishstock(
            "XYZ2",
            UserFishstockInput {
                code: "XYZ2".to_owned(),
                description: "Renamed again".to_owned(),
                reporting_unit: "count".to_owned(),
                fishing_year_start_month: 9,
            },
        )
        .unwrap();
    assert_eq!(updated.landing_count, 1);
    assert_eq!(updated.fishing_year_start_month, 9);
    let saved = database.get_landing(&landing.id).unwrap();
    assert_eq!(saved.items[0].fishstock_code, "XYZ2");
    assert_eq!(saved.items[0].description, "Renamed again");
    assert_eq!(saved.items[0].quantity, 5);

    // Used stocks cannot be removed; once nothing uses them, they can.
    assert!(database.remove_user_fishstock("XYZ2").is_err());
    database.delete_landing(&landing.id).unwrap();
    database.remove_user_fishstock("XYZ2").unwrap();
    assert_eq!(fishstock_active(&database, "XYZ2"), None);
    assert!(database.list_favorite_fishstocks().unwrap().is_empty());
}

#[test]
fn receiver_fishstocks_count_in_the_fishing_year_the_receiver_chose() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    // CRA would be an April-year prefix for a catalogue stock. The receiver's
    // choice wins for a stock they added.
    database.add_user_fishstock(user_stock("CRA99", 9)).unwrap();
    database.add_user_fishstock(user_stock("NEW1", 1)).unwrap();
    let permit_holder = fisher(&mut database, "FY-USER");
    landing_with(&mut database, &permit_holder.id, "2026-06-01", "CRA99", 100);
    landing_with(&mut database, &permit_holder.id, "2026-06-02", "NEW1", 300);

    let october = database
        .dashboard_metrics("2025-10-01", "2026-09-30", 9)
        .unwrap();
    let april = database
        .dashboard_metrics("2026-04-01", "2027-03-31", 3)
        .unwrap();
    let february = database
        .dashboard_metrics("2026-02-01", "2027-01-31", 1)
        .unwrap();
    assert_eq!(october.unit_totals[0].quantity, 100);
    assert!(april.unit_totals.is_empty());
    assert_eq!(february.unit_totals[0].quantity, 300);

    // Correcting the year moves the totals without touching the landing.
    database
        .update_user_fishstock("CRA99", user_stock("CRA99", 3))
        .unwrap();
    let april = database
        .dashboard_metrics("2026-04-01", "2027-03-31", 3)
        .unwrap();
    assert_eq!(april.unit_totals[0].quantity, 100);
}

#[test]
fn landings_can_be_filtered_by_exact_fishstock_code() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database.add_user_fishstock(user_stock("SNA11", 9)).unwrap();
    let permit_holder = fisher(&mut database, "FILTER-001");
    let snapper = landing_with(&mut database, &permit_holder.id, "2026-06-01", "SNA1", 10);
    let typo = landing_with(&mut database, &permit_holder.id, "2026-06-02", "SNA11", 20);
    landing_with(&mut database, &permit_holder.id, "2026-06-03", "HOK1", 30);

    let filtered = |code: &str| -> Vec<String> {
        database
            .list_landings(crate::models::LandingFilters {
                fishstock_code: Some(code.to_owned()),
                ..Default::default()
            })
            .unwrap()
            .into_iter()
            .map(|landing| landing.id)
            .collect()
    };
    assert_eq!(filtered(" sna1 "), vec![snapper.id]);
    assert_eq!(filtered("SNA11"), vec![typo.id]);
    assert!(filtered("TAR1").is_empty());
    assert!(
        database
            .list_landings(crate::models::LandingFilters {
                fishstock_code: Some("not valid!".to_owned()),
                ..Default::default()
            })
            .is_err()
    );
}

#[test]
fn landings_can_be_filtered_by_part_of_the_invoice_number() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let permit_holder = fisher(&mut database, "INVOICE-001");
    let with_invoice = |database: &mut Database, date: &str, invoice: Option<&str>| {
        database
            .save_landing(LandingInput {
                id: None,
                fisher_id: permit_holder.id.clone(),
                vessel_id: None,
                landing_date: date.to_owned(),
                invoice_number: invoice.map(str::to_owned),
                items: vec![LandingItemInput {
                    fishstock_code: "SNA1".to_owned(),
                    quantity: 10,
                }],
            })
            .unwrap()
            .id
    };
    let first = with_invoice(&mut database, "2026-06-01", Some("INV-0042"));
    let second = with_invoice(&mut database, "2026-06-02", Some("INV-0142"));
    let percent = with_invoice(&mut database, "2026-06-03", Some("50%_off"));
    let none = with_invoice(&mut database, "2026-06-04", None);

    let filtered = |text: &str| -> Vec<String> {
        let mut ids = database
            .list_landings(crate::models::LandingFilters {
                invoice_number: Some(text.to_owned()),
                ..Default::default()
            })
            .unwrap()
            .into_iter()
            .map(|landing| landing.id)
            .collect::<Vec<_>>();
        ids.sort();
        ids
    };
    let sorted = |mut ids: Vec<String>| {
        ids.sort();
        ids
    };
    // Part of the number matches, in any case, and surrounding spaces are ignored.
    assert_eq!(filtered(" inv-0042 "), vec![first.clone()]);
    assert_eq!(filtered("42"), sorted(vec![first.clone(), second.clone()]));
    assert!(filtered("999").is_empty());
    // `%` and `_` are ordinary characters, not wildcards.
    assert_eq!(filtered("%"), vec![percent.clone()]);
    assert_eq!(filtered("0_42"), Vec::<String>::new());
    assert_eq!(filtered("0%2"), Vec::<String>::new());
    // A blank search is no search, and landings without an invoice number stay in it.
    let everything = filtered("  ");
    assert_eq!(everything, sorted(vec![first, second, percent, none]));
}

#[test]
fn restore_keeps_receiver_fishstocks_and_rejects_invalid_ones() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database.add_user_fishstock(user_stock("NEW1", 3)).unwrap();
    let permit_holder = fisher(&mut database, "RESTORE-USER");
    let landing = landing_with(&mut database, &permit_holder.id, "2026-06-01", "NEW1", 40);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.8.0").unwrap();

    database.delete_landing(&landing.id).unwrap();
    database.remove_user_fishstock("NEW1").unwrap();
    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
    let restored = database.list_user_fishstocks().unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].code, "NEW1");
    assert_eq!(restored[0].fishing_year_start_month, 3);
    assert_eq!(restored[0].landing_count, 1);
    assert_eq!(fishstock_active(&database, "NEW1"), Some(true));

    // A tampered backup whose receiver stock breaks the rules is refused, and
    // the live database is left as it was.
    let tampered = backups.path().join("tampered.mylfr-backup");
    rewrite_backup_database(&backup_path, &tampered, |connection| {
        connection
            .execute(
                "UPDATE fishstock_codes SET description = '   ' WHERE code = 'NEW1'",
                [],
            )
            .unwrap();
    });
    let error = backup::restore_backup(&mut database, &tampered, &seed()).unwrap_err();
    assert!(
        error.to_string().contains("fishstock that is not valid"),
        "{error}"
    );
    assert_eq!(
        database.list_user_fishstocks().unwrap()[0].description,
        "Receiver stock NEW1"
    );

    // A receiver stock claiming an official code becomes the official stock.
    let shadowing = backups.path().join("shadowing.mylfr-backup");
    rewrite_backup_database(&backup_path, &shadowing, |connection| {
        connection
            .execute(
                "UPDATE fishstock_codes
                 SET is_user_added = 1, fishing_year_start_month = 3, description = 'Fake'
                 WHERE code = 'SNA1'",
                [],
            )
            .unwrap();
    });
    backup::restore_backup(&mut database, &shadowing, &seed()).unwrap();
    let snapper = database.search_fishstocks("SNA1", 1).unwrap();
    assert!(!snapper[0].is_user_added);
    assert_eq!(snapper[0].description, "Snapper Auckland (East)");
}

#[test]
fn the_shipped_catalogue_passes_its_checksum_and_seeds_every_stock() {
    // The records checksum was written by the Node.js exporter, so this checks
    // the Rust SHA-256 and JSON serialisation against an independent
    // implementation, not against themselves.
    let shipped =
        crate::catalogue::parse_seed(include_str!("../resources/fishstock-catalogue.json"))
            .unwrap();
    let directory = TempDir::new().unwrap();
    let database = Database::open(directory.path().join("mylfr.sqlite3"), &shipped).unwrap();
    let stocks: i64 = database
        .connection()
        .query_row("SELECT count(*) FROM fishstock_codes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stocks, shipped.records.len() as i64);
    assert_eq!(stocks, 12_256);
}

#[test]
fn sha256_matches_the_published_test_vector() {
    // FIPS 180-2 example "abc". Backup checksums depend on this staying exact
    // across sha2 upgrades.
    assert_eq!(
        hex::encode(Sha256::digest(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn migrations_seed_catalogue_and_enforce_normalized_permit_numbers() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(database.get_fishing_year_start_month().unwrap(), 9);
    assert_eq!(database.set_fishing_year_start_month(3).unwrap(), 3);
    assert!(database.set_fishing_year_start_month(10).is_err());
    assert_eq!(database.search_fishstocks("hoki", 10).unwrap().len(), 1);

    fisher(&mut database, "ABC 123");
    let duplicate = database.upsert_fisher(FisherInput {
        id: None,
        name: "Duplicate".to_owned(),
        permit_number: " abc123 ".to_owned(),
        vessels: vec![],
    });
    assert!(duplicate.is_err());
}

#[test]
fn permit_holders_sort_alphabetically_regardless_of_archive_status() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    for (name, archived) in [
        ("Zulu Fishing", true),
        ("middle Fishing", false),
        ("alpha Fishing", true),
        ("Bravo Fishing", false),
    ] {
        let holder = database
            .upsert_fisher(FisherInput {
                id: None,
                name: name.to_owned(),
                permit_number: name.to_owned(),
                vessels: vec![],
            })
            .unwrap();
        if archived {
            database.set_fisher_archived(&holder.id, true).unwrap();
        }
    }
    let holders = database.list_fishers(true).unwrap();
    assert_eq!(
        holders
            .iter()
            .map(|holder| holder.name.as_str())
            .collect::<Vec<_>>(),
        [
            "alpha Fishing",
            "Bravo Fishing",
            "middle Fishing",
            "Zulu Fishing"
        ]
    );
    assert!(holders[0].is_archived);
    assert!(!holders[1].is_archived);
    assert_eq!(
        database
            .list_fishers(false)
            .unwrap()
            .iter()
            .map(|holder| holder.name.as_str())
            .collect::<Vec<_>>(),
        ["Bravo Fishing", "middle Fishing"]
    );
}

#[test]
fn vessels_sort_alphabetically_regardless_of_archive_status() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let holder = database
        .upsert_fisher(FisherInput {
            id: None,
            name: "Vessel sorting".to_owned(),
            permit_number: "SORT-001".to_owned(),
            vessels: [
                ("Zulu", true),
                ("middle", false),
                ("alpha", true),
                ("Bravo", false),
            ]
            .into_iter()
            .enumerate()
            .map(|(index, (name, archived))| VesselInput {
                id: None,
                name: name.to_owned(),
                vessel_number: (1000 + index).to_string(),
                is_archived: archived,
                link_existing: false,
            })
            .collect(),
        })
        .unwrap();
    let vessels = database.list_vessels(&holder.id).unwrap();
    assert_eq!(
        vessels
            .iter()
            .map(|vessel| vessel.name.as_str())
            .collect::<Vec<_>>(),
        ["alpha", "Bravo", "middle", "Zulu"]
    );
    assert_eq!(
        vessels
            .iter()
            .filter(|vessel| !vessel.is_archived)
            .map(|vessel| vessel.name.as_str())
            .collect::<Vec<_>>(),
        ["Bravo", "middle"]
    );
    assert_eq!(holder.vessels, vessels);
    assert_eq!(database.list_fishers(false).unwrap()[0].vessels, vessels);
}

#[test]
fn dashboard_metrics_respect_each_fishing_year_stock_group() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let mut records = seed().records;
    records.extend([
        CatalogueRecord {
            code: "CRA1".to_owned(),
            description: "Rock lobster".to_owned(),
            reporting_unit: "greenweightKg".to_owned(),
            is_active: true,
        },
        CatalogueRecord {
            code: "LFE13".to_owned(),
            description: "Longfin eel Lake Ellesmere".to_owned(),
            reporting_unit: "greenweightKg".to_owned(),
            is_active: true,
        },
    ]);
    database
        .apply_catalogue_document(&catalogue(2, records), false)
        .unwrap();
    let permit_holder = fisher(&mut database, "FY-001");
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: permit_holder.id,
            vessel_id: None,
            landing_date: "2026-06-01".to_owned(),
            invoice_number: None,
            items: vec![
                LandingItemInput {
                    fishstock_code: "HOK1".to_owned(),
                    quantity: 100,
                },
                LandingItemInput {
                    fishstock_code: "CRA1".to_owned(),
                    quantity: 200,
                },
                LandingItemInput {
                    fishstock_code: "LFE13".to_owned(),
                    quantity: 300,
                },
            ],
        })
        .unwrap();

    let october = database
        .dashboard_metrics("2025-10-01", "2026-09-30", 9)
        .unwrap();
    let april = database
        .dashboard_metrics("2026-04-01", "2027-03-31", 3)
        .unwrap();
    let february = database
        .dashboard_metrics("2026-02-01", "2027-01-31", 1)
        .unwrap();

    assert_eq!(october.unit_totals[0].quantity, 100);
    assert_eq!(april.unit_totals[0].quantity, 200);
    assert_eq!(february.unit_totals[0].quantity, 300);
    assert_eq!(october.landing_count, 1);
    assert_eq!(april.fishstock_count, 1);
}

#[test]
fn dashboard_metrics_put_every_scallop_stock_in_the_april_fishing_year() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let mut records = seed().records;
    records.extend(
        ["SCA1", "SCA3", "SCA7A", "SCACS"].map(|code| CatalogueRecord {
            code: code.to_owned(),
            description: format!("Scallop {code}"),
            reporting_unit: "greenweightKg".to_owned(),
            is_active: true,
        }),
    );
    database
        .apply_catalogue_document(&catalogue(2, records), false)
        .unwrap();
    let permit_holder = fisher(&mut database, "SCA-001");
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: permit_holder.id,
            vessel_id: None,
            landing_date: "2026-06-01".to_owned(),
            invoice_number: None,
            items: vec![
                // SCA1 and SCA7 were already April stocks; the area-suffixed and
                // Coromandel codes are the ones that used to fall through to October.
                LandingItemInput {
                    fishstock_code: "SCA1".to_owned(),
                    quantity: 100,
                },
                LandingItemInput {
                    fishstock_code: "SCA3".to_owned(),
                    quantity: 200,
                },
                LandingItemInput {
                    fishstock_code: "SCA7A".to_owned(),
                    quantity: 300,
                },
                LandingItemInput {
                    fishstock_code: "SCACS".to_owned(),
                    quantity: 400,
                },
                LandingItemInput {
                    fishstock_code: "HOK1".to_owned(),
                    quantity: 500,
                },
            ],
        })
        .unwrap();

    let april = database
        .dashboard_metrics("2026-04-01", "2027-03-31", 3)
        .unwrap();
    assert_eq!(april.fishstock_count, 4);
    assert_eq!(april.unit_totals[0].quantity, 1000);

    // Only the hoki belongs to the October year.
    let october = database
        .dashboard_metrics("2025-10-01", "2026-09-30", 9)
        .unwrap();
    assert_eq!(october.fishstock_count, 1);
    assert_eq!(october.unit_totals[0].quantity, 500);
}

#[test]
fn landing_items_and_reports_preserve_non_greenweight_units() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let mut records = seed().records;
    records.extend([
        CatalogueRecord {
            code: "SCA1".to_owned(),
            description: "Scallop".to_owned(),
            reporting_unit: "meatweightKg".to_owned(),
            is_active: true,
        },
        CatalogueRecord {
            code: "OYU5".to_owned(),
            description: "Foveaux Strait dredge oyster".to_owned(),
            reporting_unit: "count".to_owned(),
            is_active: true,
        },
    ]);
    database
        .apply_catalogue_document(&catalogue(2, records), false)
        .unwrap();
    let permit_holder = fisher(&mut database, "UNITS-001");
    let landing = database
        .save_landing(LandingInput {
            id: None,
            fisher_id: permit_holder.id,
            vessel_id: None,
            landing_date: "2026-08-20".to_owned(),
            invoice_number: None,
            items: vec![
                LandingItemInput {
                    fishstock_code: "SCA1".to_owned(),
                    quantity: 125,
                },
                LandingItemInput {
                    fishstock_code: "OYU5".to_owned(),
                    quantity: 7,
                },
            ],
        })
        .unwrap();
    assert_eq!(landing.items[0].reporting_unit, "meatweightKg");
    assert_eq!(landing.items[1].reporting_unit, "count");
    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.rows[0].reporting_unit, "count");
    assert_eq!(report.rows[0].quantity, 7);
    assert_eq!(report.rows[1].reporting_unit, "meatweightKg");
    assert_eq!(report.rows[1].quantity, 125);
    assert_eq!(report.unit_totals.len(), 2);
    assert_eq!(report.unit_totals[0].reporting_unit, "meatweightKg");
    assert_eq!(report.unit_totals[1].reporting_unit, "count");
}

#[test]
fn dashboard_permit_holders_and_vessels_need_activity_in_the_selected_fishing_year() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let mut records = seed().records;
    records.push(CatalogueRecord {
        code: "CRA1".to_owned(),
        description: "Rock lobster".to_owned(),
        reporting_unit: "greenweightKg".to_owned(),
        is_active: true,
    });
    database
        .apply_catalogue_document(&catalogue(2, records), false)
        .unwrap();

    let landed_in_window = fisher(&mut database, "FY-100");
    let landed_other_stock_group = fisher(&mut database, "FY-200");
    let never_landed = fisher(&mut database, "FY-300");
    let vessel = landed_in_window.vessels[0].id.clone();

    let mut land = |fisher_id: &str, vessel_id: Option<String>, date: &str, code: &str| {
        database
            .save_landing(LandingInput {
                id: None,
                fisher_id: fisher_id.to_owned(),
                vessel_id,
                landing_date: date.to_owned(),
                invoice_number: None,
                items: vec![LandingItemInput {
                    fishstock_code: code.to_owned(),
                    quantity: 100,
                }],
            })
            .unwrap();
    };
    land(
        &landed_in_window.id,
        Some(vessel.clone()),
        "2026-06-01",
        "HOK1",
    );
    land(&landed_other_stock_group.id, None, "2026-06-01", "CRA1");
    // Same fisher and vessel, but in an earlier fishing year.
    land(&landed_in_window.id, Some(vessel), "2020-06-01", "HOK1");

    let october = database
        .dashboard_metrics("2025-10-01", "2026-09-30", 9)
        .unwrap();
    assert_eq!(october.active_fishers, 1);
    assert_eq!(october.active_vessels, 1);

    // The rock lobster landing belongs to the April year and carries no vessel.
    let april = database
        .dashboard_metrics("2026-04-01", "2027-03-31", 3)
        .unwrap();
    assert_eq!(april.active_fishers, 1);
    assert_eq!(april.active_vessels, 0);

    // A fishing year with no landings at all counts nobody, despite three fishers on file.
    let february = database
        .dashboard_metrics("2026-02-01", "2027-01-31", 1)
        .unwrap();
    assert_eq!(february.active_fishers, 0);
    assert_eq!(february.active_vessels, 0);
    assert!(!never_landed.id.is_empty());
}

#[test]
fn landing_years_are_distinct_descending_and_ignore_deleted_landings() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let permit_holder = fisher(&mut database, "YEARS-001");

    let save = |database: &mut Database, landing_date: &str| {
        database
            .save_landing(LandingInput {
                id: None,
                fisher_id: permit_holder.id.clone(),
                vessel_id: None,
                landing_date: landing_date.to_owned(),
                invoice_number: None,
                items: vec![LandingItemInput {
                    fishstock_code: "HOK1".to_owned(),
                    quantity: 100,
                }],
            })
            .unwrap()
    };

    save(&mut database, "2024-02-10");
    save(&mut database, "2024-11-20");
    let deleted = save(&mut database, "2026-01-05");
    assert_eq!(database.list_landing_years().unwrap(), vec![2026, 2024]);

    database.delete_landing(&deleted.id).unwrap();
    assert_eq!(database.list_landing_years().unwrap(), vec![2024]);
}

#[test]
fn vessel_numbers_are_required_at_the_database_boundary() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "VESSEL-REQUIRED");
    let result = database.upsert_vessel(
        &fisher.id,
        VesselInput {
            id: None,
            name: "Missing Number".to_owned(),
            vessel_number: "  ".to_owned(),
            is_archived: false,
            link_existing: false,
        },
    );
    assert!(result.is_err());
}

#[test]
fn reports_sort_fishstocks_a_to_z_and_include_vessel_breakdowns() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "REPORT-1");
    let vessel = &fisher.vessels[0];
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: Some(vessel.id.clone()),
            landing_date: "2026-08-10".to_owned(),
            invoice_number: None,
            items: vec![
                LandingItemInput {
                    fishstock_code: "SNA1".to_owned(),
                    quantity: 200,
                },
                LandingItemInput {
                    fishstock_code: "SNA2".to_owned(),
                    quantity: 300,
                },
                LandingItemInput {
                    fishstock_code: "HOK1".to_owned(),
                    quantity: 100,
                },
            ],
        })
        .unwrap();

    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.rows[0].fishstock_code, "HOK1");
    assert_eq!(report.rows[1].fishstock_code, "SNA1");
    assert_eq!(report.rows[2].fishstock_code, "SNA2");
    assert_eq!(report.fish_type_rows[1].fish_type, "SNA");
    assert_eq!(report.fish_type_rows[1].description, "Snapper");
    assert_eq!(report.fish_type_rows[1].fishstocks, ["SNA1", "SNA2"]);
    assert_eq!(report.fish_type_rows[1].quantity, 500);
    assert_eq!(report.fish_type_rows[1].landing_count, 1);
    assert_eq!(
        report.vessel_rows[0].vessel_name.as_deref(),
        Some("Southern Star")
    );
    assert_eq!(report.vessel_rows[0].vessel_number.as_deref(), Some("1234"));
    assert_eq!(report.vessel_rows[0].fishstock_code, "HOK1");
    assert_eq!(report.vessel_rows[1].fishstock_code, "SNA1");
    assert_eq!(report.vessel_fish_type_rows[1].fish_type, "SNA");
    assert_eq!(report.vessel_fish_type_rows[1].fishstocks, ["SNA1", "SNA2"]);
    assert_eq!(report.vessel_fish_type_rows[1].landing_count, 1);
}

#[test]
fn reports_preserve_multi_word_fish_type_names() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "REPORT-BLUE-COD");
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: None,
            landing_date: "2026-08-10".to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: "BCO1".to_owned(),
                quantity: 100,
            }],
        })
        .unwrap();

    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.fish_type_rows[0].fish_type, "BCO");
    assert_eq!(report.fish_type_rows[0].description, "Blue Cod");
    assert_eq!(report.fish_type_rows[0].fishstocks, ["BCO1"]);
}

#[test]
fn reports_preserve_unicode_fish_type_names_and_database_access() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "REPORT-UNICODE");
    database.add_user_fishstock(user_stock("ZZZET", 9)).unwrap();
    database.add_user_fishstock(user_stock("ZZZ1", 9)).unwrap();
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: Some(fisher.vessels[0].id.clone()),
            landing_date: "2026-08-10".to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: "ZZZ1".to_owned(),
                quantity: 1234,
            }],
        })
        .unwrap();
    let shared = std::sync::Mutex::new(database);

    for (description, expected) in [
        ("\u{212A} extra territorial", "\u{212A}"),
        (
            "\u{212A}\u{212A}é ExTrA TeRrItOrIaL (200 mile limit)",
            "\u{212A}\u{212A}é",
        ),
        ("\u{212A} ex territorial", "\u{212A}"),
        ("\u{0130}\u{0130} EX TERRITORIAL", "\u{0130}\u{0130}"),
        ("\u{023A}\u{023A} extra territorial", "\u{023A}\u{023A}"),
        (
            "\u{0130}\u{212A}\u{023A} ex territorial",
            "\u{0130}\u{212A}\u{023A}",
        ),
        ("🦈 Kōura EXTrA Territorial", "🦈 Kōura"),
        ("Éperlan Extra Territorial", "Éperlan"),
        ("I\u{0307} extra territorial", "I\u{0307}"),
        ("\u{10400} extra territorial", "\u{10400}"),
        ("\u{212A}  EXTRA TERRITORIAL", "\u{212A}"),
        ("Blue Cod extra territorial", "Blue Cod"),
        (
            "\u{212A} ex territorial early extra territorial later",
            "\u{212A} ex territorial early",
        ),
        ("\u{212A} without a marker", "ZZZ"),
    ] {
        {
            let mut database = shared.lock().unwrap();
            let mut stock = user_stock("ZZZET", 9);
            stock.description = description.to_owned();
            database.update_user_fishstock("ZZZET", stock).unwrap();
            let report = database.report(Default::default()).unwrap();
            assert_eq!(report.fish_type_rows.len(), 1);
            assert_eq!(
                report.fish_type_rows[0].description, expected,
                "{description}"
            );
            assert_eq!(report.fish_type_rows[0].fishstocks, ["ZZZ1"]);
            assert_eq!(report.fish_type_rows[0].quantity, 1234);
            assert_eq!(report.fish_type_rows[0].landing_count, 1);
            assert_eq!(report.vessel_fish_type_rows.len(), 1);
            assert_eq!(
                report.vessel_fish_type_rows[0].description, expected,
                "{description}"
            );
            assert_eq!(report.vessel_fish_type_rows[0].quantity, 1234);
            assert_eq!(
                report.vessel_fish_type_rows[0].vessel_id.as_deref(),
                Some(fisher.vessels[0].id.as_str())
            );
            // Individual-stock rows retain their own name, rather than the group name.
            assert_eq!(report.rows[0].description, "Receiver stock ZZZ1");
            assert_eq!(report.vessel_rows[0].description, "Receiver stock ZZZ1");
            assert_eq!(report.unit_totals[0].quantity, 1234);
        }
        // Reporting must leave the shared connection available for later commands.
        let database = shared.lock().unwrap();
        let stocks = database.list_user_fishstocks().unwrap();
        let territorial = stocks.iter().find(|stock| stock.code == "ZZZET").unwrap();
        assert_eq!(territorial.description, description);
        assert_eq!(territorial.landing_count, 0);
        assert_eq!(
            database.search_fishstocks("ZZZET", 10).unwrap()[0].description,
            description
        );
        assert_eq!(
            database.report(Default::default()).unwrap().fish_type_rows[0].description,
            expected
        );
    }
    let mut database = shared.lock().unwrap();
    landing_with(&mut database, &fisher.id, "2026-08-11", "ZZZ1", 100);
    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.fish_type_rows[0].quantity, 1334);
    assert_eq!(report.fish_type_rows[0].landing_count, 2);
}

#[test]
fn reports_preserve_unicode_fish_type_names_after_restore() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let mut stock = user_stock("ZZZET", 9);
    stock.description = "\u{212A}\u{212A}é EX TERRITORIAL".to_owned();
    database.add_user_fishstock(stock.clone()).unwrap();
    let fisher = fisher(&mut database, "RESTORE-UNICODE");
    landing_with(&mut database, &fisher.id, "2026-08-10", "ZZZET", 1234);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.8.0").unwrap();
    backup::validate_backup(&backup_path).unwrap();
    stock.description = "Changed after backup".to_owned();
    database.update_user_fishstock("ZZZET", stock).unwrap();

    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.fish_type_rows[0].description, "\u{212A}\u{212A}é");
    assert_eq!(
        report.vessel_fish_type_rows[0].description,
        "\u{212A}\u{212A}é"
    );
    assert_eq!(report.fish_type_rows[0].quantity, 1234);
    assert_eq!(
        database.list_user_fishstocks().unwrap()[0].description,
        "\u{212A}\u{212A}é EX TERRITORIAL"
    );
}

#[test]
fn migrations_complete_partial_version_zero_databases_and_reject_newer_schemas() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("partial.sqlite3");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute("CREATE TABLE partial_marker(value TEXT)", [])
        .unwrap();
    drop(connection);

    let database = Database::open(&path, &seed()).unwrap();
    assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    let marker_exists: bool = database
        .connection()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partial_marker')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(marker_exists);
    drop(database);
    Database::open(&path, &seed()).unwrap();

    let future_path = directory.path().join("future.sqlite3");
    let connection = rusqlite::Connection::open(&future_path).unwrap();
    connection.pragma_update(None, "user_version", 99).unwrap();
    drop(connection);
    assert!(Database::open(future_path, &seed()).is_err());
}

#[test]
fn schema_migration_ledger_is_contiguous_and_matches_the_current_version() {
    assert_eq!(SCHEMA_MIGRATIONS[0].0, MIN_SUPPORTED_SCHEMA_VERSION);
    assert_eq!(SCHEMA_MIGRATIONS.last().unwrap().0, CURRENT_SCHEMA_VERSION);
    for (index, &(migration_version, _)) in SCHEMA_MIGRATIONS.iter().enumerate() {
        assert_eq!(
            migration_version,
            MIN_SUPPORTED_SCHEMA_VERSION + index as i64
        );
    }
}

#[test]
fn every_supported_schema_migrates_forward_without_losing_business_data() {
    let directory = TempDir::new().unwrap();

    for schema_version in MIN_SUPPORTED_SCHEMA_VERSION..=CURRENT_SCHEMA_VERSION {
        let path = directory
            .path()
            .join(format!("schema-{schema_version}.sqlite3"));
        create_database_at_schema(&path, schema_version);
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO business_profile(
                    id, lfr_name, client_number, created_at, updated_at
                ) VALUES (1, ?1, ?2, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                rusqlite::params![
                    format!("Legacy schema {schema_version}"),
                    format!("LFR{schema_version}"),
                ],
            )
            .unwrap();
        insert_schema_vessel(&connection, schema_version);
        drop(connection);

        let database = Database::open(&path, &seed()).unwrap();
        assert_schema_vessel(&database, schema_version);
        assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        assert_eq!(
            database
                .get_business_profile()
                .unwrap()
                .unwrap()
                .client_number,
            format!("LFR{schema_version}")
        );
    }
}

/// Build a database the way builds before 2026-08-13 did, when the initial
/// migration still gave the fishing year column `DEFAULT 3`.
fn create_pre_august_13_database_at_schema(path: &std::path::Path, schema_version: i64) {
    let original_initial = INITIAL_MIGRATION.replace(
        "fishing_year_start_month INTEGER NOT NULL DEFAULT 9 CHECK",
        "fishing_year_start_month INTEGER NOT NULL DEFAULT 3 CHECK",
    );
    assert_ne!(original_initial, INITIAL_MIGRATION);
    let connection = rusqlite::Connection::open(path).unwrap();
    for &(migration_version, sql) in SCHEMA_MIGRATIONS {
        if migration_version > schema_version {
            break;
        }
        let sql = if migration_version == 1 {
            original_initial.as_str()
        } else {
            sql
        };
        connection.execute_batch(sql).unwrap();
        connection
            .pragma_update(None, "user_version", migration_version)
            .unwrap();
    }
    connection
        .pragma_update(None, "application_id", 0x4D4C4652_i64)
        .unwrap();
}

#[test]
fn databases_created_before_the_initial_migration_was_edited_restore_after_upgrading() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("pilot.sqlite3");
    // Schema 4 is what installed 0.7.0 pilots hold.
    create_pre_august_13_database_at_schema(&path, 4);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "INSERT INTO business_profile(id, lfr_name, client_number, created_at, updated_at)
             VALUES (1, 'Pilot LFR', 'PILOT-001', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z');
             UPDATE app_settings
             SET fishing_year_start_month = 3, last_app_update_check = '2026-09-01T00:00:00Z'
             WHERE id = 1;",
        )
        .unwrap();
    drop(connection);

    // Before the fix, its stored schema never matched, so its backups were
    // refused.
    let old_backup = directory.path().join("before.mylfr-backup");
    write_schema_backup(&path, &old_backup, "0.7.0");
    let error = backup::validate_backup(&old_backup).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("does not match the authoritative"),
        "{error}"
    );

    // Upgrading rebuilds the settings table and keeps every value.
    let mut database = Database::open(&path, &seed()).unwrap();
    assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(database.get_fishing_year_start_month().unwrap(), 3);
    assert_eq!(
        last_app_update_check(&database).as_deref(),
        Some("2026-09-01T00:00:00Z")
    );

    // Backups taken after the upgrade validate and restore.
    let backups = TempDir::new().unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let new_backup = backup::backup_now(&mut database, "0.8.0").unwrap();
    backup::validate_backup(&new_backup).unwrap();
    let target = TempDir::new().unwrap();
    let mut restored = Database::open(target.path().join("mylfr.sqlite3"), &seed()).unwrap();
    backup::restore_backup(&mut restored, &new_backup, &seed()).unwrap();
    assert_eq!(
        restored
            .get_business_profile()
            .unwrap()
            .unwrap()
            .client_number,
        "PILOT-001"
    );
    assert_eq!(restored.get_fishing_year_start_month().unwrap(), 3);
}

#[test]
fn failed_migration_keeps_the_database_at_the_last_committed_schema() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("migration-failure.sqlite3");
    create_database_at_schema(&path, 3);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute(
            "ALTER TABLE fishstock_codes ADD COLUMN reporting_unit TEXT",
            [],
        )
        .unwrap();
    drop(connection);

    assert!(Database::open(&path, &seed()).is_err());
    let connection = rusqlite::Connection::open(path).unwrap();
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(schema_version, 3);
}

#[test]
fn every_supported_schema_backup_validates_and_restores_into_the_current_schema() {
    let directory = TempDir::new().unwrap();

    for schema_version in MIN_SUPPORTED_SCHEMA_VERSION..=CURRENT_SCHEMA_VERSION {
        let source_directory = directory.path().join(format!("source-{schema_version}"));
        std::fs::create_dir_all(&source_directory).unwrap();
        let source_path = source_directory.join("mylfr.sqlite3");
        create_database_at_schema(&source_path, schema_version);
        let connection = rusqlite::Connection::open(&source_path).unwrap();
        connection
            .execute(
                "INSERT INTO business_profile(
                    id, lfr_name, client_number, created_at, updated_at
                ) VALUES (1, 'Backup LFR', ?1, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                [format!("BACKUP-{schema_version}")],
            )
            .unwrap();
        insert_schema_vessel(&connection, schema_version);
        drop(connection);

        let backup_path = directory
            .path()
            .join(format!("schema-{schema_version}.mylfr-backup"));
        write_schema_backup(&source_path, &backup_path, "0.5.0");
        assert_eq!(
            backup::validate_backup(&backup_path).unwrap(),
            (schema_version, 1)
        );

        let target_directory = directory.path().join(format!("target-{schema_version}"));
        std::fs::create_dir_all(&target_directory).unwrap();
        let mut database = Database::open(target_directory.join("mylfr.sqlite3"), &seed()).unwrap();
        backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
        assert_schema_vessel(&database, schema_version);
        assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        assert_eq!(
            database
                .get_business_profile()
                .unwrap()
                .unwrap()
                .client_number,
            format!("BACKUP-{schema_version}")
        );
    }
}

#[test]
fn catalogue_updates_are_transactional_mark_removed_codes_inactive_and_reject_downgrades() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let update = catalogue(
        2,
        vec![CatalogueRecord {
            code: "HOK1".to_owned(),
            description: "Hoki updated".to_owned(),
            reporting_unit: "greenweightKg".to_owned(),
            is_active: true,
        }],
    );
    database.apply_catalogue_document(&update, false).unwrap();
    let snapper_active: bool = database
        .connection()
        .query_row(
            "SELECT is_active FROM fishstock_codes WHERE code = 'SNA1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!snapper_active);
    assert!(database.apply_catalogue_document(&seed(), false).is_err());

    let mut corrupt = catalogue(3, update.records);
    corrupt.records_sha256 = "0".repeat(64);
    assert!(database.apply_catalogue_document(&corrupt, false).is_err());
    let version: i64 = database
        .connection()
        .query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, 2);
}

#[test]
fn landing_save_edit_and_delete_are_transactional_and_versioned() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "PERMIT-1");
    let vessel_id = fisher.vessels[0].id.clone();
    let landing = database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: Some(vessel_id.clone()),
            landing_date: "2026-08-08".to_owned(),
            invoice_number: Some("INV-1".to_owned()),
            items: vec![LandingItemInput {
                fishstock_code: "HOK1".to_owned(),
                quantity: 12_345,
            }],
        })
        .unwrap();
    assert_eq!(landing.items[0].quantity, 12_345);
    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.unit_totals[0].quantity, 12_345);
    assert!(database.remove_vessel(&fisher.id, &vessel_id).is_err());

    let edited = database
        .save_landing(LandingInput {
            id: Some(landing.id.clone()),
            fisher_id: fisher.id.clone(),
            vessel_id: landing.vessel_id,
            landing_date: "2026-08-09".to_owned(),
            invoice_number: Some("INV-2".to_owned()),
            items: vec![LandingItemInput {
                fishstock_code: "SNA1".to_owned(),
                quantity: 500,
            }],
        })
        .unwrap();
    assert_eq!(edited.items[0].fishstock_code, "SNA1");
    assert_eq!(
        database.list_landing_revisions(&landing.id).unwrap().len(),
        2
    );

    database.delete_landing(&landing.id).unwrap();
    assert!(database.get_landing(&landing.id).is_err());
    let revisions = database.list_landing_revisions(&landing.id).unwrap();
    assert_eq!(revisions.len(), 3);
    assert_eq!(revisions[2].operation, "delete");
    assert_eq!(revisions[2].items[0].quantity, 500);
    assert_eq!(database.list_deleted_landings(10).unwrap().len(), 1);
    assert!(database.remove_vessel(&fisher.id, &vessel_id).is_err());
    assert_eq!(revisions[2].vessel_name.as_deref(), Some("Southern Star"));
}

#[test]
fn previous_landing_fishstocks_use_the_latest_matching_fisher_and_vessel() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "PREVIOUS-1");
    let vessel_id = fisher.vessels[0].id.clone();
    let _older = database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: Some(vessel_id.clone()),
            landing_date: "2026-08-01".to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: "HOK1".to_owned(),
                quantity: 100,
            }],
        })
        .unwrap();
    let latest = database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: Some(vessel_id.clone()),
            landing_date: "2026-08-10".to_owned(),
            invoice_number: None,
            items: vec![
                LandingItemInput {
                    fishstock_code: "SNA1".to_owned(),
                    quantity: 200,
                },
                LandingItemInput {
                    fishstock_code: "SNA2".to_owned(),
                    quantity: 300,
                },
            ],
        })
        .unwrap();
    database
        .save_landing(LandingInput {
            id: None,
            fisher_id: fisher.id.clone(),
            vessel_id: None,
            landing_date: "2026-08-11".to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: "BCO1".to_owned(),
                quantity: 400,
            }],
        })
        .unwrap();

    let matching = database
        .list_previous_landing_fishstocks(&fisher.id, Some(&vessel_id), None)
        .unwrap();
    assert_eq!(
        matching
            .iter()
            .map(|stock| stock.code.as_str())
            .collect::<Vec<_>>(),
        ["SNA1", "SNA2"]
    );

    let before_latest = database
        .list_previous_landing_fishstocks(&fisher.id, Some(&vessel_id), Some(&latest.id))
        .unwrap();
    assert_eq!(before_latest[0].code, "HOK1");
    let shore_based = database
        .list_previous_landing_fishstocks(&fisher.id, None, None)
        .unwrap();
    assert_eq!(shore_based[0].code, "BCO1");
}

#[test]
fn invalid_landing_does_not_create_partial_data() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "PERMIT-2");
    let result = database.save_landing(LandingInput {
        id: None,
        fisher_id: fisher.id.clone(),
        vessel_id: Some("not-a-vessel".to_owned()),
        landing_date: "2026-08-09".to_owned(),
        invoice_number: None,
        items: vec![LandingItemInput {
            fishstock_code: "HOK1".to_owned(),
            quantity: 100,
        }],
    });
    assert!(result.is_err());
    let duplicate_items = database.save_landing(LandingInput {
        id: None,
        fisher_id: fisher.id.clone(),
        vessel_id: None,
        landing_date: "2026-08-09".to_owned(),
        invoice_number: None,
        items: vec![
            LandingItemInput {
                fishstock_code: "HOK1".to_owned(),
                quantity: 100,
            },
            LandingItemInput {
                fishstock_code: "HOK1".to_owned(),
                quantity: 200,
            },
        ],
    });
    assert!(duplicate_items.is_err());
    assert!(
        database
            .list_landings(Default::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn backup_restore_round_trip_recovers_business_data() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Original LFR".to_owned(),
            client_number: "LFR001".to_owned(),
            street_number: "1".to_owned(),
            street_name: "Harbour".to_owned(),
            street_type: "Road".to_owned(),
            suburb: "Port".to_owned(),
            city: "Nelson".to_owned(),
            postcode: "7010".to_owned(),
        })
        .unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.1.0").unwrap();
    backup::validate_backup(&backup_path).unwrap();
    let corrupt_path = backups.path().join("corrupt.mylfr-backup");
    let mut corrupt_bytes = std::fs::read(&backup_path).unwrap();
    corrupt_bytes.truncate(corrupt_bytes.len() / 2);
    std::fs::write(&corrupt_path, corrupt_bytes).unwrap();
    assert!(backup::validate_backup(&corrupt_path).is_err());

    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Changed LFR".to_owned(),
            client_number: "LFR002".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();
    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
    assert_eq!(
        database.get_business_profile().unwrap().unwrap().lfr_name,
        "Original LFR"
    );
    assert!(
        backup::backup_status(&database)
            .unwrap()
            .backup_directory
            .is_none()
    );
}

#[test]
fn security_restore_normalizes_untrusted_operational_and_catalogue_state() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let attacker_destination = TempDir::new().unwrap();
    let replacement_backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Original LFR".to_owned(),
            client_number: "LFR001".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();

    let mut newer_records = seed().records;
    newer_records.push(CatalogueRecord {
        code: "LEG1".to_owned(),
        description: "Historical-only stock".to_owned(),
        reporting_unit: "count".to_owned(),
        is_active: true,
    });
    database
        .apply_catalogue_document(&catalogue(2, newer_records), false)
        .unwrap();
    let permit_holder = fisher(&mut database, "RESTORE-001");
    let landing = database
        .save_landing(LandingInput {
            id: None,
            fisher_id: permit_holder.id,
            vessel_id: None,
            landing_date: "2026-08-24".to_owned(),
            invoice_number: None,
            items: vec![LandingItemInput {
                fishstock_code: "LEG1".to_owned(),
                quantity: 7,
            }],
        })
        .unwrap();

    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.6.0").unwrap();
    let crafted_path = backups.path().join("crafted-state.mylfr-backup");
    rewrite_backup_database(&backup_path, &crafted_path, |connection| {
        connection
            .execute(
                "UPDATE app_settings
                 SET backup_directory = ?1,
                     last_backup_at = '2000-01-01T00:00:00Z',
                     last_backup_path = ?2,
                     last_app_update_check = '9999-01-01T00:00:00Z',
                     last_catalogue_update_check = '9999-01-01T00:00:00Z',
                     catalogue_version = ?3
                 WHERE id = 1",
                rusqlite::params![
                    attacker_destination.path().display().to_string(),
                    attacker_destination
                        .path()
                        .join("exfiltrated.mylfr-backup")
                        .display()
                        .to_string(),
                    i64::MAX,
                ],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE fishstock_codes
                 SET description = 'Forged snapper', reporting_unit = 'count',
                     is_active = 1, catalogue_version = ?1
                 WHERE code = 'SNA1'",
                [i64::MAX],
            )
            .unwrap();
    });
    assert_eq!(
        backup::validate_backup(&crafted_path).unwrap(),
        (CURRENT_SCHEMA_VERSION, i64::MAX)
    );

    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Changed LFR".to_owned(),
            client_number: "LFR002".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();
    backup::restore_backup(&mut database, &crafted_path, &seed()).unwrap();

    assert_eq!(
        database.get_business_profile().unwrap().unwrap().lfr_name,
        "Original LFR"
    );
    let local_settings: (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = database
        .connection()
        .query_row(
            "SELECT backup_directory, last_backup_at, last_backup_path,
                    last_app_update_check, last_catalogue_update_check
             FROM app_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(local_settings, (None, None, None, None, None));
    assert_eq!(catalogue_version(&database), 1);

    let trusted_snapper: (String, String, bool) = database
        .connection()
        .query_row(
            "SELECT description, reporting_unit, is_active
             FROM fishstock_codes WHERE code = 'SNA1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        trusted_snapper,
        (
            "Snapper Auckland (East)".to_owned(),
            "greenweightKg".to_owned(),
            true,
        )
    );
    assert_eq!(fishstock_active(&database, "LEG1"), Some(false));
    let restored_landing = database.get_landing(&landing.id).unwrap();
    assert_eq!(restored_landing.items[0].quantity, 7);
    assert_eq!(restored_landing.items[0].reporting_unit, "count");

    let backup_error = backup::backup_now(&mut database, "0.6.0").unwrap_err();
    assert!(
        backup_error
            .to_string()
            .contains("Choose a backup directory")
    );
    assert!(
        std::fs::read_dir(attacker_destination.path())
            .unwrap()
            .next()
            .is_none()
    );

    database
        .apply_catalogue_document(&catalogue(2, seed().records), false)
        .unwrap();
    assert_eq!(catalogue_version(&database), 2);
    backup::set_backup_directory(&mut database, replacement_backups.path()).unwrap();
    assert!(
        backup::backup_status(&database)
            .unwrap()
            .destination_available
    );
}

#[test]
fn security_restore_normalization_failure_keeps_the_live_database_open() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Backup LFR".to_owned(),
            client_number: "LFR001".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.6.0").unwrap();
    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Live LFR".to_owned(),
            client_number: "LFR002".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();

    let mut invalid_seed = seed();
    invalid_seed.records_sha256 = "0".repeat(64);
    let error = backup::restore_backup(&mut database, &backup_path, &invalid_seed).unwrap_err();
    assert!(error.to_string().contains("checksum"));
    assert_eq!(
        database.get_business_profile().unwrap().unwrap().lfr_name,
        "Live LFR"
    );
}

#[test]
fn backup_validation_rejects_attacker_defined_schema_and_triggers() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.1.0").unwrap();

    for (name, sql) in [
        (
            "extra-table",
            "CREATE TABLE attacker_controlled(value TEXT);",
        ),
        (
            "extra-trigger",
            "CREATE TRIGGER attacker_controlled AFTER INSERT ON business_profile BEGIN DELETE FROM fishers; END;",
        ),
        ("wildcard-table", "CREATE TABLE sqliteX_table(value TEXT);"),
        (
            "wildcard-index",
            "CREATE INDEX sqliteX_index ON business_profile(client_number);",
        ),
        (
            "wildcard-view",
            "CREATE VIEW sqliteX_view AS SELECT * FROM business_profile;",
        ),
        (
            "wildcard-trigger",
            "CREATE TRIGGER sqliteX_trigger AFTER INSERT ON business_profile BEGIN DELETE FROM fishers; END;",
        ),
        (
            "uppercase-trigger",
            "CREATE TRIGGER SQLITEX_trigger AFTER INSERT ON business_profile BEGIN DELETE FROM fishers; END;",
        ),
        (
            "unicode-trigger",
            "CREATE TRIGGER \"sqlite☃trigger\" AFTER INSERT ON business_profile BEGIN DELETE FROM fishers; END;",
        ),
    ] {
        let crafted = backups.path().join(format!("{name}.mylfr-backup"));
        rewrite_backup_schema(&backup_path, &crafted, sql);
        let error = backup::validate_backup(&crafted).unwrap_err();
        assert!(
            error.to_string().contains("authoritative myLFR schema"),
            "{name}: {error}"
        );
    }

    backup::validate_backup(&backup_path).unwrap();
}

#[test]
fn backup_restore_rejects_hidden_triggers_without_changing_live_data() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let redirected = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    saved_profile(&mut database);
    let fisher = fisher(&mut database, "RESTORE-SAFETY");
    landing_with(&mut database, &fisher.id, "2026-08-09", "HOK1", 100);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.8.0").unwrap();

    // Live records newer than the backup must survive every rejected restore.
    landing_with(&mut database, &fisher.id, "2026-08-10", "SNA1", 200);
    let snapshot = |database: &Database| {
        let mut value = serde_json::to_value(database.full_export().unwrap()).unwrap();
        value.as_object_mut().unwrap().remove("exportedAt");
        value
    };
    let live_records = snapshot(&database);
    let live_status = backup::backup_status(&database).unwrap();
    let live_bytes = std::fs::read(database.path()).unwrap();
    let wal_path = database.path().with_extension("sqlite3-wal");
    let live_wal = std::fs::read(&wal_path).unwrap();
    let destination = redirected.path().to_string_lossy().replace('\'', "''");

    for (index, (name, target, body)) in [
        (
            "sqliteX_restore_route",
            "AFTER UPDATE OF backup_directory ON app_settings WHEN NEW.backup_directory IS NULL",
            format!("UPDATE app_settings SET backup_directory = '{destination}' WHERE id = 1;"),
        ),
        (
            "sqlite_restore_route",
            "AFTER UPDATE OF backup_directory ON app_settings WHEN NEW.backup_directory IS NULL",
            format!("UPDATE app_settings SET backup_directory = '{destination}' WHERE id = 1;"),
        ),
        (
            "sqlite_autoindex_forged",
            "BEFORE INSERT ON landing_revision_items",
            "SELECT RAISE(IGNORE);".to_owned(),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let crafted = backups.path().join(format!("hidden-{index}.mylfr-backup"));
        rewrite_backup_database(&backup_path, &crafted, |connection| {
            // A file author can forge reserved names; SQLite loads them on reopen.
            connection
                .execute_batch(&format!(
                    "CREATE TRIGGER payload_trigger {target} BEGIN {body} END;"
                ))
                .unwrap();
            connection
                .pragma_update(None, "writable_schema", "ON")
                .unwrap();
            connection
                .execute(
                    "UPDATE sqlite_schema
                     SET name = ?1, sql = replace(sql, 'payload_trigger', ?1)
                     WHERE type = 'trigger' AND name = 'payload_trigger'",
                    [name],
                )
                .unwrap();
            connection
                .pragma_update(None, "writable_schema", "OFF")
                .unwrap();
        });

        for error in [
            backup::validate_backup(&crafted).unwrap_err(),
            backup::restore_backup(&mut database, &crafted, &seed()).unwrap_err(),
        ] {
            assert!(
                error.to_string().contains("authoritative myLFR schema"),
                "{name}: {error}"
            );
        }
        assert_eq!(snapshot(&database), live_records, "{name}");
        assert_eq!(
            backup::backup_status(&database).unwrap(),
            live_status,
            "{name}"
        );
        assert_eq!(
            std::fs::read(database.path()).unwrap(),
            live_bytes,
            "{name}"
        );
        assert_eq!(std::fs::read(&wal_path).unwrap(), live_wal, "{name}");
        assert_eq!(std::fs::read_dir(redirected.path()).unwrap().count(), 0);
    }

    let landing = landing_with(&mut database, &fisher.id, "2026-08-11", "HOK1", 300);
    let revisions = database.list_landing_revisions(&landing.id).unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].items.len(), 1);
    assert_eq!(revisions[0].items[0].quantity, 300);
    let integrity: String = database
        .connection()
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    backup::validate_backup(&backup_path).unwrap();
}

#[test]
fn backup_validation_rejects_a_future_schema_version() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.6.0").unwrap();
    let future_path = backups.path().join("future-schema.mylfr-backup");
    rewrite_backup_manifest(
        &backup_path,
        &future_path,
        "schemaVersion",
        serde_json::Value::from(CURRENT_SCHEMA_VERSION + 1),
    );

    let error = backup::validate_backup(&future_path).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Backup schema version is incompatible")
    );
}

#[test]
fn backup_validation_rejects_a_mismatched_catalogue_version() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.6.0").unwrap();
    let mismatched_path = backups.path().join("mismatched-catalogue.mylfr-backup");
    rewrite_backup_manifest(
        &backup_path,
        &mismatched_path,
        "catalogueVersion",
        serde_json::Value::from(2),
    );

    let error = backup::validate_backup(&mismatched_path).unwrap_err();
    assert!(error.to_string().contains("catalogue version"));
}

fn rewrite_backup_schema(source: &std::path::Path, output: &std::path::Path, sql: &str) {
    rewrite_backup_database(source, output, |connection| {
        connection.execute_batch(sql).unwrap();
    });
}

fn rewrite_backup_database(
    source: &std::path::Path,
    output: &std::path::Path,
    rewrite: impl FnOnce(&rusqlite::Connection),
) {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(source).unwrap()).unwrap();
    let mut manifest_bytes = Vec::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_end(&mut manifest_bytes)
        .unwrap();
    let mut database_bytes = Vec::new();
    archive
        .by_name("mylfr.sqlite3")
        .unwrap()
        .read_to_end(&mut database_bytes)
        .unwrap();
    drop(archive);

    let database_path = output.with_extension("tampered.sqlite3");
    std::fs::write(&database_path, database_bytes).unwrap();
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    rewrite(&connection);
    let catalogue_version: i64 = connection
        .query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    drop(connection);
    let database_bytes = std::fs::read(&database_path).unwrap();

    let mut manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
    manifest["catalogueVersion"] = serde_json::Value::from(catalogue_version);
    manifest["databaseSha256"] =
        serde_json::Value::String(hex::encode(Sha256::digest(&database_bytes)));
    manifest["databaseSize"] = serde_json::Value::from(database_bytes.len() as u64);

    let mut writer = zip::ZipWriter::new(std::fs::File::create(output).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("manifest.json", options).unwrap();
    writer
        .write_all(&serde_json::to_vec_pretty(&manifest).unwrap())
        .unwrap();
    writer.start_file("mylfr.sqlite3", options).unwrap();
    writer.write_all(&database_bytes).unwrap();
    writer.finish().unwrap();
}

fn rewrite_backup_manifest(
    source: &std::path::Path,
    output: &std::path::Path,
    field: &str,
    value: serde_json::Value,
) {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(source).unwrap()).unwrap();
    let mut manifest_bytes = Vec::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_end(&mut manifest_bytes)
        .unwrap();
    let mut database_bytes = Vec::new();
    archive
        .by_name("mylfr.sqlite3")
        .unwrap()
        .read_to_end(&mut database_bytes)
        .unwrap();
    drop(archive);

    let mut manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
    manifest[field] = value;
    let mut writer = zip::ZipWriter::new(std::fs::File::create(output).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("manifest.json", options).unwrap();
    writer
        .write_all(&serde_json::to_vec_pretty(&manifest).unwrap())
        .unwrap();
    writer.start_file("mylfr.sqlite3", options).unwrap();
    writer.write_all(&database_bytes).unwrap();
    writer.finish().unwrap();
}

/// Minimal PNG header for logo tests. Validation reads only the signature and
/// the IHDR dimensions, so the pixel data does not need to be real.
fn logo_png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(&13_u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 2, 0, 0, 0]);
    bytes
}

fn saved_profile(database: &mut Database) {
    database
        .save_business_profile(BusinessProfileInput {
            lfr_name: "Logo LFR".to_owned(),
            client_number: "LFR900".to_owned(),
            street_number: String::new(),
            street_name: String::new(),
            street_type: String::new(),
            suburb: String::new(),
            city: String::new(),
            postcode: String::new(),
        })
        .unwrap();
}

#[test]
fn business_logo_round_trips_and_clears() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    saved_profile(&mut database);
    assert!(database.get_business_logo().unwrap().is_none());

    let png = logo_png(600, 180);
    let stored = database.set_business_logo(png.clone(), 600, 180).unwrap();
    assert_eq!(stored.width, 600);
    assert_eq!(stored.height, 180);
    assert_eq!(STANDARD.decode(stored.data_base64).unwrap(), png);

    database.clear_business_logo().unwrap();
    assert!(database.get_business_logo().unwrap().is_none());
}

#[test]
fn business_logo_requires_a_saved_profile() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let error = database
        .set_business_logo(logo_png(10, 10), 10, 10)
        .unwrap_err();
    assert!(error.to_string().contains("business details"));
}

#[test]
fn business_logo_storage_rejects_an_oversized_blob() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    saved_profile(&mut database);
    let mut png = logo_png(600, 180);
    png.resize(600 * 1024, 0);
    let error = database.set_business_logo(png, 600, 180).unwrap_err();
    assert!(error.to_string().contains("512 KB"));
}

#[test]
fn logo_validation_rejects_non_png_and_mismatched_dimensions() {
    validation::logo_png(&logo_png(600, 180), 600, 180).unwrap();

    let jpeg = [
        0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert!(
        validation::logo_png(&jpeg, 600, 180)
            .unwrap_err()
            .to_string()
            .contains("PNG")
    );

    assert!(
        validation::logo_png(&logo_png(600, 180), 400, 180)
            .unwrap_err()
            .to_string()
            .contains("do not match")
    );

    assert!(
        validation::logo_png(&logo_png(4000, 180), 4000, 180)
            .unwrap_err()
            .to_string()
            .contains("pixels")
    );

    let mut oversized = logo_png(600, 180);
    oversized.resize(600 * 1024, 0);
    assert!(
        validation::logo_png(&oversized, 600, 180)
            .unwrap_err()
            .to_string()
            .contains("512 KB")
    );
}

#[test]
fn logo_survives_a_backup_restore_round_trip() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    saved_profile(&mut database);
    database
        .set_business_logo(logo_png(600, 180), 600, 180)
        .unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.1.0").unwrap();
    backup::validate_backup(&backup_path).unwrap();

    database.clear_business_logo().unwrap();
    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();

    let restored = database.get_business_logo().unwrap().unwrap();
    assert_eq!(restored.width, 600);
    assert_eq!(restored.height, 180);
}

#[test]
fn existing_schema_two_databases_gain_logo_columns_without_losing_data() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("schema-two.sqlite3");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch(INITIAL_MIGRATION).unwrap();
    connection
        .execute_batch(FISHING_YEAR_DEFAULT_MIGRATION)
        .unwrap();
    connection
        .execute(
            "INSERT INTO business_profile(id, lfr_name, client_number, created_at, updated_at)
             VALUES (1, 'Legacy LFR', 'LFR001', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    connection
        .pragma_update(None, "user_version", 2_i64)
        .unwrap();
    drop(connection);

    let mut database = Database::open(&path, &seed()).unwrap();
    assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        database.get_business_profile().unwrap().unwrap().lfr_name,
        "Legacy LFR"
    );
    assert!(database.get_business_logo().unwrap().is_none());
    database
        .set_business_logo(logo_png(600, 180), 600, 180)
        .unwrap();
    assert!(database.get_business_logo().unwrap().is_some());
}

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
}

#[test]
fn the_reminder_falls_on_the_first_monday_after_the_fifteenth() {
    // 15 June 2026 is a Monday. The 15th is licensed fish receiver return day,
    // so the reminder must skip it entirely and wait a full week.
    assert_eq!(reminder_date(2026, 6), Some(date("2026-06-22")));
    assert!(!is_update_reminder_due(date("2026-06-15"), None));
    assert!(!is_update_reminder_due(date("2026-06-21"), None));
    assert!(is_update_reminder_due(date("2026-06-22"), None));

    // 15 September 2026 is a Tuesday, so the reminder waits until the 21st.
    assert_eq!(reminder_date(2026, 9), Some(date("2026-09-21")));
    assert!(!is_update_reminder_due(date("2026-09-15"), None));
    assert!(!is_update_reminder_due(date("2026-09-20"), None));
    assert!(is_update_reminder_due(date("2026-09-21"), None));

    // 15 November 2026 is a Sunday, so the reminder is due the next day.
    assert_eq!(reminder_date(2026, 11), Some(date("2026-11-16")));
    assert!(!is_update_reminder_due(date("2026-11-15"), None));
    assert!(is_update_reminder_due(date("2026-11-16"), None));
}

#[test]
fn a_december_cycle_rolls_into_january() {
    assert_eq!(reminder_date(2026, 12), Some(date("2026-12-21")));
    assert_eq!(reminder_date(2027, 1), Some(date("2027-01-18")));

    // A check during the December cycle suppresses December's reminder.
    let checked = Some(date("2026-12-22"));
    assert!(!is_update_reminder_due(date("2026-12-28"), checked));

    // It must not suppress January's: the year rolls over, and the December
    // check is in the previous cycle.
    assert!(is_update_reminder_due(date("2027-01-18"), checked));
    // Before January's reminder date the reminder is not yet due.
    assert!(!is_update_reminder_due(date("2027-01-05"), checked));
}

#[test]
fn a_check_in_the_current_cycle_suppresses_the_reminder_and_an_earlier_one_does_not() {
    // September 2026: the reminder cycle starts on the 21st.
    let cycle_start = date("2026-09-21");
    assert_eq!(reminder_date(2026, 9), Some(cycle_start));

    // A check on the reminder date itself counts as being in the cycle.
    assert!(!is_update_reminder_due(
        date("2026-09-25"),
        Some(cycle_start)
    ));
    assert!(!is_update_reminder_due(
        date("2026-09-25"),
        Some(date("2026-09-23"))
    ));

    // The day before the cycle started is the previous cycle, so the reminder
    // still stands.
    assert!(is_update_reminder_due(
        date("2026-09-25"),
        Some(date("2026-09-20"))
    ));
    // As does a check from the previous month.
    assert!(is_update_reminder_due(
        date("2026-09-25"),
        Some(date("2026-08-30"))
    ));
}

#[test]
fn a_stored_timestamp_is_read_as_a_local_calendar_date() {
    // The same instant, written with two different offsets, must resolve to the
    // same local day: the conversion follows the instant, not the text.
    let via_offset = local_date_of(Some("2026-09-23T10:30:00+12:00"));
    let via_utc = local_date_of(Some("2026-09-22T22:30:00Z"));
    assert_eq!(via_offset, via_utc);

    // It is a *local* date, so it is whatever that instant is in the machine's
    // zone. Asserting a literal date here would only hold in one timezone: an
    // earlier version of this test did exactly that, and failed on the UTC CI
    // runner while passing locally.
    let expected = DateTime::parse_from_rfc3339("2026-09-23T10:30:00+12:00")
        .unwrap()
        .with_timezone(&Local)
        .date_naive();
    assert_eq!(via_offset, Some(expected));

    // A day later is one local day later, in any zone.
    let next_day = local_date_of(Some("2026-09-24T10:30:00+12:00")).unwrap();
    assert_eq!(next_day, expected + Duration::days(1));

    assert_eq!(local_date_of(None), None);
    assert_eq!(local_date_of(Some("not a timestamp")), None);

    // No usable timestamp means no check on record, so the reminder is due.
    assert!(is_update_reminder_due(
        date("2026-09-25"),
        local_date_of(None)
    ));
}

fn set_last_app_update_check(database: &Database, value: Option<&str>) {
    database
        .connection()
        .execute(
            "UPDATE app_settings SET last_app_update_check = ?1 WHERE id = 1",
            [value],
        )
        .unwrap();
}

fn last_app_update_check(database: &Database) -> Option<String> {
    database
        .connection()
        .query_row(
            "SELECT last_app_update_check FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn an_update_check_is_due_when_none_has_been_recorded() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let now = DateTime::parse_from_rfc3339("2026-08-24T09:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    assert!(last_app_update_check(&database).is_none());
    assert!(is_app_update_check_due(database.connection(), now).unwrap());

    // An unreadable stored value must not lock the user out of checking.
    set_last_app_update_check(&database, Some("not a timestamp"));
    assert!(is_app_update_check_due(database.connection(), now).unwrap());
}

#[test]
fn security_restore_future_update_timestamp_is_due() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let now = DateTime::parse_from_rfc3339("2026-08-24T09:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let future = now + Duration::days(365);
    set_last_app_update_check(&database, Some(&future.to_rfc3339()));

    assert!(is_app_update_check_due(database.connection(), now).unwrap());
    assert_eq!(last_app_update_check(&database), Some(future.to_rfc3339()));
}

#[test]
fn asking_whether_a_check_is_due_records_nothing() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let now = DateTime::parse_from_rfc3339("2026-08-24T09:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    assert!(is_app_update_check_due(database.connection(), now).unwrap());
    // The question must not consume the interval: asking twice still answers
    // due, and nothing has been written.
    assert!(is_app_update_check_due(database.connection(), now).unwrap());
    assert!(last_app_update_check(&database).is_none());
}

#[test]
fn a_successful_check_is_recorded_and_then_throttles_the_next_one() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let checked_at = DateTime::parse_from_rfc3339("2026-08-24T09:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    record_app_update_check(database.connection(), checked_at).unwrap();
    assert_eq!(
        last_app_update_check(&database),
        Some(checked_at.to_rfc3339())
    );

    // Within the interval the next check is throttled.
    assert!(
        !is_app_update_check_due(database.connection(), checked_at + Duration::hours(23)).unwrap()
    );
    // On the boundary and beyond it is due again.
    assert!(
        is_app_update_check_due(database.connection(), checked_at + Duration::hours(24)).unwrap()
    );
}

#[test]
fn a_failed_check_leaves_the_stored_timestamp_untouched() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let succeeded_at = DateTime::parse_from_rfc3339("2026-08-20T09:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    record_app_update_check(database.connection(), succeeded_at).unwrap();

    // A later check is due, and the user presses the button while offline. The
    // command asks whether a check is due, the network call fails, and
    // record_app_update_check is never reached.
    let attempted_at = succeeded_at + Duration::hours(30);
    assert!(is_app_update_check_due(database.connection(), attempted_at).unwrap());

    // The window is not consumed: the stored timestamp still shows the last
    // check that actually reached the server, so retrying is allowed at once.
    assert_eq!(
        last_app_update_check(&database),
        Some(succeeded_at.to_rfc3339())
    );
    assert!(is_app_update_check_due(database.connection(), attempted_at).unwrap());
}

/// An RFC 3339 timestamp at local noon on `date`, so its local calendar date
/// is `date` in every time zone the tests might run in.
fn local_noon(date: NaiveDate) -> String {
    date.and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .single()
        .unwrap()
        .to_rfc3339()
}

#[test]
fn the_manual_reminder_shows_from_the_cycle_start_until_a_check_succeeds() {
    let cycle_start = reminder_date(2026, 10).unwrap();
    let now = Utc::now();
    let status = |today: NaiveDate, checked: Option<NaiveDate>| {
        let checked = checked.map(local_noon);
        update_status(now, today, UpdateMode::Manual, checked.as_deref(), None)
    };

    let before = status(cycle_start - Duration::days(1), None);
    assert!(!before.reminder_due && !before.reminder_pending);
    let due = status(cycle_start, None);
    assert!(due.reminder_due && due.reminder_pending);
    assert!(
        !due.automatic_check_due,
        "manual mode never checks by itself"
    );
    // A check from the previous cycle does not count; one in this cycle does.
    assert!(status(cycle_start, Some(cycle_start - Duration::days(3))).reminder_due);
    let checked = status(cycle_start + Duration::days(2), Some(cycle_start));
    assert!(!checked.reminder_due && !checked.reminder_pending);
}

#[test]
fn setting_the_reminder_aside_silences_only_the_current_cycle() {
    let cycle_start = reminder_date(2026, 10).unwrap();
    let now = Utc::now();
    let dismissed_in_cycle = local_noon(cycle_start + Duration::days(1));
    let status = update_status(
        now,
        cycle_start + Duration::days(5),
        UpdateMode::Manual,
        None,
        Some(&dismissed_in_cycle),
    );
    assert!(!status.reminder_due, "the bar is set aside");
    assert!(status.reminder_pending, "the Settings marker stays");

    // Set aside last month: this month's reminder is back.
    let next_cycle = reminder_date(2026, 11).unwrap();
    let status = update_status(
        now,
        next_cycle,
        UpdateMode::Manual,
        None,
        Some(&dismissed_in_cycle),
    );
    assert!(status.reminder_due);
}

#[test]
fn automatic_mode_checks_at_most_once_a_day_and_never_reminds() {
    let now = Utc::now();
    let today = Local::now().date_naive();
    let recent = (now - Duration::hours(3)).to_rfc3339();
    let old = (now - Duration::hours(25)).to_rfc3339();
    let never = update_status(now, today, UpdateMode::Automatic, None, None);
    assert!(never.automatic_check_due);
    assert!(!never.reminder_due && !never.reminder_pending);
    assert!(
        !update_status(now, today, UpdateMode::Automatic, Some(&recent), None).automatic_check_due
    );
    assert!(update_status(now, today, UpdateMode::Automatic, Some(&old), None).automatic_check_due);
}

#[test]
fn update_preferences_start_manual_persist_and_reject_unknown_modes() {
    let directory = TempDir::new().unwrap();
    let database = open_database(&directory);
    let connection = database.connection();
    let now = Utc::now();
    assert_eq!(read_update_status(connection, now).unwrap().mode, "manual");

    set_update_mode(connection, UpdateMode::Automatic).unwrap();
    let status = read_update_status(connection, now).unwrap();
    assert_eq!(status.mode, "automatic");
    assert!(status.automatic_check_due);
    assert!(UpdateMode::parse("sometimes").is_err());
    assert!(
        connection
            .execute("UPDATE app_settings SET app_update_mode = 'sometimes'", [])
            .is_err(),
        "the database refuses an unknown mode too"
    );

    set_update_mode(connection, UpdateMode::Manual).unwrap();
    dismiss_update_reminder(connection, now).unwrap();
    let dismissed: Option<String> = connection
        .query_row(
            "SELECT update_reminder_dismissed_at FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(dismissed, Some(now.to_rfc3339()));
}

#[test]
fn security_restore_never_turns_on_automatic_update_checks() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    set_update_mode(database.connection(), UpdateMode::Automatic).unwrap();
    dismiss_update_reminder(database.connection(), Utc::now()).unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.8.0").unwrap();

    // A backup is untrusted input. Contacting the internet by itself is the
    // user's choice on this computer, so a restore resets it to manual.
    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
    let (mode, dismissed): (String, Option<String>) = database
        .connection()
        .query_row(
            "SELECT app_update_mode, update_reminder_dismissed_at FROM app_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(mode, "manual");
    assert_eq!(dismissed, None);
}

#[test]
fn the_notice_acknowledgement_is_stored_locally_with_its_version() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    assert_eq!(database.get_notice_acknowledgement().unwrap(), None);

    let acknowledged = database.acknowledge_notice(1).unwrap();
    assert_eq!(acknowledged.version, 1);
    assert!(DateTime::parse_from_rfc3339(&acknowledged.acknowledged_at).is_ok());
    assert_eq!(
        database.get_notice_acknowledgement().unwrap(),
        Some(acknowledged)
    );

    // A later notice version replaces the earlier acknowledgement.
    assert_eq!(database.acknowledge_notice(2).unwrap().version, 2);
    for invalid in [0, -1, 1_001] {
        assert!(database.acknowledge_notice(invalid).is_err());
    }
    assert_eq!(
        database
            .get_notice_acknowledgement()
            .unwrap()
            .unwrap()
            .version,
        2
    );
}

#[test]
fn security_restore_clears_the_notice_acknowledgement() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    database.acknowledge_notice(1).unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let backup_path = backup::backup_now(&mut database, "0.8.0").unwrap();

    // The acknowledgement belongs to the person at this computer, and a backup
    // is untrusted, so a restore shows the notice again.
    backup::restore_backup(&mut database, &backup_path, &seed()).unwrap();
    assert_eq!(database.get_notice_acknowledgement().unwrap(), None);
}

fn fisher_input(fisher: &crate::models::Fisher) -> FisherInput {
    FisherInput {
        id: Some(fisher.id.clone()),
        name: fisher.name.clone(),
        permit_number: fisher.permit_number.clone(),
        vessels: fisher
            .vessels
            .iter()
            .map(|v| VesselInput {
                id: Some(v.id.clone()),
                name: v.name.clone(),
                vessel_number: v.vessel_number.clone().unwrap_or_default(),
                is_archived: v.is_archived,
                link_existing: false,
            })
            .collect(),
    }
}

#[test]
fn vessel_archiving_preserves_history_blocks_new_landings_and_restores() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "VESSEL-ARCHIVE");
    let vessel_id = fisher.vessels[0].id.clone();
    let input = LandingInput {
        id: None,
        fisher_id: fisher.id.clone(),
        vessel_id: Some(vessel_id.clone()),
        landing_date: "2026-10-01".to_owned(),
        invoice_number: None,
        items: vec![LandingItemInput {
            fishstock_code: "HOK1".to_owned(),
            quantity: 1234,
        }],
    };
    let landing = database.save_landing(input.clone()).unwrap();
    let unused = database
        .upsert_vessel(
            &fisher.id,
            VesselInput {
                id: None,
                name: "Unused".to_owned(),
                vessel_number: "987654".to_owned(),
                is_archived: false,
                link_existing: false,
            },
        )
        .unwrap();
    let before = database.list_landing_revisions(&landing.id).unwrap();
    let mut edit = fisher_input(&database.get_fisher(&fisher.id).unwrap());
    edit.vessels
        .retain(|v| v.id.as_deref() != Some(unused.id.as_str()));
    edit.vessels[0].is_archived = true;
    let archived = database.upsert_fisher(edit).unwrap();
    assert_eq!(archived.vessels.len(), 1);
    assert!(archived.vessels[0].is_archived);
    assert!(archived.vessels[0].has_landing_history);
    assert!(database.get_vessel(&fisher.id, &unused.id).is_err());
    assert_eq!(
        database.list_landing_revisions(&landing.id).unwrap(),
        before
    );
    assert_eq!(
        database
            .get_landing(&landing.id)
            .unwrap()
            .vessel_id
            .as_deref(),
        Some(vessel_id.as_str())
    );
    assert!(database.save_landing(input.clone()).is_err());
    let mut edit_landing = input.clone();
    edit_landing.id = Some(landing.id.clone());
    edit_landing.invoice_number = Some("CORRECTED".to_owned());
    database.save_landing(edit_landing).unwrap();
    database.delete_landing(&landing.id).unwrap();
    assert!(
        database
            .get_vessel(&fisher.id, &vessel_id)
            .unwrap()
            .has_landing_history
    );
    assert!(database.remove_vessel(&fisher.id, &vessel_id).is_err());
    let mut invalid = fisher_input(&database.get_fisher(&fisher.id).unwrap());
    invalid.name = "Must roll back".to_owned();
    invalid.vessels.clear();
    assert!(database.upsert_fisher(invalid).is_err());
    assert_eq!(database.get_fisher(&fisher.id).unwrap().name, fisher.name);
    let mut restore = fisher_input(&database.get_fisher(&fisher.id).unwrap());
    restore.vessels[0].is_archived = false;
    database.upsert_fisher(restore).unwrap();
    database.save_landing(input).unwrap();
}

#[test]
fn vessel_archive_state_survives_backup_restore() {
    let directory = TempDir::new().unwrap();
    let backups = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let fisher = fisher(&mut database, "VESSEL-BACKUP");
    let mut edit = fisher_input(&fisher);
    edit.vessels[0].is_archived = true;
    database.upsert_fisher(edit).unwrap();
    backup::set_backup_directory(&mut database, backups.path()).unwrap();
    let path = backup::backup_now(&mut database, "0.8.0").unwrap();
    assert_eq!(
        backup::validate_backup(&path).unwrap().0,
        CURRENT_SCHEMA_VERSION
    );
    let mut edit = fisher_input(&database.get_fisher(&fisher.id).unwrap());
    edit.vessels[0].is_archived = false;
    database.upsert_fisher(edit).unwrap();
    backup::restore_backup(&mut database, &path, &seed()).unwrap();
    assert!(database.get_fisher(&fisher.id).unwrap().vessels[0].is_archived);
}

#[test]
fn schema_eight_vessels_migrate_active_with_details_preserved() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("schema-eight.sqlite3");
    create_database_at_schema(&path, 8);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("INSERT INTO fishers(id,name,permit_number,normalized_permit_number,created_at,updated_at) VALUES ('f','Legacy','OLD','OLD','t','t');
        INSERT INTO fisher_vessels(id,fisher_id,name,vessel_number,created_at,updated_at) VALUES ('v','f','Legacy vessel','123','t','t');").unwrap();
    drop(connection);
    let database = Database::open(&path, &seed()).unwrap();
    let vessel = database.get_vessel("f", "v").unwrap();
    assert!(!vessel.is_archived);
    assert!(!vessel.has_landing_history);
    assert_eq!(vessel.name, "Legacy vessel");
    assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
}

fn insert_schema_vessel(connection: &rusqlite::Connection, schema_version: i64) {
    connection.execute_batch("INSERT INTO fishers(id,name,permit_number,normalized_permit_number,created_at,updated_at) VALUES ('matrix-f','Matrix holder','MATRIX','MATRIX','t','t');").unwrap();
    if schema_version >= 10 {
        connection.execute_batch("INSERT INTO vessels(id,name,vessel_number,registration_key,created_at,updated_at) VALUES ('matrix-v','Matrix vessel','987','987','t','t');
            INSERT INTO fisher_vessels(id,fisher_id,name,vessel_number,created_at,updated_at,vessel_id) VALUES ('matrix-v','matrix-f','Matrix vessel','987','t','t','matrix-v');
            INSERT INTO permit_holder_vessels(fisher_id,vessel_id,created_at,updated_at) VALUES ('matrix-f','matrix-v','t','t');").unwrap();
    } else {
        connection.execute_batch("INSERT INTO fisher_vessels(id,fisher_id,name,vessel_number,created_at,updated_at) VALUES ('matrix-v','matrix-f','Matrix vessel','987','t','t');").unwrap();
    }
    if schema_version >= 9 {
        connection
            .execute(
                if schema_version >= 10 {
                    "UPDATE permit_holder_vessels SET is_archived=1 WHERE vessel_id='matrix-v'"
                } else {
                    "UPDATE fisher_vessels SET is_archived=1 WHERE id='matrix-v'"
                },
                [],
            )
            .unwrap();
    }
}
fn assert_schema_vessel(database: &Database, original_schema: i64) {
    let vessel = database.get_vessel("matrix-f", "matrix-v").unwrap();
    assert_eq!(vessel.name, "Matrix vessel");
    assert_eq!(vessel.vessel_number.as_deref(), Some("987"));
    assert_eq!(vessel.is_archived, original_schema >= 9);
    assert!(!vessel.has_landing_history);
}
#[test]
fn failed_vessel_migration_keeps_schema_eight_and_existing_records() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("failed-vessel.sqlite3");
    create_database_at_schema(&path, 8);
    let connection = rusqlite::Connection::open(&path).unwrap();
    insert_schema_vessel(&connection, 8);
    connection
        .execute(
            "CREATE INDEX landing_revisions_vessel_id ON landing_revisions(vessel_id)",
            [],
        )
        .unwrap();
    drop(connection);
    assert!(Database::open(&path, &seed()).is_err());
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        8
    );
    assert!(
        connection
            .prepare("SELECT is_archived FROM fisher_vessels")
            .is_err()
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM fisher_vessels WHERE id='matrix-v'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "Matrix vessel"
    );
}

fn vessel_input(number: &str, name: &str) -> VesselInput {
    VesselInput {
        id: None,
        name: name.to_owned(),
        vessel_number: number.to_owned(),
        is_archived: false,
        link_existing: false,
    }
}
fn empty_holder(database: &mut Database, permit: &str) -> crate::models::Fisher {
    database
        .upsert_fisher(FisherInput {
            id: None,
            name: format!("Holder {permit}"),
            permit_number: permit.to_owned(),
            vessels: vec![],
        })
        .unwrap()
}
#[test]
fn registrations_require_ascii_digits_without_zero_prefix_and_trim_only_outside_spaces() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let holder = empty_holder(&mut database, "DIGITS");
    for number in [
        "",
        " ",
        "0",
        "0123",
        "12 34",
        "12-34",
        "AB123",
        "12.3",
        "１２３",
        "١٢٣",
    ] {
        assert!(
            database
                .upsert_vessel(&holder.id, vessel_input(number, "Test"))
                .is_err(),
            "{number}"
        );
    }
    assert!(database.list_vessels(&holder.id).unwrap().is_empty());
    let vessel = database
        .upsert_vessel(&holder.id, vessel_input(" 123456 ", "Trimmed"))
        .unwrap();
    assert_eq!(vessel.vessel_number.as_deref(), Some("123456"));
    assert_eq!(
        database
            .find_vessel_by_number(" 123456 ")
            .unwrap()
            .unwrap()
            .id,
        vessel.id
    );
}
#[test]
fn shared_vessels_keep_permit_holder_history_archive_state_and_reports_separate() {
    let directory = TempDir::new().unwrap();
    let mut database = open_database(&directory);
    let first = empty_holder(&mut database, "FIRST");
    let second = empty_holder(&mut database, "SECOND");
    let third = empty_holder(&mut database, "THIRD");
    let vessel = database
        .upsert_vessel(&first.id, vessel_input("456789", "Shared boat"))
        .unwrap();
    let lookup = database.find_vessel_by_number("456789").unwrap().unwrap();
    assert_eq!(lookup.id, vessel.id);
    assert!(
        database
            .upsert_vessel(&second.id, vessel_input("456789", "Different name"))
            .is_err()
    );
    let mut link = vessel_input("456789", "Different name");
    link.link_existing = true;
    let second_vessel = database.upsert_vessel(&second.id, link.clone()).unwrap();
    assert_eq!(second_vessel.id, vessel.id);
    assert_eq!(second_vessel.name, "Shared boat");
    assert_eq!(second_vessel.linked_permit_holders.len(), 2);
    database.upsert_vessel(&third.id, link).unwrap();
    database.remove_vessel(&third.id, &vessel.id).unwrap();
    assert!(database.get_vessel(&first.id, &vessel.id).is_ok());
    let landing = |holder: &str, amount| LandingInput {
        id: None,
        fisher_id: holder.to_owned(),
        vessel_id: Some(vessel.id.clone()),
        landing_date: "2026-11-01".to_owned(),
        invoice_number: None,
        items: vec![LandingItemInput {
            fishstock_code: "HOK1".to_owned(),
            quantity: amount,
        }],
    };
    let first_landing = database.save_landing(landing(&first.id, 100)).unwrap();
    let second_landing = database.save_landing(landing(&second.id, 200)).unwrap();
    assert_eq!(first_landing.vessel_id, second_landing.vessel_id);
    let metrics = database
        .dashboard_metrics("2026-10-01", "2027-09-30", 9)
        .unwrap();
    assert_eq!(metrics.active_vessels, 1);
    assert_eq!(metrics.active_fishers, 2);
    let report = database.report(Default::default()).unwrap();
    assert_eq!(report.vessel_rows.len(), 2);
    assert_eq!(report.unit_totals[0].quantity, 300);
    assert_eq!(
        database
            .list_landings(crate::models::LandingFilters {
                vessel_id: Some(vessel.id.clone()),
                ..Default::default()
            })
            .unwrap()
            .len(),
        2
    );
    let mut edit = fisher_input(&database.get_fisher(&first.id).unwrap());
    edit.vessels[0].is_archived = true;
    database.upsert_fisher(edit).unwrap();
    assert!(
        database
            .get_vessel(&first.id, &vessel.id)
            .unwrap()
            .is_archived
    );
    assert!(
        !database
            .get_vessel(&second.id, &vessel.id)
            .unwrap()
            .is_archived
    );
    assert!(database.save_landing(landing(&first.id, 100)).is_err());
    database.save_landing(landing(&second.id, 300)).unwrap();
    database.delete_landing(&first_landing.id).unwrap();
    assert!(database.remove_vessel(&first.id, &vessel.id).is_err());
    assert_eq!(
        database.list_deleted_landings(10).unwrap()[0]
            .vessel_id
            .as_deref(),
        Some(vessel.id.as_str())
    );
    let mut edit = fisher_input(&database.get_fisher(&second.id).unwrap());
    edit.vessels[0].name = "Renamed shared boat".to_owned();
    database.upsert_fisher(edit).unwrap();
    assert_eq!(
        database.get_vessel(&first.id, &vessel.id).unwrap().name,
        "Renamed shared boat"
    );
    let mut duplicate = fisher_input(&database.get_fisher(&second.id).unwrap());
    duplicate.name = "Must roll back".to_owned();
    duplicate.vessels.push(duplicate.vessels[0].clone());
    assert!(database.upsert_fisher(duplicate).is_err());
    assert_eq!(database.get_fisher(&second.id).unwrap().name, second.name);
}
#[test]
fn schema_nine_duplicate_registrations_share_identity_without_rewriting_history() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("old.sqlite3");
    create_database_at_schema(&path, 9);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("INSERT INTO fishers(id,name,permit_number,normalized_permit_number,created_at,updated_at) VALUES ('f1','First','1','1','t','t'),('f2','Second','2','2','t','t');
        INSERT INTO fisher_vessels(id,fisher_id,name,vessel_number,created_at,updated_at,is_archived) VALUES ('a','f1','First name','12345','t','t',0),('b','f2','Other name',' 12345 ','t','t',1),('c','f1','First name','54321','t','t',0),('d','f1','Legacy','00123','t','t',0);
        INSERT INTO landings(id,fisher_id,vessel_id,landing_date,created_at,updated_at) VALUES ('l1','f1','a','2026-11-01','t','t'),('l2','f2','b','2026-11-01','t','t');
        INSERT INTO landing_revisions(id,landing_id,version_number,operation,fisher_id,fisher_name,fisher_number,vessel_id,vessel_name,vessel_number,landing_date,created_at) VALUES ('r1','l1',1,'save','f1','First','1','a','First name','12345','2026-11-01','t'),('r2','l2',1,'save','f2','Second','2','b','Other name',' 12345 ','2026-11-01','t');").unwrap();
    let snapshots = |c: &rusqlite::Connection| {
        c.prepare(
            "SELECT id,vessel_id,vessel_name,vessel_number FROM landing_revisions ORDER BY id",
        )
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };
    let before = snapshots(&connection);
    drop(connection);
    let old_backup = directory.path().join("old.mylfr-backup");
    write_schema_backup(&path, &old_backup, "0.8.0");
    let mut database = Database::open(&path, &seed()).unwrap();
    assert_eq!(snapshots(database.connection()), before);
    let one = database.get_fisher("f1").unwrap();
    let two = database.get_fisher("f2").unwrap();
    let first = one
        .vessels
        .iter()
        .find(|v| v.vessel_number.as_deref() == Some("12345"))
        .unwrap();
    assert_eq!(first.id, two.vessels[0].id);
    assert!(!first.is_archived);
    assert!(two.vessels[0].is_archived);
    assert_eq!(first.other_recorded_names, vec!["Other name"]);
    assert_eq!(
        database.get_landing("l2").unwrap().vessel_id.as_deref(),
        Some(first.id.as_str())
    );
    assert_eq!(
        database
            .get_landing_revision("r2")
            .unwrap()
            .vessel_id
            .as_deref(),
        Some(first.id.as_str())
    );
    assert_eq!(
        database
            .get_landing_revision("r2")
            .unwrap()
            .vessel_name
            .as_deref(),
        Some("Other name")
    );
    let legacy = one
        .vessels
        .iter()
        .find(|v| v.registration_needs_review)
        .unwrap();
    assert_eq!(legacy.vessel_number.as_deref(), Some("00123"));
    assert_ne!(
        one.vessels
            .iter()
            .find(|v| v.vessel_number.as_deref() == Some("54321"))
            .unwrap()
            .id,
        first.id
    );
    database.upsert_fisher(fisher_input(&one)).unwrap();
    assert!(database.remove_vessel("f2", &first.id).is_err());
    // A schema-nine backup still validates at its original schema and restores forward.
    assert_eq!(backup::validate_backup(&old_backup).unwrap().0, 9);
    let target = TempDir::new().unwrap();
    let mut restored = open_database(&target);
    backup::restore_backup(&mut restored, &old_backup, &seed()).unwrap();
    assert_eq!(restored.get_fisher("f2").unwrap().vessels[0].id, first.id);
    assert_eq!(snapshots(restored.connection()), before);
}
#[test]
fn failed_shared_vessel_migration_rolls_back_all_new_tables_and_references() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("failed-shared.sqlite3");
    create_database_at_schema(&path, 9);
    let connection = rusqlite::Connection::open(&path).unwrap();
    insert_schema_vessel(&connection, 9);
    connection.execute("CREATE INDEX landing_revisions_fisher_vessel_idx ON landing_revisions(fisher_id,vessel_id)",[]).unwrap();
    drop(connection);
    assert!(Database::open(&path, &seed()).is_err());
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        9
    );
    assert!(connection.prepare("SELECT * FROM vessels").is_err());
    assert!(
        connection
            .prepare("SELECT vessel_id FROM fisher_vessels")
            .is_err()
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT vessel_number FROM fisher_vessels WHERE id='matrix-v'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "987"
    );
}
