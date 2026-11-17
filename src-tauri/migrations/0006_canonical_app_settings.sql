-- Rebuild app_settings so every installation stores the same definition.
--
-- 0001_initial.sql was edited on 2026-08-13 to change the
-- fishing_year_start_month default from 3 to 9. Databases created before that
-- edit kept `DEFAULT 3` in their stored table definition; 0002 corrected the
-- stored value but cannot change a column default. Restore compares the stored
-- schema exactly against a replay of these migrations, so every backup of such
-- a database was refused.
--
-- Rebuilding the table gives old and new databases identical definitions, and
-- backups taken after this migration restore normally. Every value is kept.
CREATE TABLE app_settings_canonical (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL DEFAULT 1,
  catalogue_version INTEGER NOT NULL DEFAULT 1,
  backup_directory TEXT,
  last_backup_at TEXT,
  last_backup_path TEXT,
  last_app_update_check TEXT,
  last_catalogue_update_check TEXT,
  fishing_year_start_month INTEGER NOT NULL DEFAULT 9 CHECK (fishing_year_start_month IN (1, 3, 9))
) STRICT;

INSERT INTO app_settings_canonical(
  id, schema_version, catalogue_version, backup_directory, last_backup_at,
  last_backup_path, last_app_update_check, last_catalogue_update_check,
  fishing_year_start_month
)
SELECT
  id, schema_version, catalogue_version, backup_directory, last_backup_at,
  last_backup_path, last_app_update_check, last_catalogue_update_check,
  fishing_year_start_month
FROM app_settings;

DROP TABLE app_settings;
ALTER TABLE app_settings_canonical RENAME TO app_settings;
