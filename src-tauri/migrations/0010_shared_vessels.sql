-- One vessel identity per valid registration. Invalid legacy registrations remain
-- separate and visible for correction; they are never guessed or name-matched.
CREATE TABLE vessels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  vessel_number TEXT,
  registration_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (registration_key IS NULL OR (
    registration_key = vessel_number AND length(registration_key) BETWEEN 1 AND 60
    AND substr(registration_key, 1, 1) BETWEEN '1' AND '9'
    AND registration_key NOT GLOB '*[^0-9]*'
  ))
) STRICT;

-- Keep the original rows as compatibility references: existing landings have
-- foreign keys to their IDs, and immutable revisions may contain those IDs.
ALTER TABLE fisher_vessels ADD COLUMN vessel_id TEXT REFERENCES vessels(id) ON DELETE RESTRICT;

INSERT INTO vessels(id, name, vessel_number, registration_key, created_at, updated_at)
SELECT id, name,
       CASE WHEN vessel_number IS NOT NULL THEN trim(vessel_number) END,
       CASE WHEN length(trim(vessel_number)) BETWEEN 1 AND 60
              AND substr(trim(vessel_number), 1, 1) BETWEEN '1' AND '9'
              AND trim(vessel_number) NOT GLOB '*[^0-9]*'
            THEN trim(vessel_number) END,
       created_at, updated_at
FROM fisher_vessels old
WHERE id = (
  SELECT min(other.id) FROM fisher_vessels other
  WHERE other.id = old.id OR (
    length(trim(old.vessel_number)) BETWEEN 1 AND 60
    AND substr(trim(old.vessel_number), 1, 1) BETWEEN '1' AND '9'
    AND trim(old.vessel_number) NOT GLOB '*[^0-9]*'
    AND trim(other.vessel_number) = trim(old.vessel_number)
  )
);

UPDATE fisher_vessels SET vessel_id = coalesce(
  (SELECT id FROM vessels WHERE registration_key = trim(fisher_vessels.vessel_number)),
  id
);
CREATE INDEX fisher_vessels_vessel_idx ON fisher_vessels(vessel_id, fisher_id);
CREATE TRIGGER fisher_vessels_require_identity_insert
BEFORE INSERT ON fisher_vessels WHEN NEW.vessel_id IS NULL
BEGIN SELECT RAISE(ABORT, 'vessel reference requires a shared identity'); END;
CREATE TRIGGER fisher_vessels_require_identity_update
BEFORE UPDATE OF vessel_id ON fisher_vessels WHEN NEW.vessel_id IS NULL
BEGIN SELECT RAISE(ABORT, 'vessel reference requires a shared identity'); END;

CREATE TABLE permit_holder_vessels (
  fisher_id TEXT NOT NULL REFERENCES fishers(id) ON DELETE CASCADE,
  vessel_id TEXT NOT NULL REFERENCES vessels(id) ON DELETE RESTRICT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fisher_id, vessel_id)
) STRICT;
INSERT INTO permit_holder_vessels(fisher_id, vessel_id, is_archived, created_at, updated_at)
SELECT fisher_id, vessel_id, min(is_archived), min(created_at), max(updated_at)
FROM fisher_vessels GROUP BY fisher_id, vessel_id;
CREATE INDEX permit_holder_vessels_vessel_idx ON permit_holder_vessels(vessel_id);
CREATE INDEX landing_revisions_fisher_vessel_idx ON landing_revisions(fisher_id, vessel_id);
