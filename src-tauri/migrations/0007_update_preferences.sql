-- How application update checks are triggered. Checking is the only ordinary
-- reason myLFR contacts the internet, so it stays manual until the user
-- chooses otherwise.
ALTER TABLE app_settings ADD COLUMN app_update_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (app_update_mode IN ('manual', 'automatic'));

-- When the user last set aside the monthly update reminder. It silences only
-- the reminder cycle it falls in.
ALTER TABLE app_settings ADD COLUMN update_reminder_dismissed_at TEXT;
