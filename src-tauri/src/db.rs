use std::collections::HashSet;
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::Utc;
use rusqlite::{
    Connection, OptionalExtension, Row, Transaction, params, params_from_iter, types::Value,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{
    AppInfo, BusinessLogo, BusinessProfile, BusinessProfileInput, CatalogueDocument,
    DashboardMetrics, FishTypeReportRow, Fisher, FisherInput, Fishstock, FullExport, Landing,
    LandingFilters, LandingInput, LandingItem, LandingRevision, NoticeAcknowledgement,
    RegisteredVessel, ReportResult, ReportRow, UnitTotal, UserFishstock, UserFishstockInput,
    Vessel, VesselFishTypeReportRow, VesselInput, VesselReportRow,
};
use crate::validation::{
    MAX_LOGO_BYTES, fishstock_code, landing_date, normalize_permit_number, optional_text,
    required_text,
};

pub(crate) const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
pub(crate) const FISHING_YEAR_DEFAULT_MIGRATION: &str =
    include_str!("../migrations/0002_fishing_year_default.sql");
pub(crate) const BUSINESS_LOGO_MIGRATION: &str =
    include_str!("../migrations/0003_business_logo.sql");
pub(crate) const REPORTING_UNITS_MIGRATION: &str =
    include_str!("../migrations/0004_reporting_units.sql");
pub(crate) const RECEIVER_FISHSTOCKS_MIGRATION: &str =
    include_str!("../migrations/0005_receiver_fishstocks.sql");
pub(crate) const CANONICAL_APP_SETTINGS_MIGRATION: &str =
    include_str!("../migrations/0006_canonical_app_settings.sql");
pub(crate) const UPDATE_PREFERENCES_MIGRATION: &str =
    include_str!("../migrations/0007_update_preferences.sql");
pub(crate) const NOTICE_ACKNOWLEDGEMENT_MIGRATION: &str =
    include_str!("../migrations/0008_notice_acknowledgement.sql");
pub(crate) const MIN_SUPPORTED_SCHEMA_VERSION: i64 = 1;
pub(crate) const CURRENT_SCHEMA_VERSION: i64 = 10;

/// The ordered, append-only database migration ledger.
///
/// The migration number is the SQLite `user_version` written after that
/// migration commits. Keep old entries unchanged: installed databases and
/// backups may still need to pass through them.
pub(crate) const SCHEMA_MIGRATIONS: &[(i64, &str)] = &[
    (1, INITIAL_MIGRATION),
    (2, FISHING_YEAR_DEFAULT_MIGRATION),
    (3, BUSINESS_LOGO_MIGRATION),
    (4, REPORTING_UNITS_MIGRATION),
    (5, RECEIVER_FISHSTOCKS_MIGRATION),
    (6, CANONICAL_APP_SETTINGS_MIGRATION),
    (7, UPDATE_PREFERENCES_MIGRATION),
    (8, NOTICE_ACKNOWLEDGEMENT_MIGRATION),
    (9, include_str!("../migrations/0009_vessel_archiving.sql")),
    (10, include_str!("../migrations/0010_shared_vessels.sql")),
];

pub struct Database {
    path: PathBuf,
    connection: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>, seed: &CatalogueDocument) -> AppResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut connection = Connection::open(&path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "busy_timeout", 5_000_i64)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        Self::migrate(&mut connection)?;
        connection.pragma_update(None, "application_id", 0x4D4C4652_i64)?;

        let mut database = Self { path, connection };
        database.seed_catalogue_if_empty(seed)?;
        Ok(database)
    }

    fn migrate(connection: &mut Connection) -> AppResult<()> {
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > CURRENT_SCHEMA_VERSION {
            return Err(AppError::Conflict(format!(
                "This database was created by a newer myLFR Desktop version (schema {version})."
            )));
        }

        for &(migration_version, sql) in SCHEMA_MIGRATIONS {
            if version >= migration_version {
                continue;
            }
            let transaction = connection.transaction()?;
            transaction.execute_batch(sql)?;
            transaction.pragma_update(None, "user_version", migration_version)?;
            transaction.commit()?;
        }
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> AppResult<i64> {
        Ok(self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn app_info(&self, version: &str) -> AppResult<AppInfo> {
        let catalogue_version = self.connection.query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(AppInfo {
            version: version.to_owned(),
            database_path: self.path.display().to_string(),
            schema_version: self.schema_version()?,
            catalogue_version,
        })
    }

    /// Seeds the catalogue bundled with this build into a new, empty database.
    ///
    /// An existing database is never updated from the bundled catalogue, even
    /// a newer one: the official list is frozen, and receivers maintain their
    /// own additions to it. Applying a catalogue would switch off every stock
    /// it does not list, including those.
    fn seed_catalogue_if_empty(&mut self, seed: &CatalogueDocument) -> AppResult<()> {
        let count: i64 =
            self.connection
                .query_row("SELECT count(*) FROM fishstock_codes", [], |row| row.get(0))?;
        if count == 0 {
            return self.apply_catalogue_document(seed, true);
        }
        Ok(())
    }

    pub fn get_business_profile(&self) -> AppResult<Option<BusinessProfile>> {
        Ok(self
            .connection
            .query_row(
                "SELECT lfr_name, client_number, street_number, street_name, street_type, suburb, city, postcode, created_at, updated_at FROM business_profile WHERE id = 1",
                [],
                |row| {
                    Ok(BusinessProfile {
                        lfr_name: row.get(0)?,
                        client_number: row.get(1)?,
                        street_number: row.get(2)?,
                        street_name: row.get(3)?,
                        street_type: row.get(4)?,
                        suburb: row.get(5)?,
                        city: row.get(6)?,
                        postcode: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()?)
    }

    /// Read the stored report logo. Returns `None` when no business profile
    /// row exists yet or when no logo has been chosen.
    pub fn get_business_logo(&self) -> AppResult<Option<BusinessLogo>> {
        let stored: Option<(Option<Vec<u8>>, Option<i64>, Option<i64>)> = self
            .connection
            .query_row(
                "SELECT logo_png, logo_width, logo_height FROM business_profile WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((Some(png), Some(width), Some(height))) = stored else {
            return Ok(None);
        };
        Ok(Some(BusinessLogo {
            data_base64: STANDARD.encode(&png),
            width,
            height,
        }))
    }

    /// Replace the stored report logo. Callers pass PNG bytes that have already
    /// been validated at the command boundary; the size cap is re-checked here
    /// so no path can grow the database without bound.
    pub fn set_business_logo(
        &mut self,
        png: Vec<u8>,
        width: i64,
        height: i64,
    ) -> AppResult<BusinessLogo> {
        if png.len() > MAX_LOGO_BYTES {
            return Err(AppError::Validation(
                "Logo image is larger than 512 KB.".to_owned(),
            ));
        }
        let updated = self.connection.execute(
            "UPDATE business_profile
             SET logo_png = ?1, logo_width = ?2, logo_height = ?3, updated_at = ?4
             WHERE id = 1",
            params![png, width, height, now()],
        )?;
        if updated == 0 {
            return Err(AppError::Validation(
                "Save your business details before adding a logo.".to_owned(),
            ));
        }
        self.get_business_logo()?
            .ok_or_else(|| AppError::Database(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Remove the stored report logo. Succeeds even when none is set.
    pub fn clear_business_logo(&mut self) -> AppResult<()> {
        self.connection.execute(
            "UPDATE business_profile
             SET logo_png = NULL, logo_width = NULL, logo_height = NULL, updated_at = ?1
             WHERE id = 1",
            params![now()],
        )?;
        Ok(())
    }

    /// The version of the responsibilities notice the user acknowledged on
    /// this computer, and when, or `None` if they have not.
    pub fn get_notice_acknowledgement(&self) -> AppResult<Option<NoticeAcknowledgement>> {
        let stored: (Option<i64>, Option<String>) = self.connection.query_row(
            "SELECT notice_acknowledged_version, notice_acknowledged_at FROM app_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(match stored {
            (Some(version), Some(acknowledged_at)) => Some(NoticeAcknowledgement {
                version,
                acknowledged_at,
            }),
            _ => None,
        })
    }

    /// Record that the user acknowledged a version of the notice. The text and
    /// its version live with the interface; this stores only what was seen.
    pub fn acknowledge_notice(&mut self, version: i64) -> AppResult<NoticeAcknowledgement> {
        if !(1..=1_000).contains(&version) {
            return Err(AppError::Validation(
                "Notice version is invalid.".to_owned(),
            ));
        }
        self.connection.execute(
            "UPDATE app_settings
             SET notice_acknowledged_version = ?1, notice_acknowledged_at = ?2
             WHERE id = 1",
            params![version, now()],
        )?;
        self.get_notice_acknowledgement()?
            .ok_or_else(|| AppError::Database(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn get_fishing_year_start_month(&self) -> AppResult<i64> {
        Ok(self.connection.query_row(
            "SELECT fishing_year_start_month FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn set_fishing_year_start_month(&mut self, start_month: i64) -> AppResult<i64> {
        if !matches!(start_month, 1 | 3 | 9) {
            return Err(AppError::Validation(
                "Fishing year must start in February, April, or October.".to_owned(),
            ));
        }
        self.connection.execute(
            "UPDATE app_settings SET fishing_year_start_month = ?1 WHERE id = 1",
            [start_month],
        )?;
        self.get_fishing_year_start_month()
    }

    pub fn save_business_profile(
        &mut self,
        input: BusinessProfileInput,
    ) -> AppResult<BusinessProfile> {
        let lfr_name = required_text(&input.lfr_name, "LFR name", 120)?;
        let client_number = required_text(&input.client_number, "Client number", 60)?;
        let address_fields = [
            (input.street_number, "Street number", 32),
            (input.street_name, "Street name", 120),
            (input.street_type, "Street type", 40),
            (input.suburb, "Suburb", 120),
            (input.city, "City", 120),
            (input.postcode, "Postcode", 20),
        ];
        let mut values = Vec::with_capacity(address_fields.len());
        for (value, label, max) in address_fields {
            if value.trim().chars().count() > max {
                return Err(AppError::Validation(format!(
                    "{label} must be {max} characters or fewer."
                )));
            }
            values.push(value.trim().to_owned());
        }

        let now = now();
        self.connection.execute(
            "INSERT INTO business_profile(id, lfr_name, client_number, street_number, street_name, street_type, suburb, city, postcode, created_at, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET
               lfr_name = excluded.lfr_name,
               client_number = excluded.client_number,
               street_number = excluded.street_number,
               street_name = excluded.street_name,
               street_type = excluded.street_type,
               suburb = excluded.suburb,
               city = excluded.city,
               postcode = excluded.postcode,
               updated_at = excluded.updated_at",
            params![
                lfr_name,
                client_number,
                values[0],
                values[1],
                values[2],
                values[3],
                values[4],
                values[5],
                now
            ],
        )?;
        self.get_business_profile()?
            .ok_or_else(|| AppError::Database(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn list_fishers(&self, include_archived: bool) -> AppResult<Vec<Fisher>> {
        let sql = if include_archived {
            "SELECT id, name, permit_number, is_archived, archived_at, created_at, updated_at FROM fishers ORDER BY name COLLATE NOCASE"
        } else {
            "SELECT id, name, permit_number, is_archived, archived_at, created_at, updated_at FROM fishers WHERE is_archived = 0 ORDER BY name COLLATE NOCASE"
        };
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement.query_map([], map_fisher_base)?;
        let mut fishers = rows.collect::<Result<Vec<_>, _>>()?;
        for fisher in &mut fishers {
            fisher.vessels = self.list_vessels(&fisher.id)?;
        }
        Ok(fishers)
    }

    pub fn get_fisher(&self, id: &str) -> AppResult<Fisher> {
        let mut fisher = self
            .connection
            .query_row(
                "SELECT id, name, permit_number, is_archived, archived_at, created_at, updated_at FROM fishers WHERE id = ?1",
                [id],
                map_fisher_base,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Permit holder was not found.".to_owned()))?;
        fisher.vessels = self.list_vessels(id)?;
        Ok(fisher)
    }

    pub fn list_vessels(&self, fisher_id: &str) -> AppResult<Vec<Vessel>> {
        let mut statement = self.connection.prepare(&format!(
            "{VESSEL_SELECT} WHERE p.fisher_id = ?1 ORDER BY v.name COLLATE NOCASE"
        ))?;
        let mut vessels = statement
            .query_map([fisher_id], map_vessel)?
            .collect::<Result<Vec<_>, _>>()?;
        for vessel in &mut vessels {
            decorate_vessel(&self.connection, vessel)?;
        }
        Ok(vessels)
    }

    pub fn get_vessel(&self, fisher_id: &str, id: &str) -> AppResult<Vessel> {
        let mut vessel = self
            .connection
            .query_row(
                &format!("{VESSEL_SELECT} WHERE p.fisher_id = ?1 AND v.id = ?2"),
                params![fisher_id, id],
                map_vessel,
            )
            .optional()?
            .ok_or_else(|| {
                AppError::NotFound("Vessel is not linked to this permit holder.".to_owned())
            })?;
        decorate_vessel(&self.connection, &mut vessel)?;
        Ok(vessel)
    }

    pub fn find_vessel_by_number(&self, number: &str) -> AppResult<Option<RegisteredVessel>> {
        let number = crate::validation::vessel_registration(number)?;
        let vessel = self
            .connection
            .query_row(
                "SELECT id, name, vessel_number FROM vessels WHERE registration_key = ?1",
                [number],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        vessel
            .map(|(id, name, vessel_number)| {
                let linked_permit_holders = linked_permit_holders(&self.connection, &id)?;
                Ok(RegisteredVessel {
                    id,
                    name,
                    vessel_number,
                    linked_permit_holders,
                })
            })
            .transpose()
    }

    pub fn upsert_vessel(&mut self, fisher_id: &str, input: VesselInput) -> AppResult<Vessel> {
        self.get_fisher(fisher_id)?;
        let transaction = self.connection.transaction()?;
        let id = save_vessel_link(&transaction, fisher_id, input)?;
        transaction.commit()?;
        self.get_vessel(fisher_id, &id)
    }

    pub fn remove_vessel(&mut self, fisher_id: &str, id: &str) -> AppResult<()> {
        let transaction = self.connection.transaction()?;
        remove_vessel_link(&transaction, fisher_id, id)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn upsert_fisher(&mut self, input: FisherInput) -> AppResult<Fisher> {
        let id = input.id.unwrap_or_else(new_id);
        let name = required_text(&input.name, "Permit holder name", 120)?;
        let permit_number = required_text(&input.permit_number, "Permit number", 60)?;
        let normalized = normalize_permit_number(&permit_number);
        if normalized.is_empty() {
            return Err(AppError::Validation(
                "Permit number is required.".to_owned(),
            ));
        }

        let transaction = self.connection.transaction()?;
        let existing_created: Option<String> = transaction
            .query_row(
                "SELECT created_at FROM fishers WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )
            .optional()?;
        let timestamp = now();
        let created_at = existing_created.unwrap_or_else(|| timestamp.clone());

        let result = transaction.execute(
            "INSERT INTO fishers(id, name, permit_number, normalized_permit_number, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, permit_number = excluded.permit_number,
               normalized_permit_number = excluded.normalized_permit_number, updated_at = excluded.updated_at",
            params![id, name, permit_number, normalized, created_at, timestamp],
        );
        if let Err(error) = result {
            return if is_unique_constraint(&error) {
                Err(AppError::Conflict(
                    "That permit number is already used by another permit holder, including archived holders."
                        .to_owned(),
                ))
            } else {
                Err(error.into())
            };
        }

        Self::replace_vessels(&transaction, &id, input.vessels)?;
        transaction.commit()?;
        self.get_fisher(&id)
    }

    fn replace_vessels(
        transaction: &Transaction<'_>,
        fisher_id: &str,
        vessels: Vec<VesselInput>,
    ) -> AppResult<()> {
        let mut incoming = HashSet::new();
        for vessel in vessels {
            let id = save_vessel_link(transaction, fisher_id, vessel)?;
            if !incoming.insert(id) {
                return Err(AppError::Validation("This vessel is included more than once. Each registration can be linked to a permit holder only once.".to_owned()));
            }
        }
        let existing = {
            let mut statement = transaction
                .prepare("SELECT vessel_id FROM permit_holder_vessels WHERE fisher_id = ?1")?;
            statement
                .query_map([fisher_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for id in existing {
            if !incoming.contains(&id) {
                remove_vessel_link(transaction, fisher_id, &id)?;
            }
        }
        Ok(())
    }

    pub fn set_fisher_archived(&mut self, id: &str, archived: bool) -> AppResult<Fisher> {
        let changed = self.connection.execute(
            "UPDATE fishers SET is_archived = ?2, archived_at = CASE WHEN ?2 = 1 THEN ?3 ELSE NULL END, updated_at = ?3 WHERE id = ?1",
            params![id, archived, now()],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(
                "Permit holder was not found.".to_owned(),
            ));
        }
        self.get_fisher(id)
    }

    pub fn remove_fisher(&mut self, id: &str) -> AppResult<()> {
        let related: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM landings WHERE fisher_id = ?1 UNION ALL SELECT 1 FROM landing_revisions WHERE fisher_id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if related {
            return Err(AppError::Conflict(
                "This permit holder has landing history and must be archived instead of removed."
                    .to_owned(),
            ));
        }
        if self
            .connection
            .execute("DELETE FROM fishers WHERE id = ?1", [id])?
            == 0
        {
            return Err(AppError::NotFound(
                "Permit holder was not found.".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn search_fishstocks(&self, query: &str, limit: u32) -> AppResult<Vec<Fishstock>> {
        let normalized = query.trim().to_uppercase();
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, 100) as i64;
        let pattern = format!("%{normalized}%");
        let prefix = format!("{normalized}%");
        let mut statement = self.connection.prepare(
            "SELECT f.code, f.description, f.reporting_unit, f.is_active,
                    EXISTS(SELECT 1 FROM favorite_fishstocks fav WHERE fav.code = f.code) AS is_favorite,
                    f.is_user_added
             FROM fishstock_codes f
             WHERE f.is_active = 1 AND (f.code LIKE ?1 OR upper(f.description) LIKE ?2)
             ORDER BY CASE WHEN f.code = ?3 THEN 0 WHEN f.code LIKE ?4 THEN 1 ELSE 2 END,
                      is_favorite DESC, f.code
             LIMIT ?5",
        )?;
        Ok(statement
            .query_map(
                params![pattern, pattern, normalized, prefix, limit],
                map_fishstock,
            )?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_favorite_fishstocks(&self) -> AppResult<Vec<Fishstock>> {
        let mut statement = self.connection.prepare(
            "SELECT f.code, f.description, f.reporting_unit, f.is_active, 1, f.is_user_added
             FROM favorite_fishstocks fav JOIN fishstock_codes f ON f.code = fav.code
             ORDER BY f.code",
        )?;
        Ok(statement
            .query_map([], map_fishstock)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn set_fishstock_favorite(&mut self, code: &str, favorite: bool) -> AppResult<()> {
        let code = fishstock_code(code)?;
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM fishstock_codes WHERE code = ?1)",
            [&code],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound(
                "Fishstock code was not found.".to_owned(),
            ));
        }
        if favorite {
            self.connection.execute(
                "INSERT OR IGNORE INTO favorite_fishstocks(code, created_at) VALUES (?1, ?2)",
                params![code, now()],
            )?;
        } else {
            self.connection
                .execute("DELETE FROM favorite_fishstocks WHERE code = ?1", [&code])?;
        }
        Ok(())
    }

    pub fn list_user_fishstocks(&self) -> AppResult<Vec<UserFishstock>> {
        let mut statement = self.connection.prepare(&format!(
            "{USER_FISHSTOCK_SELECT} WHERE f.is_user_added = 1 ORDER BY f.code"
        ))?;
        Ok(statement
            .query_map([], map_user_fishstock)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Add a receiver-maintained fishstock. The code must not already exist in
    /// the list, whether as an official or a receiver-added stock.
    pub fn add_user_fishstock(&mut self, input: UserFishstockInput) -> AppResult<UserFishstock> {
        let (code, description, reporting_unit, start_month) = validate_user_fishstock(&input)?;
        let transaction = self.connection.transaction()?;
        ensure_fishstock_code_is_free(&transaction, &code)?;
        transaction.execute(
            "INSERT INTO fishstock_codes(code, description, reporting_unit, is_active,
                                         catalogue_version, updated_at, is_user_added,
                                         fishing_year_start_month)
             VALUES (?1, ?2, ?3, 1,
                     (SELECT catalogue_version FROM app_settings WHERE id = 1), ?4, 1, ?5)",
            params![code, description, reporting_unit, now(), start_month],
        )?;
        let fishstock = get_user_fishstock(&transaction, &code)?;
        transaction.commit()?;
        Ok(fishstock)
    }

    /// Edit a receiver-added fishstock. Its name and fishing year can always
    /// change, because neither alters a saved landing. Its code and reporting
    /// unit lock once a landing uses it: changing the code would move those
    /// landings to another stock, and quantities already entered cannot be
    /// reinterpreted in another unit.
    pub fn update_user_fishstock(
        &mut self,
        code: &str,
        input: UserFishstockInput,
    ) -> AppResult<UserFishstock> {
        let current_code = fishstock_code(code)?;
        let (new_code, description, reporting_unit, start_month) = validate_user_fishstock(&input)?;
        let transaction = self.connection.transaction()?;
        let current = get_user_fishstock(&transaction, &current_code)?;
        if current.landing_count > 0
            && (new_code != current.code || reporting_unit != current.reporting_unit)
        {
            return Err(AppError::Validation(format!(
                "{} is used by {}, so its code and how it is measured can no longer be changed. You can still change its name and fishing year.",
                current.code,
                landing_count_label(current.landing_count)
            )));
        }
        if new_code != current.code {
            ensure_fishstock_code_is_free(&transaction, &new_code)?;
            // The favourite row holds a foreign key to the old code, so it is
            // moved across rather than updated in place.
            transaction.execute(
                "DELETE FROM favorite_fishstocks WHERE code = ?1",
                [&current.code],
            )?;
            transaction.execute(
                "UPDATE fishstock_codes SET code = ?1 WHERE code = ?2",
                params![new_code, current.code],
            )?;
            if current.is_favorite {
                transaction.execute(
                    "INSERT INTO favorite_fishstocks(code, created_at) VALUES (?1, ?2)",
                    params![new_code, now()],
                )?;
            }
        }
        transaction.execute(
            "UPDATE fishstock_codes
             SET description = ?1, reporting_unit = ?2, fishing_year_start_month = ?3,
                 updated_at = ?4
             WHERE code = ?5",
            params![description, reporting_unit, start_month, now(), new_code],
        )?;
        let fishstock = get_user_fishstock(&transaction, &new_code)?;
        transaction.commit()?;
        Ok(fishstock)
    }

    /// Remove a receiver-added fishstock that no landing uses. A stock any
    /// landing uses is never deleted.
    pub fn remove_user_fishstock(&mut self, code: &str) -> AppResult<()> {
        let code = fishstock_code(code)?;
        let transaction = self.connection.transaction()?;
        let current = get_user_fishstock(&transaction, &code)?;
        if current.landing_count > 0 {
            return Err(AppError::Validation(format!(
                "{} is used by {}, so it can't be removed.",
                current.code,
                landing_count_label(current.landing_count)
            )));
        }
        transaction.execute("DELETE FROM favorite_fishstocks WHERE code = ?1", [&code])?;
        transaction.execute(
            "DELETE FROM fishstock_codes WHERE code = ?1 AND is_user_added = 1",
            [&code],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn save_landing(&mut self, input: LandingInput) -> AppResult<Landing> {
        let is_existing = input.id.is_some();
        let landing_id = input.id.unwrap_or_else(new_id);
        let date = landing_date(&input.landing_date)?;
        let invoice_number = optional_text(input.invoice_number.as_deref(), "Invoice number", 120)?;
        if input.items.is_empty() {
            return Err(AppError::Validation(
                "Add at least one fishstock item.".to_owned(),
            ));
        }
        if input.items.len() > 250 {
            return Err(AppError::Validation(
                "A landing can contain at most 250 items.".to_owned(),
            ));
        }

        let mut codes = HashSet::new();
        let mut validated_items = Vec::with_capacity(input.items.len());
        for item in input.items {
            let code = fishstock_code(&item.fishstock_code)?;
            if !codes.insert(code.clone()) {
                return Err(AppError::Validation(format!(
                    "Fishstock code {code} appears more than once."
                )));
            }
            if item.quantity <= 0 {
                return Err(AppError::Validation(format!(
                    "Quantity for {code} must be greater than zero."
                )));
            }
            if item.quantity > 9_000_000_000_000_000 {
                return Err(AppError::Validation(format!(
                    "Quantity for {code} is too large."
                )));
            }
            validated_items.push((code, item.quantity));
        }

        let transaction = self.connection.transaction()?;
        ensure_fisher_is_usable(&transaction, &input.fisher_id, &landing_id)?;
        let vessel_reference = input
            .vessel_id
            .as_deref()
            .map(|id| vessel_reference_for_landing(&transaction, id, &input.fisher_id, &landing_id))
            .transpose()?;
        let mut resolved_items = Vec::with_capacity(validated_items.len());
        for (code, quantity) in &validated_items {
            let (usable, catalogue_unit): (bool, String) = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM fishstock_codes f
                   WHERE f.code = ?1
                     AND (f.is_active = 1 OR EXISTS(
                       SELECT 1 FROM landing_items li
                       WHERE li.landing_id = ?2 AND li.fishstock_code = f.code
                     ))
                 ), (SELECT reporting_unit FROM fishstock_codes WHERE code = ?1)",
                params![code, &landing_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if !usable {
                return Err(AppError::Validation(format!(
                    "Fishstock code {code} is not available for this landing."
                )));
            }
            if !is_reporting_unit(&catalogue_unit) {
                return Err(AppError::Database(rusqlite::Error::InvalidQuery));
            }
            let reporting_unit = transaction
                .query_row(
                    "SELECT reporting_unit FROM landing_items WHERE landing_id = ?1 AND fishstock_code = ?2",
                    params![&landing_id, code],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(catalogue_unit);
            resolved_items.push((code.clone(), *quantity, reporting_unit));
        }

        let existing_created: Option<String> = transaction
            .query_row(
                "SELECT created_at FROM landings WHERE id = ?1",
                [&landing_id],
                |row| row.get(0),
            )
            .optional()?;
        let timestamp = now();
        let created_at = existing_created
            .clone()
            .unwrap_or_else(|| timestamp.clone());
        if is_existing && existing_created.is_none() {
            return Err(AppError::NotFound("Landing was not found.".to_owned()));
        }

        transaction.execute(
            "INSERT INTO landings(id, fisher_id, vessel_id, landing_date, invoice_number, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET fisher_id = excluded.fisher_id, vessel_id = excluded.vessel_id,
               landing_date = excluded.landing_date, invoice_number = excluded.invoice_number,
               updated_at = excluded.updated_at",
            params![landing_id, input.fisher_id, vessel_reference, date, invoice_number, created_at, timestamp],
        )?;
        transaction.execute(
            "DELETE FROM landing_items WHERE landing_id = ?1",
            [&landing_id],
        )?;
        for (index, (code, quantity, reporting_unit)) in resolved_items.iter().enumerate() {
            transaction.execute(
                "INSERT INTO landing_items(id, landing_id, fishstock_code, quantity, reporting_unit, display_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![new_id(), landing_id, code, quantity, reporting_unit, index as i64],
            )?;
        }
        create_revision(&transaction, &landing_id, "save")?;
        transaction.commit()?;
        self.get_landing(&landing_id)
    }

    pub fn get_landing(&self, id: &str) -> AppResult<Landing> {
        let mut landing = self
            .connection
            .query_row(LANDING_SELECT, [id], map_landing_base)
            .optional()?
            .ok_or_else(|| AppError::NotFound("Landing was not found.".to_owned()))?;
        landing.items = list_landing_items(&self.connection, id)?;
        Ok(landing)
    }

    pub fn list_landings(&self, filters: LandingFilters) -> AppResult<Vec<Landing>> {
        let mut sql = format!("{LANDING_SELECT_BASE} WHERE 1 = 1");
        let mut values = Vec::<Value>::new();
        if let Some(fisher_id) = &filters.fisher_id {
            sql.push_str(" AND l.fisher_id = ?");
            values.push(fisher_id.clone().into());
        }
        if let Some(vessel_id) = &filters.vessel_id {
            sql.push_str(" AND (SELECT vessel_id FROM fisher_vessels WHERE id = l.vessel_id) = ?");
            values.push(vessel_id.clone().into());
        }
        if let Some(code) = &filters.fishstock_code {
            sql.push_str(
                " AND EXISTS(SELECT 1 FROM landing_items li WHERE li.landing_id = l.id AND li.fishstock_code = ?)",
            );
            values.push(fishstock_code(code)?.into());
        }
        if let Some(invoice) = filters.invoice_number.as_deref().map(str::trim) {
            if !invoice.is_empty() {
                // `\`, `%` and `_` are escaped so they match themselves, not as wildcards.
                let escaped = invoice
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                sql.push_str(" AND l.invoice_number LIKE ? ESCAPE '\\'");
                values.push(format!("%{escaped}%").into());
            }
        }
        if let Some(from_date) = &filters.from_date {
            landing_date(from_date)?;
            sql.push_str(" AND l.landing_date >= ?");
            values.push(from_date.clone().into());
        }
        if let Some(to_date) = &filters.to_date {
            landing_date(to_date)?;
            sql.push_str(" AND l.landing_date <= ?");
            values.push(to_date.clone().into());
        }
        sql.push_str(" ORDER BY l.landing_date DESC, l.created_at DESC LIMIT ?");
        values.push((filters.limit.unwrap_or(500).max(1) as i64).into());

        let mut statement = self.connection.prepare(&sql)?;
        let mut landings = statement
            .query_map(params_from_iter(values), map_landing_base)?
            .collect::<Result<Vec<_>, _>>()?;
        for landing in &mut landings {
            landing.items = list_landing_items(&self.connection, &landing.id)?;
        }
        Ok(landings)
    }

    pub fn list_landing_years(&self) -> AppResult<Vec<i64>> {
        let mut statement = self.connection.prepare(
            "SELECT DISTINCT CAST(substr(landing_date, 1, 4) AS INTEGER) AS landing_year
             FROM landings
             ORDER BY landing_year DESC",
        )?;
        Ok(statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_previous_landing_fishstocks(
        &self,
        fisher_id: &str,
        vessel_id: Option<&str>,
        exclude_landing_id: Option<&str>,
    ) -> AppResult<Vec<Fishstock>> {
        let mut statement = self.connection.prepare(
            "SELECT f.code, f.description, f.reporting_unit, f.is_active,
                    EXISTS(SELECT 1 FROM favorite_fishstocks fav WHERE fav.code = f.code),
                    f.is_user_added
             FROM landing_items li
             JOIN fishstock_codes f ON f.code = li.fishstock_code
             WHERE li.landing_id = (
               SELECT l.id FROM landings l
               WHERE l.fisher_id = ?1
                 AND (SELECT vessel_id FROM fisher_vessels WHERE id = l.vessel_id) IS ?2
                 AND (?3 IS NULL OR l.id <> ?3)
               ORDER BY l.landing_date DESC, l.created_at DESC
               LIMIT 1
             )
               AND f.is_active = 1
             ORDER BY li.display_order",
        )?;
        let fishstocks = statement
            .query_map(
                params![fisher_id, vessel_id, exclude_landing_id],
                map_fishstock,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(fishstocks)
    }

    pub fn delete_landing(&mut self, id: &str) -> AppResult<()> {
        let transaction = self.connection.transaction()?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM landings WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound("Landing was not found.".to_owned()));
        }
        create_revision(&transaction, id, "delete")?;
        transaction.execute("DELETE FROM landings WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_landing_revisions(&self, landing_id: &str) -> AppResult<Vec<LandingRevision>> {
        let mut statement = self.connection.prepare(
            "SELECT id, landing_id, version_number, operation, fisher_id, fisher_name, fisher_number,
                    vessel_id, vessel_name, vessel_number, landing_date, invoice_number, created_at
             FROM landing_revisions WHERE landing_id = ?1 ORDER BY version_number",
        )?;
        let mut revisions = statement
            .query_map([landing_id], map_revision_base)?
            .collect::<Result<Vec<_>, _>>()?;
        for revision in &mut revisions {
            canonicalize_revision(&self.connection, revision)?;
            revision.items = list_revision_items(&self.connection, &revision.id)?;
        }
        Ok(revisions)
    }

    pub fn get_landing_revision(&self, revision_id: &str) -> AppResult<LandingRevision> {
        let mut revision = self
            .connection
            .query_row(
                "SELECT id, landing_id, version_number, operation, fisher_id, fisher_name, fisher_number,
                        vessel_id, vessel_name, vessel_number, landing_date, invoice_number, created_at
                 FROM landing_revisions WHERE id = ?1",
                [revision_id],
                map_revision_base,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Landing revision was not found.".to_owned()))?;
        canonicalize_revision(&self.connection, &mut revision)?;
        revision.items = list_revision_items(&self.connection, revision_id)?;
        Ok(revision)
    }

    fn list_all_landing_revisions(&self) -> AppResult<Vec<LandingRevision>> {
        let revision_ids = {
            let mut statement = self
                .connection
                .prepare("SELECT id FROM landing_revisions ORDER BY landing_id, version_number")?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        revision_ids
            .iter()
            .map(|id| self.get_landing_revision(id))
            .collect()
    }

    pub fn list_deleted_landings(&self, limit: u32) -> AppResult<Vec<LandingRevision>> {
        let mut statement = self.connection.prepare(
            "SELECT r.id, r.landing_id, r.version_number, r.operation, r.fisher_id, r.fisher_name,
                    r.fisher_number, r.vessel_id, r.vessel_name, r.vessel_number, r.landing_date,
                    r.invoice_number, r.created_at
             FROM landing_revisions r
             WHERE r.operation = 'delete'
               AND NOT EXISTS(SELECT 1 FROM landings l WHERE l.id = r.landing_id)
             ORDER BY r.created_at DESC LIMIT ?1",
        )?;
        let mut revisions = statement
            .query_map([limit.max(1)], map_revision_base)?
            .collect::<Result<Vec<_>, _>>()?;
        for revision in &mut revisions {
            canonicalize_revision(&self.connection, revision)?;
            revision.items = list_revision_items(&self.connection, &revision.id)?;
        }
        Ok(revisions)
    }

    pub fn dashboard_metrics(
        &self,
        from_date: &str,
        to_date: &str,
        fishing_year_start_month: i64,
    ) -> AppResult<DashboardMetrics> {
        landing_date(from_date)?;
        landing_date(to_date)?;
        if !matches!(fishing_year_start_month, 1 | 3 | 9) {
            return Err(AppError::Validation(
                "Fishing year must start in February, April, or October.".to_owned(),
            ));
        }
        let (active_fishers, active_vessels, landing_count, fishstock_count) =
            self.connection.query_row(
                &format!(
                    "SELECT
                    count(DISTINCT l.fisher_id), count(DISTINCT (SELECT vessel_id FROM fisher_vessels WHERE id = l.vessel_id)),
                    count(DISTINCT l.id), count(DISTINCT li.fishstock_code)
                 FROM landings l JOIN landing_items li ON li.landing_id = l.id
                 JOIN fishstock_codes f ON f.code = li.fishstock_code
                 WHERE l.landing_date BETWEEN ?1 AND ?2
                   AND {ITEM_FISHING_YEAR_START_MONTH} = ?3"
                ),
                params![from_date, to_date, fishing_year_start_month],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
        let mut statement = self.connection.prepare(&format!(
            "SELECT li.reporting_unit, coalesce(sum(li.quantity), 0)
             FROM landings l JOIN landing_items li ON li.landing_id = l.id
             JOIN fishstock_codes f ON f.code = li.fishstock_code
             WHERE l.landing_date BETWEEN ?1 AND ?2
               AND {ITEM_FISHING_YEAR_START_MONTH} = ?3
             GROUP BY li.reporting_unit
             ORDER BY CASE li.reporting_unit WHEN 'greenweightKg' THEN 1 WHEN 'meatweightKg' THEN 2 ELSE 3 END"
        ))?;
        let unit_totals = statement
            .query_map(
                params![from_date, to_date, fishing_year_start_month],
                |row| {
                    Ok(UnitTotal {
                        reporting_unit: row.get(0)?,
                        quantity: row.get(1)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(DashboardMetrics {
            active_fishers,
            active_vessels,
            landing_count,
            fishstock_count,
            unit_totals,
        })
    }

    pub fn report(&self, filters: LandingFilters) -> AppResult<ReportResult> {
        let mut sql = String::from(
            "SELECT li.fishstock_code, f.description, li.reporting_unit, sum(li.quantity), count(DISTINCT l.id)
             FROM landings l JOIN landing_items li ON li.landing_id = l.id
             JOIN fishstock_codes f ON f.code = li.fishstock_code WHERE 1 = 1",
        );
        let mut values = Vec::<Value>::new();
        append_landing_filters(&mut sql, &mut values, &filters)?;
        sql.push_str(
            " GROUP BY li.fishstock_code, f.description, li.reporting_unit ORDER BY li.fishstock_code COLLATE NOCASE ASC",
        );
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement
            .query_map(params_from_iter(values.clone()), |row| {
                Ok(ReportRow {
                    fishstock_code: row.get(0)?,
                    description: row.get(1)?,
                    reporting_unit: row.get(2)?,
                    quantity: row.get(3)?,
                    landing_count: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut fish_type_sql = String::from(
            "SELECT substr(li.fishstock_code, 1, 3), group_concat(DISTINCT li.fishstock_code),
                    li.reporting_unit, sum(li.quantity), count(DISTINCT l.id)
             FROM landings l JOIN landing_items li ON li.landing_id = l.id
             WHERE 1 = 1",
        );
        let mut fish_type_values = Vec::<Value>::new();
        append_landing_filters(&mut fish_type_sql, &mut fish_type_values, &filters)?;
        fish_type_sql.push_str(
            " GROUP BY substr(li.fishstock_code, 1, 3), li.reporting_unit
              ORDER BY substr(li.fishstock_code, 1, 3) COLLATE NOCASE ASC",
        );
        let mut fish_type_statement = self.connection.prepare(&fish_type_sql)?;
        let fish_type_base = fish_type_statement
            .query_map(params_from_iter(fish_type_values), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut fish_type_rows = Vec::with_capacity(fish_type_base.len());
        for (fish_type, fishstocks, reporting_unit, quantity, landing_count) in fish_type_base {
            fish_type_rows.push(FishTypeReportRow {
                description: self.fish_type_description(&fish_type)?,
                fish_type,
                fishstocks: sorted_codes(&fishstocks),
                reporting_unit,
                quantity,
                landing_count,
            });
        }

        let mut vessel_sql = String::from(
            "SELECT l.fisher_id, p.name, p.permit_number, v.id, v.name, v.vessel_number,
                    li.fishstock_code, f.description, li.reporting_unit, sum(li.quantity), count(DISTINCT l.id)
             FROM landings l
             JOIN fishers p ON p.id = l.fisher_id
             LEFT JOIN fisher_vessels ref ON ref.id = l.vessel_id
             LEFT JOIN vessels v ON v.id = ref.vessel_id
             JOIN landing_items li ON li.landing_id = l.id
             JOIN fishstock_codes f ON f.code = li.fishstock_code
             WHERE 1 = 1",
        );
        let mut vessel_values = Vec::<Value>::new();
        append_landing_filters(&mut vessel_sql, &mut vessel_values, &filters)?;
        vessel_sql.push_str(
            " GROUP BY l.fisher_id, p.name, p.permit_number, v.id, v.name, v.vessel_number,
                       li.fishstock_code, f.description, li.reporting_unit
              ORDER BY p.name COLLATE NOCASE ASC,
                       CASE WHEN l.vessel_id IS NULL THEN 1 ELSE 0 END,
                       v.name COLLATE NOCASE ASC,
                       li.fishstock_code COLLATE NOCASE ASC",
        );
        let mut vessel_statement = self.connection.prepare(&vessel_sql)?;
        let vessel_rows = vessel_statement
            .query_map(params_from_iter(vessel_values), |row| {
                Ok(VesselReportRow {
                    fisher_id: row.get(0)?,
                    fisher_name: row.get(1)?,
                    fisher_number: row.get(2)?,
                    vessel_id: row.get(3)?,
                    vessel_name: row.get(4)?,
                    vessel_number: row.get(5)?,
                    fishstock_code: row.get(6)?,
                    description: row.get(7)?,
                    reporting_unit: row.get(8)?,
                    quantity: row.get(9)?,
                    landing_count: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut vessel_fish_type_sql = String::from(
            "SELECT l.fisher_id, p.name, p.permit_number, v.id, v.name, v.vessel_number,
                    substr(li.fishstock_code, 1, 3), group_concat(DISTINCT li.fishstock_code),
                    li.reporting_unit, sum(li.quantity), count(DISTINCT l.id)
             FROM landings l
             JOIN fishers p ON p.id = l.fisher_id
             LEFT JOIN fisher_vessels ref ON ref.id = l.vessel_id
             LEFT JOIN vessels v ON v.id = ref.vessel_id
             JOIN landing_items li ON li.landing_id = l.id
             WHERE 1 = 1",
        );
        let mut vessel_fish_type_values = Vec::<Value>::new();
        append_landing_filters(
            &mut vessel_fish_type_sql,
            &mut vessel_fish_type_values,
            &filters,
        )?;
        vessel_fish_type_sql.push_str(
            " GROUP BY l.fisher_id, p.name, p.permit_number, v.id, v.name, v.vessel_number,
                       substr(li.fishstock_code, 1, 3), li.reporting_unit
              ORDER BY p.name COLLATE NOCASE ASC,
                       CASE WHEN l.vessel_id IS NULL THEN 1 ELSE 0 END,
                       v.name COLLATE NOCASE ASC,
                       substr(li.fishstock_code, 1, 3) COLLATE NOCASE ASC",
        );
        let mut vessel_fish_type_statement = self.connection.prepare(&vessel_fish_type_sql)?;
        let vessel_fish_type_base = vessel_fish_type_statement
            .query_map(params_from_iter(vessel_fish_type_values), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut vessel_fish_type_rows = Vec::with_capacity(vessel_fish_type_base.len());
        for (
            fisher_id,
            fisher_name,
            fisher_number,
            vessel_id,
            vessel_name,
            vessel_number,
            fish_type,
            fishstocks,
            reporting_unit,
            quantity,
            landing_count,
        ) in vessel_fish_type_base
        {
            vessel_fish_type_rows.push(VesselFishTypeReportRow {
                fisher_id,
                fisher_name,
                fisher_number,
                vessel_id,
                vessel_name,
                vessel_number,
                description: self.fish_type_description(&fish_type)?,
                fish_type,
                fishstocks: sorted_codes(&fishstocks),
                reporting_unit,
                quantity,
                landing_count,
            });
        }

        let mut unit_totals = Vec::new();
        for reporting_unit in [GREENWEIGHT_KG, MEATWEIGHT_KG, COUNT] {
            let quantity = rows
                .iter()
                .filter(|row| row.reporting_unit == reporting_unit)
                .map(|row| row.quantity)
                .sum();
            if quantity > 0 {
                unit_totals.push(UnitTotal {
                    reporting_unit: reporting_unit.to_owned(),
                    quantity,
                });
            }
        }
        let item_count = self.count_filtered(&filters, "count(li.id)")?;
        let landing_count = self.count_filtered(&filters, "count(DISTINCT l.id)")?;
        Ok(ReportResult {
            rows,
            fish_type_rows,
            vessel_rows,
            vessel_fish_type_rows,
            landing_count,
            item_count,
            unit_totals,
        })
    }

    fn fish_type_description(&self, fish_type: &str) -> AppResult<String> {
        let territorial_code = format!("{fish_type}ET");
        let territorial_description = self
            .connection
            .query_row(
                "SELECT description FROM fishstock_codes WHERE code = ?1",
                [&territorial_code],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(description) = territorial_description {
            // The markers are ASCII; preserve UTF-8 byte offsets into the original name.
            let lowercase = description.to_ascii_lowercase();
            if let Some(index) = lowercase
                .find(" extra territorial")
                .or_else(|| lowercase.find(" ex territorial"))
            {
                return Ok(description[..index].trim().to_owned());
            }
        }

        let known_exception = match fish_type {
            "ASO" => Some("Asparagopsis"),
            "GLM" => Some("Green-lipped mussel"),
            "OYU" => Some("Dredge Oyster"),
            "STN" => Some("Southern Bluefin Tuna"),
            _ => None,
        };
        if let Some(description) = known_exception {
            return Ok(description.to_owned());
        }
        Ok(fish_type.to_owned())
    }

    fn count_filtered(&self, filters: &LandingFilters, expression: &str) -> AppResult<i64> {
        let mut sql = format!(
            "SELECT {expression} FROM landings l LEFT JOIN landing_items li ON li.landing_id = l.id WHERE 1 = 1"
        );
        let mut values = Vec::<Value>::new();
        append_landing_filters(&mut sql, &mut values, filters)?;
        Ok(self
            .connection
            .query_row(&sql, params_from_iter(values), |row| row.get(0))?)
    }

    pub fn full_export(&self) -> AppResult<FullExport> {
        let catalogue_version = self.connection.query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(FullExport {
            business_profile: self.get_business_profile()?,
            fishers: self.list_fishers(true)?,
            favorite_fishstocks: self.list_favorite_fishstocks()?,
            user_fishstocks: self.list_user_fishstocks()?,
            landings: self.list_landings(LandingFilters {
                limit: Some(u32::MAX),
                ..Default::default()
            })?,
            landing_revisions: self.list_all_landing_revisions()?,
            deleted_landings: self.list_deleted_landings(u32::MAX)?,
            schema_version: self.schema_version()?,
            catalogue_version,
            exported_at: now(),
        })
    }

    pub fn apply_catalogue_document(
        &mut self,
        document: &CatalogueDocument,
        allow_same_version: bool,
    ) -> AppResult<()> {
        validate_catalogue(document)?;
        let current_version: i64 = self.connection.query_row(
            "SELECT catalogue_version FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        if !allow_same_version && document.catalogue_version as i64 <= current_version {
            return Err(AppError::Conflict(format!(
                "Catalogue version {} is not newer than installed version {current_version}.",
                document.catalogue_version
            )));
        }

        let transaction = self.connection.transaction()?;
        Self::replace_catalogue(&transaction, document)?;
        transaction.commit()?;
        Ok(())
    }

    /// Re-establishes trusted installation-owned state on a staged restored
    /// database before it is allowed to replace the live database.
    pub(crate) fn normalize_restored_state(
        &mut self,
        trusted_catalogue: &CatalogueDocument,
    ) -> AppResult<()> {
        validate_catalogue(trusted_catalogue)?;
        let transaction = self.connection.transaction()?;
        Self::replace_catalogue(&transaction, trusted_catalogue)?;
        validate_restored_user_fishstocks(&transaction)?;
        transaction.execute(
            "UPDATE app_settings
             SET backup_directory = NULL,
                 last_backup_at = NULL,
                 last_backup_path = NULL,
                 last_app_update_check = NULL,
                 last_catalogue_update_check = NULL,
                 app_update_mode = 'manual',
                 update_reminder_dismissed_at = NULL,
                 notice_acknowledged_version = NULL,
                 notice_acknowledged_at = NULL
             WHERE id = 1",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn replace_catalogue(
        transaction: &Transaction<'_>,
        document: &CatalogueDocument,
    ) -> AppResult<()> {
        // Receiver-added stocks are the receiver's data, not the catalogue's,
        // so a catalogue never switches them off.
        transaction.execute(
            "UPDATE fishstock_codes SET is_active = 0 WHERE is_user_added = 0",
            [],
        )?;
        for record in &document.records {
            let code = fishstock_code(&record.code)?;
            let description = required_text(&record.description, "Fishstock description", 500)?;
            transaction.execute(
                "INSERT INTO fishstock_codes(code, description, reporting_unit, is_active, catalogue_version, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(code) DO UPDATE SET description = excluded.description,
                   reporting_unit = excluded.reporting_unit, is_active = excluded.is_active,
                   catalogue_version = excluded.catalogue_version,
                   updated_at = excluded.updated_at,
                   is_user_added = 0, fishing_year_start_month = NULL",
                params![code, description, record.reporting_unit, record.is_active, document.catalogue_version, now()],
            )?;
        }
        transaction.execute(
            "UPDATE app_settings SET catalogue_version = ?1 WHERE id = 1",
            [document.catalogue_version],
        )?;
        Ok(())
    }

    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }

    pub(crate) fn connection_mut(&mut self) -> &mut Connection {
        &mut self.connection
    }
}

fn append_landing_filters(
    sql: &mut String,
    values: &mut Vec<Value>,
    filters: &LandingFilters,
) -> AppResult<()> {
    if let Some(value) = &filters.fisher_id {
        sql.push_str(" AND l.fisher_id = ?");
        values.push(value.clone().into());
    }
    if let Some(value) = &filters.vessel_id {
        sql.push_str(" AND (SELECT vessel_id FROM fisher_vessels WHERE id = l.vessel_id) = ?");
        values.push(value.clone().into());
    }
    if let Some(value) = &filters.from_date {
        landing_date(value)?;
        sql.push_str(" AND l.landing_date >= ?");
        values.push(value.clone().into());
    }
    if let Some(value) = &filters.to_date {
        landing_date(value)?;
        sql.push_str(" AND l.landing_date <= ?");
        values.push(value.clone().into());
    }
    Ok(())
}

/// The fishing year a landing item counts towards, as its start month, for a
/// query that joins `landing_items li` to `fishstock_codes f`.
///
/// A receiver-added stock uses the year the receiver chose. Catalogue stocks
/// derive it from the code; see docs/fishing-year-rules.md. Only the two Lake
/// Ellesmere (Te Waihora, QMA 13) eel stocks use the February year; every other
/// LFE/SFE stock is an October one. Exploratory codes such as LFE13E are never
/// landed, so exact matches suffice. Every SCA stock uses the April year, so
/// scallops match on prefix, not by code.
const ITEM_FISHING_YEAR_START_MONTH: &str = "CASE
    WHEN f.is_user_added = 1 THEN f.fishing_year_start_month
    WHEN li.fishstock_code IN ('LFE13', 'SFE13') THEN 1
    WHEN substr(li.fishstock_code, 1, 3) IN ('BYA','CHC','CRA','DAN','DSU','GSC','HOR','KIC','MDI','MMI','PDO','PHC','SAE','SBW','SCA','SCC')
      OR li.fishstock_code IN ('GLM9') THEN 3
    ELSE 9
  END";

const USER_FISHSTOCK_SELECT: &str = "SELECT f.code, f.description, f.reporting_unit,
        f.fishing_year_start_month,
        EXISTS(SELECT 1 FROM favorite_fishstocks fav WHERE fav.code = f.code),
        (SELECT count(*) FROM landing_items li WHERE li.fishstock_code = f.code)
     FROM fishstock_codes f";

fn map_fishstock(row: &Row<'_>) -> rusqlite::Result<Fishstock> {
    Ok(Fishstock {
        code: row.get(0)?,
        description: row.get(1)?,
        reporting_unit: row.get(2)?,
        is_active: row.get(3)?,
        is_favorite: row.get(4)?,
        is_user_added: row.get(5)?,
    })
}

fn map_user_fishstock(row: &Row<'_>) -> rusqlite::Result<UserFishstock> {
    Ok(UserFishstock {
        code: row.get(0)?,
        description: row.get(1)?,
        reporting_unit: row.get(2)?,
        fishing_year_start_month: row.get(3)?,
        is_favorite: row.get(4)?,
        landing_count: row.get(5)?,
    })
}

/// Read a receiver-added fishstock, refusing official ones.
fn get_user_fishstock(connection: &Connection, code: &str) -> AppResult<UserFishstock> {
    let is_user_added: bool = connection
        .query_row(
            "SELECT is_user_added FROM fishstock_codes WHERE code = ?1",
            [code],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Fishstock {code} was not found.")))?;
    if !is_user_added {
        return Err(AppError::Validation(format!(
            "{code} is part of the official fishstock list, which can't be changed."
        )));
    }
    Ok(connection.query_row(
        &format!("{USER_FISHSTOCK_SELECT} WHERE f.code = ?1"),
        [code],
        map_user_fishstock,
    )?)
}

fn ensure_fishstock_code_is_free(connection: &Connection, code: &str) -> AppResult<()> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT description FROM fishstock_codes WHERE code = ?1",
            [code],
            |row| row.get(0),
        )
        .optional()?;
    match existing {
        Some(description) => Err(AppError::Conflict(format!(
            "{code} is already in the fishstock list ({description})."
        ))),
        None => Ok(()),
    }
}

/// Validate a receiver-added fishstock, returning its normalised code, name,
/// reporting unit, and fishing year start month.
fn validate_user_fishstock(input: &UserFishstockInput) -> AppResult<(String, String, String, i64)> {
    let code = fishstock_code(&input.code)?;
    let description = required_text(&input.description, "Fishstock name", 120)?;
    if !is_reporting_unit(&input.reporting_unit) {
        return Err(AppError::Validation(
            "Choose how this fishstock is measured.".to_owned(),
        ));
    }
    if !matches!(input.fishing_year_start_month, 1 | 3 | 9) {
        return Err(AppError::Validation(
            "Choose the fishing year this fishstock belongs to.".to_owned(),
        ));
    }
    Ok((
        code,
        description,
        input.reporting_unit.clone(),
        input.fishing_year_start_month,
    ))
}

/// Receiver-added stocks come from the backup being restored, which is
/// untrusted, so each must pass the same rules as one added in the app.
fn validate_restored_user_fishstocks(transaction: &Transaction<'_>) -> AppResult<()> {
    let stocks = {
        let mut statement = transaction.prepare(&format!(
            "{USER_FISHSTOCK_SELECT} WHERE f.is_user_added = 1"
        ))?;
        statement
            .query_map([], map_user_fishstock)?
            .collect::<Result<Vec<_>, _>>()?
    };
    for stock in stocks {
        let input = UserFishstockInput {
            code: stock.code.clone(),
            description: stock.description.clone(),
            reporting_unit: stock.reporting_unit.clone(),
            fishing_year_start_month: stock.fishing_year_start_month,
        };
        let valid = validate_user_fishstock(&input).is_ok_and(|(code, description, _, _)| {
            code == stock.code && description == stock.description
        });
        if !valid {
            return Err(AppError::BackupInvalid(
                "The backup contains a fishstock that is not valid.".to_owned(),
            ));
        }
    }
    transaction.execute(
        "UPDATE fishstock_codes SET is_active = 1 WHERE is_user_added = 1",
        [],
    )?;
    Ok(())
}

fn landing_count_label(count: i64) -> String {
    if count == 1 {
        "1 landing".to_owned()
    } else {
        format!("{count} landings")
    }
}

fn sorted_codes(value: &str) -> Vec<String> {
    let mut codes = value
        .split(',')
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    codes.sort_by_key(|code| code.to_ascii_uppercase());
    codes.dedup();
    codes
}

const LANDING_SELECT_BASE: &str =
    "SELECT l.id, l.fisher_id, f.name, f.permit_number, v.id, v.name, v.vessel_number,
            l.landing_date, l.invoice_number, l.created_at, l.updated_at
     FROM landings l JOIN fishers f ON f.id = l.fisher_id
     LEFT JOIN fisher_vessels ref ON ref.id = l.vessel_id
             LEFT JOIN vessels v ON v.id = ref.vessel_id";
const LANDING_SELECT: &str =
    "SELECT l.id, l.fisher_id, f.name, f.permit_number, v.id, v.name, v.vessel_number,
            l.landing_date, l.invoice_number, l.created_at, l.updated_at
     FROM landings l JOIN fishers f ON f.id = l.fisher_id
     LEFT JOIN fisher_vessels ref ON ref.id = l.vessel_id
             LEFT JOIN vessels v ON v.id = ref.vessel_id WHERE l.id = ?1";

fn map_fisher_base(row: &Row<'_>) -> rusqlite::Result<Fisher> {
    Ok(Fisher {
        id: row.get(0)?,
        name: row.get(1)?,
        permit_number: row.get(2)?,
        is_archived: row.get(3)?,
        archived_at: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        vessels: Vec::new(),
    })
}

const VESSEL_SELECT: &str = "SELECT v.id, p.fisher_id, v.name, v.vessel_number,
    v.created_at, v.updated_at, p.is_archived, v.registration_key IS NULL
    FROM permit_holder_vessels p JOIN vessels v ON v.id = p.vessel_id";

fn linked_permit_holders(connection: &Connection, id: &str) -> AppResult<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT f.name || ' — ' || f.permit_number
        FROM permit_holder_vessels p JOIN fishers f ON f.id = p.fisher_id
        WHERE p.vessel_id = ?1 ORDER BY f.name COLLATE NOCASE, f.permit_number",
    )?;
    Ok(statement
        .query_map([id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn link_has_history(connection: &Connection, fisher_id: &str, vessel_id: &str) -> AppResult<bool> {
    Ok(connection.query_row("SELECT EXISTS(
        SELECT 1 FROM landings l JOIN fisher_vessels ref ON ref.id = l.vessel_id
        WHERE l.fisher_id = ?1 AND ref.vessel_id = ?2
        UNION ALL SELECT 1 FROM landing_revisions r WHERE r.fisher_id = ?1
        AND (r.vessel_id = ?2 OR r.vessel_id IN (SELECT id FROM fisher_vessels WHERE vessel_id = ?2)))",
        params![fisher_id, vessel_id], |row|row.get(0))?)
}

fn decorate_vessel(connection: &Connection, vessel: &mut Vessel) -> AppResult<()> {
    vessel.has_landing_history = link_has_history(connection, &vessel.fisher_id, &vessel.id)?;
    vessel.linked_permit_holders = linked_permit_holders(connection, &vessel.id)?;
    let mut statement = connection.prepare(
        "SELECT DISTINCT name FROM fisher_vessels
        WHERE vessel_id = ?1 AND name <> ?2 ORDER BY name COLLATE NOCASE",
    )?;
    vessel.other_recorded_names = statement
        .query_map(params![vessel.id, vessel.name], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(())
}

fn canonicalize_revision(connection: &Connection, revision: &mut LandingRevision) -> AppResult<()> {
    if let Some(id) = &revision.vessel_id {
        if let Some(canonical) = connection
            .query_row(
                "SELECT vessel_id FROM fisher_vessels WHERE id = ?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            revision.vessel_id = Some(canonical);
        }
    }
    Ok(())
}

fn save_vessel_link(
    transaction: &Transaction<'_>,
    fisher_id: &str,
    input: VesselInput,
) -> AppResult<String> {
    let timestamp = now();
    let name = required_text(&input.name, "Vessel name", 120)?;
    let number = input.vessel_number.trim();
    let id = if let Some(id) = input.id {
        let (old_number, key): (Option<String>, Option<String>) = transaction.query_row(
            "SELECT v.vessel_number, v.registration_key FROM vessels v
             JOIN permit_holder_vessels p ON p.vessel_id = v.id WHERE v.id = ?1 AND p.fisher_id = ?2",
            params![id, fisher_id], |row|Ok((row.get(0)?,row.get(1)?))).optional()?
            .ok_or_else(|| AppError::Validation("Add an existing vessel by its registration number to link it to this permit holder.".to_owned()))?;
        let new_key = if key.is_none() && old_number.as_deref().unwrap_or("") == number {
            None // Keep legacy data usable until its registration is corrected.
        } else {
            Some(crate::validation::vessel_registration(number)?)
        };
        if key.is_some() && key != new_key {
            return Err(AppError::Validation("A saved registration number identifies the vessel and cannot be changed. Add the correct vessel instead.".to_owned()));
        }
        if let Some(key) = &new_key {
            let duplicate: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM vessels WHERE registration_key = ?1 AND id <> ?2)",
                params![key, id],
                |row| row.get(0),
            )?;
            if duplicate {
                return Err(AppError::Conflict("That registration already identifies another vessel. Its existing records must be reviewed before combining them.".to_owned()));
            }
        }
        transaction.execute("UPDATE vessels SET name = ?2, vessel_number = ?3, registration_key = ?4, updated_at = ?5 WHERE id = ?1",params![id,name,number,new_key,timestamp])?;
        id
    } else {
        let number = crate::validation::vessel_registration(number)?;
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM vessels WHERE registration_key = ?1",
                [&number],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            if !input.link_existing {
                return Err(AppError::Conflict("This registration already exists. Choose **Use this vessel** to link the existing vessel.".to_owned()));
            }
            id
        } else {
            let id = new_id();
            transaction.execute("INSERT INTO vessels(id,name,vessel_number,registration_key,created_at,updated_at) VALUES (?1,?2,?3,?3,?4,?4)",params![id,name,number,timestamp])?;
            id
        }
    };
    transaction.execute("INSERT INTO permit_holder_vessels(fisher_id,vessel_id,is_archived,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?4) ON CONFLICT(fisher_id,vessel_id) DO UPDATE SET is_archived=excluded.is_archived,updated_at=excluded.updated_at",
        params![fisher_id,id,input.is_archived,timestamp])?;
    let reference_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM fisher_vessels WHERE fisher_id=?1 AND vessel_id=?2)",
        params![fisher_id, id],
        |row| row.get(0),
    )?;
    if !reference_exists {
        let id_taken: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM fisher_vessels WHERE id=?1)",
            [&id],
            |row| row.get(0),
        )?;
        let reference_id = if id_taken { new_id() } else { id.clone() };
        transaction.execute("INSERT INTO fisher_vessels(id,fisher_id,name,vessel_number,created_at,updated_at,is_archived,vessel_id)
            SELECT ?1,?2,name,vessel_number,?4,?4,?5,id FROM vessels WHERE id=?3",
            params![reference_id,fisher_id,id,timestamp,input.is_archived])?;
    }
    Ok(id)
}

fn remove_vessel_link(transaction: &Transaction<'_>, fisher_id: &str, id: &str) -> AppResult<()> {
    if link_has_history(transaction, fisher_id, id)? {
        return Err(AppError::Conflict("This vessel has landing history for this permit holder. Archive its link instead of removing it.".to_owned()));
    }
    if transaction.execute(
        "DELETE FROM permit_holder_vessels WHERE fisher_id=?1 AND vessel_id=?2",
        params![fisher_id, id],
    )? == 0
    {
        return Err(AppError::NotFound(
            "Vessel is not linked to this permit holder.".to_owned(),
        ));
    }
    transaction.execute("DELETE FROM fisher_vessels WHERE fisher_id=?1 AND vessel_id=?2
        AND NOT EXISTS(SELECT 1 FROM landings WHERE landings.vessel_id=fisher_vessels.id)
        AND NOT EXISTS(SELECT 1 FROM landing_revisions WHERE landing_revisions.vessel_id=fisher_vessels.id)",params![fisher_id,id])?;
    transaction.execute(
        "DELETE FROM vessels WHERE id=?1
        AND NOT EXISTS(SELECT 1 FROM permit_holder_vessels WHERE vessel_id=?1)
        AND NOT EXISTS(SELECT 1 FROM fisher_vessels WHERE vessel_id=?1)
        AND NOT EXISTS(SELECT 1 FROM landing_revisions WHERE vessel_id=?1)",
        [id],
    )?;
    Ok(())
}

fn map_vessel(row: &Row<'_>) -> rusqlite::Result<Vessel> {
    Ok(Vessel {
        id: row.get(0)?,
        fisher_id: row.get(1)?,
        name: row.get(2)?,
        vessel_number: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        is_archived: row.get(6)?,
        has_landing_history: false,
        registration_needs_review: row.get(7)?,
        linked_permit_holders: Vec::new(),
        other_recorded_names: Vec::new(),
    })
}

fn map_landing_base(row: &Row<'_>) -> rusqlite::Result<Landing> {
    Ok(Landing {
        id: row.get(0)?,
        fisher_id: row.get(1)?,
        fisher_name: row.get(2)?,
        fisher_number: row.get(3)?,
        vessel_id: row.get(4)?,
        vessel_name: row.get(5)?,
        vessel_number: row.get(6)?,
        landing_date: row.get(7)?,
        invoice_number: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        items: Vec::new(),
    })
}

fn map_revision_base(row: &Row<'_>) -> rusqlite::Result<LandingRevision> {
    Ok(LandingRevision {
        id: row.get(0)?,
        landing_id: row.get(1)?,
        version_number: row.get(2)?,
        operation: row.get(3)?,
        fisher_id: row.get(4)?,
        fisher_name: row.get(5)?,
        fisher_number: row.get(6)?,
        vessel_id: row.get(7)?,
        vessel_name: row.get(8)?,
        vessel_number: row.get(9)?,
        landing_date: row.get(10)?,
        invoice_number: row.get(11)?,
        created_at: row.get(12)?,
        items: Vec::new(),
    })
}

fn list_landing_items(connection: &Connection, landing_id: &str) -> AppResult<Vec<LandingItem>> {
    let mut statement = connection.prepare(
        "SELECT li.id, li.fishstock_code, f.description, li.quantity, li.reporting_unit, li.display_order
         FROM landing_items li JOIN fishstock_codes f ON f.code = li.fishstock_code
         WHERE li.landing_id = ?1 ORDER BY li.display_order",
    )?;
    Ok(statement
        .query_map([landing_id], |row| {
            Ok(LandingItem {
                id: row.get(0)?,
                fishstock_code: row.get(1)?,
                description: row.get(2)?,
                quantity: row.get(3)?,
                reporting_unit: row.get(4)?,
                display_order: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn list_revision_items(connection: &Connection, revision_id: &str) -> AppResult<Vec<LandingItem>> {
    let mut statement = connection.prepare(
        "SELECT id, fishstock_code, description, quantity, reporting_unit, display_order
         FROM landing_revision_items WHERE revision_id = ?1 ORDER BY display_order",
    )?;
    Ok(statement
        .query_map([revision_id], |row| {
            Ok(LandingItem {
                id: row.get(0)?,
                fishstock_code: row.get(1)?,
                description: row.get(2)?,
                quantity: row.get(3)?,
                reporting_unit: row.get(4)?,
                display_order: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn ensure_fisher_is_usable(
    transaction: &Transaction<'_>,
    fisher_id: &str,
    landing_id: &str,
) -> AppResult<()> {
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM fishers f
           WHERE f.id = ?1
             AND (f.is_archived = 0 OR EXISTS(
               SELECT 1 FROM landings l WHERE l.id = ?2 AND l.fisher_id = f.id
             ))
         )",
        params![fisher_id, landing_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(AppError::Validation(
            "Permit holder is not available for this landing.".to_owned(),
        ));
    }
    Ok(())
}

fn vessel_reference_for_landing(
    transaction: &Transaction<'_>,
    vessel_id: &str,
    fisher_id: &str,
    landing_id: &str,
) -> AppResult<String> {
    let usable: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM permit_holder_vessels p WHERE p.vessel_id = ?1 AND p.fisher_id = ?2
         AND (p.is_archived = 0 OR EXISTS(SELECT 1 FROM landings l JOIN fisher_vessels r ON r.id = l.vessel_id
              WHERE l.id = ?3 AND l.fisher_id = p.fisher_id AND r.vessel_id = p.vessel_id)))",
        params![vessel_id, fisher_id, landing_id], |row| row.get(0))?;
    if !usable {
        return Err(AppError::Validation("Selected vessel is not available for this permit holder. Restore its link before recording a new landing.".to_owned()));
    }
    // Keep an existing landing's reference stable, including migrated duplicate IDs.
    transaction.query_row("SELECT r.id FROM fisher_vessels r WHERE r.vessel_id = ?1 AND r.fisher_id = ?2
        ORDER BY EXISTS(SELECT 1 FROM landings l WHERE l.id = ?3 AND l.vessel_id = r.id) DESC, r.id LIMIT 1",
        params![vessel_id, fisher_id, landing_id], |row|row.get(0)).map_err(AppError::from)
}

fn create_revision(
    transaction: &Transaction<'_>,
    landing_id: &str,
    operation: &str,
) -> AppResult<()> {
    let snapshot = transaction
        .query_row(LANDING_SELECT, [landing_id], map_landing_base)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Landing was not found.".to_owned()))?;
    let version_number: i64 = transaction.query_row(
        "SELECT coalesce(max(version_number), 0) + 1 FROM landing_revisions WHERE landing_id = ?1",
        [landing_id],
        |row| row.get(0),
    )?;
    let revision_id = new_id();
    transaction.execute(
        "INSERT INTO landing_revisions(id, landing_id, version_number, operation, fisher_id, fisher_name,
          fisher_number, vessel_id, vessel_name, vessel_number, landing_date, invoice_number, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            revision_id,
            landing_id,
            version_number,
            operation,
            snapshot.fisher_id,
            snapshot.fisher_name,
            snapshot.fisher_number,
            snapshot.vessel_id,
            snapshot.vessel_name,
            snapshot.vessel_number,
            snapshot.landing_date,
            snapshot.invoice_number,
            now()
        ],
    )?;
    transaction.execute(
        "INSERT INTO landing_revision_items(id, revision_id, fishstock_code, description, quantity, reporting_unit, display_order)
         SELECT lower(hex(randomblob(16))), ?1, li.fishstock_code, f.description,
                li.quantity, li.reporting_unit, li.display_order
         FROM landing_items li JOIN fishstock_codes f ON f.code = li.fishstock_code
         WHERE li.landing_id = ?2 ORDER BY li.display_order",
        params![revision_id, landing_id],
    )?;
    Ok(())
}

fn validate_catalogue(document: &CatalogueDocument) -> AppResult<()> {
    if document.schema_version != 2 {
        return Err(AppError::Validation(
            "Unsupported catalogue schema version.".to_owned(),
        ));
    }
    if document.catalogue_version == 0 {
        return Err(AppError::Validation(
            "Catalogue version must be positive.".to_owned(),
        ));
    }
    chrono::DateTime::parse_from_rfc3339(&document.generated_at).map_err(|_| {
        AppError::Validation("Catalogue generation time must be valid ISO-8601.".to_owned())
    })?;
    required_text(&document.source, "Catalogue source", 200)?;
    if document.records_sha256.len() != 64
        || !document
            .records_sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(AppError::Validation(
            "Catalogue records checksum is invalid.".to_owned(),
        ));
    }
    if document.records.is_empty() || document.records.len() > 100_000 {
        return Err(AppError::Validation(
            "Catalogue must contain between 1 and 100,000 records.".to_owned(),
        ));
    }
    let records_json = serde_json::to_vec(&document.records)?;
    let actual_checksum = hex::encode(Sha256::digest(records_json));
    if document.records_sha256 != actual_checksum {
        return Err(AppError::Validation(
            "Catalogue records checksum does not match its contents.".to_owned(),
        ));
    }
    let mut codes = HashSet::new();
    for record in &document.records {
        let code = fishstock_code(&record.code)?;
        if !codes.insert(code.clone()) {
            return Err(AppError::Validation(format!(
                "Duplicate catalogue code {code}."
            )));
        }
        required_text(&record.description, "Fishstock description", 500)?;
        if !is_reporting_unit(&record.reporting_unit) {
            return Err(AppError::Validation(format!(
                "Unsupported reporting unit for fishstock {code}."
            )));
        }
    }
    Ok(())
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub(crate) const GREENWEIGHT_KG: &str = "greenweightKg";
pub(crate) const MEATWEIGHT_KG: &str = "meatweightKg";
pub(crate) const COUNT: &str = "count";

fn is_reporting_unit(value: &str) -> bool {
    matches!(value, GREENWEIGHT_KG | MEATWEIGHT_KG | COUNT)
}
