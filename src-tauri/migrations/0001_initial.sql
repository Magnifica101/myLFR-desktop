CREATE TABLE IF NOT EXISTS business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lfr_name TEXT NOT NULL CHECK (length(trim(lfr_name)) BETWEEN 1 AND 120),
  client_number TEXT NOT NULL CHECK (length(trim(client_number)) BETWEEN 1 AND 60),
  street_number TEXT NOT NULL DEFAULT '',
  street_name TEXT NOT NULL DEFAULT '',
  street_type TEXT NOT NULL DEFAULT '',
  suburb TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS fishers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  permit_number TEXT NOT NULL CHECK (length(trim(permit_number)) BETWEEN 1 AND 60),
  normalized_permit_number TEXT NOT NULL UNIQUE,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS fisher_vessels (
  id TEXT PRIMARY KEY,
  fisher_id TEXT NOT NULL REFERENCES fishers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  vessel_number TEXT CHECK (vessel_number IS NULL OR length(trim(vessel_number)) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS fisher_vessels_fisher_idx ON fisher_vessels(fisher_id);

CREATE TABLE IF NOT EXISTS fishstock_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  catalogue_version INTEGER NOT NULL CHECK (catalogue_version >= 1),
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS fishstock_codes_active_code_idx
  ON fishstock_codes(is_active, code);
CREATE INDEX IF NOT EXISTS fishstock_codes_active_description_idx
  ON fishstock_codes(is_active, description COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS favorite_fishstocks (
  code TEXT PRIMARY KEY REFERENCES fishstock_codes(code) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS landings (
  id TEXT PRIMARY KEY,
  fisher_id TEXT NOT NULL REFERENCES fishers(id) ON DELETE RESTRICT,
  vessel_id TEXT REFERENCES fisher_vessels(id) ON DELETE RESTRICT,
  landing_date TEXT NOT NULL CHECK (
    length(landing_date) = 10 AND
    substr(landing_date, 5, 1) = '-' AND
    substr(landing_date, 8, 1) = '-'
  ),
  invoice_number TEXT CHECK (invoice_number IS NULL OR length(trim(invoice_number)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS landings_date_idx ON landings(landing_date);
CREATE INDEX IF NOT EXISTS landings_fisher_date_idx ON landings(fisher_id, landing_date);
CREATE INDEX IF NOT EXISTS landings_vessel_date_idx ON landings(vessel_id, landing_date);

CREATE TABLE IF NOT EXISTS landing_items (
  id TEXT PRIMARY KEY,
  landing_id TEXT NOT NULL REFERENCES landings(id) ON DELETE CASCADE,
  fishstock_code TEXT NOT NULL REFERENCES fishstock_codes(code) ON DELETE RESTRICT,
  greenweight_centi_kg INTEGER NOT NULL CHECK (greenweight_centi_kg > 0),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  UNIQUE (landing_id, fishstock_code)
) STRICT;

CREATE INDEX IF NOT EXISTS landing_items_landing_idx ON landing_items(landing_id);
CREATE INDEX IF NOT EXISTS landing_items_code_idx ON landing_items(fishstock_code);

CREATE TABLE IF NOT EXISTS landing_revisions (
  id TEXT PRIMARY KEY,
  landing_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('save', 'delete')),
  fisher_id TEXT,
  fisher_name TEXT NOT NULL,
  fisher_number TEXT NOT NULL,
  vessel_id TEXT,
  vessel_name TEXT,
  vessel_number TEXT,
  landing_date TEXT NOT NULL,
  invoice_number TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (landing_id, version_number)
) STRICT;

CREATE INDEX IF NOT EXISTS landing_revisions_landing_idx
  ON landing_revisions(landing_id, version_number);
CREATE INDEX IF NOT EXISTS landing_revisions_operation_date_idx
  ON landing_revisions(operation, created_at DESC);

CREATE TABLE IF NOT EXISTS landing_revision_items (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES landing_revisions(id) ON DELETE RESTRICT,
  fishstock_code TEXT NOT NULL,
  description TEXT NOT NULL,
  greenweight_centi_kg INTEGER NOT NULL CHECK (greenweight_centi_kg > 0),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  UNIQUE (revision_id, fishstock_code)
) STRICT;

CREATE INDEX IF NOT EXISTS landing_revision_items_revision_idx
  ON landing_revision_items(revision_id);

CREATE TABLE IF NOT EXISTS app_settings (
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

INSERT OR IGNORE INTO app_settings(id, schema_version, catalogue_version)
VALUES (1, 1, 1);

CREATE TRIGGER IF NOT EXISTS landing_revisions_no_update
BEFORE UPDATE ON landing_revisions
BEGIN
  SELECT RAISE(ABORT, 'landing revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS landing_revisions_no_delete
BEFORE DELETE ON landing_revisions
BEGIN
  SELECT RAISE(ABORT, 'landing revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS landing_revision_items_no_update
BEFORE UPDATE ON landing_revision_items
BEGIN
  SELECT RAISE(ABORT, 'landing revision items are immutable');
END;

CREATE TRIGGER IF NOT EXISTS landing_revision_items_no_delete
BEFORE DELETE ON landing_revision_items
BEGIN
  SELECT RAISE(ABORT, 'landing revision items are immutable');
END;
