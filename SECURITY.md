# Security and privacy model

myLFR Desktop is a single-business, single-Windows-user local application.

- No Supabase, authentication, cloud sync, Google Analytics, address autocomplete, or telemetry is present at runtime. The only network traffic the application starts by itself is the update check, and only if the user turns on automatic checks; a restored backup always resets that setting to manual.
- The Tauri webview has a restrictive CSP and no direct filesystem, network, or SQL authority.
- Rust validates all inputs and performs database writes transactionally.
- Application updates require both an Authenticode-signed installer and a valid Tauri updater signature.
- The fishstock catalogue is bundled with the application and never updated separately. Restoring a backup re-establishes the official stocks from it and validates every stock the receiver added.
- Support diagnostics exclude the database path, backup path, business identity, permit holders, vessels, landings, and weights.

Users must secure their Windows account, enable BitLocker/device encryption, and select an access-controlled backup destination. Unencrypted backup packages should be handled as commercially sensitive records.

## Supported versions

Only the latest release receives security fixes. Older versions are not patched;
update to the latest release instead.

## Reporting a vulnerability

Report security vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/Magnifica101/myLFR-desktop/security/advisories/new)
(the repository's **Security** tab, then **Report a vulnerability**). Never open
a public issue for a vulnerability: disclosing it before a fix ships exposes
every installed copy.

This applies in particular to anything that could get around updater signature
verification, Authenticode checks, or backup validation before restore.

The maintainer aims to acknowledge a report within 14 days. This is a
one-person project maintained on a best-effort basis, so no fix time is
promised; you will be told what is planned once the report has been assessed.

Do not attach a production database or backup to a report; use the sanitized
problem report from **Settings → Bug report** instead.

Ordinary bugs that are not security problems go to the public
[issue tracker](https://github.com/Magnifica101/myLFR-desktop/issues/new/choose).
