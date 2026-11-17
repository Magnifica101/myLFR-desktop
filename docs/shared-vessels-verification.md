# Shared vessel verification — 2026-11-07

Schema 10 introduces shared vessel identities and separate permit holder links.
The backup package remains format 1. Earlier migrations are unchanged.

## Automated checks

- 93 Rust tests passed in the working tree with `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked`. The exact staged source was also exported and tested separately: all 90 tests passed without the three pre-existing, uncommitted security regression tests.
- 87 frontend tests passed with `npm test -- --maxWorkers=2 --reporter=dot`.
- Coverage includes strict numeric registrations and outside trimming, explicit linking,
  duplicate-link rollback, a shared name, independent archives, protection from removal
  after deleted landing history, separate permit holder report totals, and one vessel
  in dashboard counts for two permit holders.
- The migration and backup matrices cover every supported schema through 10.
  Dedicated schema-9 duplicate fixtures retain original stored landing references
  and immutable snapshot rows. A late failure in migration 10 rolls the entire
  migration back to schema 9.

## Native Windows development check

Used the native Tauri/WebView2 window and its documented local debugging interface.
An isolated application identifier opened a verified copy of the long-lived schema-9
development database. Its backup destination was cleared in that copy before testing.
No test holders or landings were added to the working or installed database.

The real editor offered an existing vessel for a 19-digit numeric registration,
saved the link under a second permit holder with the same vessel ID, archived only
the first link, and restored it. An archived link rejected a new landing while
the other holder could save one. Earlier revisions and existing business records
were compared before and after and remained unchanged. Screenshots of the link
offer and archive confirmation were inspected in WebView2.

The first test run reached successful link and archive saves, then its assertion
lost the structured Tauri rejection message during test serialization. The harness
was corrected to preserve command error objects and resumed at that point; the
second run passed. This was a test assertion failure in the isolated copy.

This check does not constitute packaged installer, signing, updater or release
verification. Those remain under `HANDOFF.md`.

## Working development database

After the isolated check, reopened the normal Windows development app against
its long-lived database. Schema 9 migrated to 10. A consistent SQLite backup
copy passed integrity and foreign-key checks, and every pre-existing table was
compared using all its original columns against the pre-migration safety snapshot:
no original rows changed. The database has six shared vessel identities and six
permit holder links. The verified safety snapshot is retained locally outside
the repository. The normal app is left on Permit holders without an open editor.

The final frontend build, security policy, catalogue validation, Rust formatting
and Git whitespace checks passed.
