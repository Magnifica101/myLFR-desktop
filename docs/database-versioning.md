# Database versioning and compatibility

myLFR has several different kinds of version. They must not be treated as
interchangeable:

| Version | Meaning | Where it is recorded |
| --- | --- | --- |
| Application version | The installed program, such as `0.6.0` | Tauri/package metadata and backup manifest |
| Database schema version | The structure and data rules used by SQLite | SQLite `PRAGMA user_version` |
| Backup format version | The shape of the `.mylfr-backup` ZIP package | Backup manifest |
| Catalogue version | The bundled fishstock catalogue data | `app_settings.catalogue_version` |

The database schema is currently version `10`. The authoritative migration ledger
is `SCHEMA_MIGRATIONS` in `src-tauri/src/db.rs`. The supported backup range is
defined there by `MIN_SUPPORTED_SCHEMA_VERSION` and `CURRENT_SCHEMA_VERSION`.
The backup package format is version `1` in `src-tauri/src/backup.rs`.

## Rules for changing the schema

1. Add one new, numbered SQL file for each schema change, such as
   `0005_add_example.sql`.
2. Append the migration to `SCHEMA_MIGRATIONS` and increase
   `CURRENT_SCHEMA_VERSION` to the same number.
3. Set `PRAGMA user_version` to that migration's exact number after its
   transaction commits. Never set an earlier migration to a future number.
4. Do not edit or renumber an old migration. Existing installations and backup
   files may still need to pass through it. Restore compares a backup's stored
   schema exactly against a replay of these files, so an edit also makes every
   backup of a database created before it unrestorable. This happened once:
   `0001_initial.sql` was edited on 2026-08-13 to change a column default, and
   every database created before then could not have its backups restored
   until migration `0006` rebuilt the affected table.
5. Keep migrations transactional. Avoid destructive changes; when a change
   needs a data conversion, preserve the old data until the conversion has
   been checked.
6. Do not change the schema number for a normal application-code change. Do
   change it for a persisted table, index, trigger, constraint, column, or
   data-rule change that needs a migration.

The bundled catalogue has its own version. It is frozen and only seeds new
databases, so a catalogue change is never a database schema migration.

## Compatibility behaviour

When a newer app opens an older supported database, it runs the missing
migrations in order and then opens the database at the current schema. This is
the normal update path.

When an older app encounters a database with a higher schema number, it refuses
to open it. This prevents an older program from interpreting a newer structure
incorrectly. Downgrades require restoring a backup that the older app supports.

Backups record both the application version and schema version, but restore
compatibility is based on the schema and backup format—not on requiring the
same application version. A newer app validates an older supported backup at
its original schema, replaces the database only after validation succeeds, and
then runs the normal migrations. If reopening or migrating fails, the restore
rolls back to the previous database.

## Required tests for every schema change

The Rust test suite must continue to cover all of these:

- each supported old schema migrates to the current schema without losing
  representative business data;
- a failed migration leaves `user_version` at the last committed migration;
- backups from every supported schema validate and restore into the current
  schema;
- current backups still round-trip;
- future or unsupported schema versions are rejected;
- checksums, SQLite integrity, foreign keys, and the authoritative schema
  boundary continue to be enforced; and
- a restore failure leaves the original live database recoverable.

The matrix tests are in `src-tauri/src/tests.rs`. When a new schema version is
added, extend the migration ledger and its representative test data as needed;
the ranges in the existing matrix tests will then include the new version.

Before a release, record the four version values in the release notes or
handoff. When investigating an old backup, inspect its `manifest.json` for
`applicationVersion`, `schemaVersion`, `formatVersion`, and
`catalogueVersion`. Do not infer compatibility from the filename or from the
application version alone.

## Shared vessel identities (schema 10)

`vessels` holds one identity for each valid registration number. Its unique
`registration_key` contains ASCII digits starting with 1–9; outside whitespace
is trimmed and names never participate in matching. Invalid legacy numbers
have a null key and stay separate until reviewed. Conflicting recorded names
are retained and shown in the editor.

`permit_holder_vessels` links each identity to its permit holders and holds the
archive status independently for each pair. `fisher_vessels` remains a legacy
reference map: old landings have foreign keys to its row IDs and immutable
revisions can contain those IDs. Every reference maps to the shared identity.
Public commands, report grouping, vessel filters and dashboard counts use the
shared ID; the original stored references and revision snapshots are not
rewritten. This preserves history while letting one vessel fish for multiple
permit holders. New links require explicit selection of the existing vessel.
