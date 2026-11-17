ALTER TABLE fisher_vessels ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
CREATE INDEX landing_revisions_vessel_id ON landing_revisions(vessel_id);
