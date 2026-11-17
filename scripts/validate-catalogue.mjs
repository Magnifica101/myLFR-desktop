import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const path = new URL('../src-tauri/resources/fishstock-catalogue.json', import.meta.url);
const source = await readFile(path, 'utf8');
const catalogue = JSON.parse(source);
if (catalogue.schemaVersion !== 2 || !Number.isInteger(catalogue.catalogueVersion)) {
  throw new Error('Unsupported catalogue metadata.');
}
if (!Array.isArray(catalogue.records) || catalogue.records.length === 0 || catalogue.records.length > 100_000) {
  throw new Error('Catalogue record count is invalid.');
}
const seen = new Set();
for (const record of catalogue.records) {
  if (!/^[A-Z0-9/-]{1,20}$/.test(record.code) || !String(record.description).trim() || !['greenweightKg', 'meatweightKg', 'count'].includes(record.reportingUnit)) {
    throw new Error(`Invalid catalogue record: ${JSON.stringify(record)}`);
  }
  if (seen.has(record.code)) throw new Error(`Duplicate catalogue code: ${record.code}`);
  seen.add(record.code);
}
const recordsSha256 = createHash('sha256').update(JSON.stringify(catalogue.records)).digest('hex');
if (catalogue.recordsSha256 !== recordsSha256) {
  throw new Error('Catalogue records checksum does not match its contents.');
}
console.log(
  `Validated ${catalogue.records.length} records; SHA-256 ${createHash('sha256').update(source).digest('hex')}`,
);
