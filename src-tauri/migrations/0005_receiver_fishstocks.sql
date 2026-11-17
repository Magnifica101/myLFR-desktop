-- Receiver-maintained fishstocks. The shipped catalogue stays read-only; a
-- receiver may add their own stocks. Nothing can predict the fishing year of a
-- code that did not exist when the application was built, so a receiver-added
-- stock stores the year the receiver chose. Catalogue stocks keep deriving
-- their year from the code, so they never store one.
ALTER TABLE fishstock_codes ADD COLUMN is_user_added INTEGER NOT NULL DEFAULT 0
  CHECK (is_user_added IN (0, 1));

-- February (1), April (3), or October (9): the same month encoding as
-- app_settings.fishing_year_start_month. coalesce() makes a missing year fail
-- the check instead of passing it as unknown.
ALTER TABLE fishstock_codes ADD COLUMN fishing_year_start_month INTEGER
  CHECK (
    CASE WHEN is_user_added = 1
      THEN coalesce(fishing_year_start_month IN (1, 3, 9), 0)
      ELSE fishing_year_start_month IS NULL
    END
  );
