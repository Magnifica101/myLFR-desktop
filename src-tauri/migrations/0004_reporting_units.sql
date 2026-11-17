ALTER TABLE fishstock_codes ADD COLUMN reporting_unit TEXT NOT NULL DEFAULT 'greenweightKg'
  CHECK (reporting_unit IN ('greenweightKg', 'meatweightKg', 'count'));

ALTER TABLE landing_items RENAME COLUMN greenweight_centi_kg TO quantity;
ALTER TABLE landing_items ADD COLUMN reporting_unit TEXT NOT NULL DEFAULT 'greenweightKg'
  CHECK (reporting_unit IN ('greenweightKg', 'meatweightKg', 'count'));

ALTER TABLE landing_revision_items RENAME COLUMN greenweight_centi_kg TO quantity;
ALTER TABLE landing_revision_items ADD COLUMN reporting_unit TEXT NOT NULL DEFAULT 'greenweightKg'
  CHECK (reporting_unit IN ('greenweightKg', 'meatweightKg', 'count'));
