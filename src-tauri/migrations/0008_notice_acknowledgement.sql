-- The plain-English responsibilities notice shown before first use. The
-- acknowledgement is stored only on this computer, with the version of the
-- notice the user saw, so a materially changed notice is shown again.
ALTER TABLE app_settings ADD COLUMN notice_acknowledged_version INTEGER
  CHECK (notice_acknowledged_version IS NULL OR notice_acknowledged_version >= 1);
ALTER TABLE app_settings ADD COLUMN notice_acknowledged_at TEXT;
