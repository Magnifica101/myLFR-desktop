# Security and privacy model

myLFR Desktop is a single-business, single-Windows-user local application.

- There are no accounts, cloud sync, analytics, or telemetry. The only network traffic the application starts by itself is the update check, and only if the user turns on automatic checks; a restored backup always resets that setting to manual.
- The Tauri webview has a restrictive CSP and no direct filesystem, network, or SQL authority.
- Rust validates all inputs and performs database writes transactionally.
- Application updates install only with a valid updater signature from the project's signing key. Releases are not Authenticode-signed; each release publishes SHA-256 checksums (`SHA256SUMS.txt`) and a GitHub build provenance attestation, so a downloaded installer can be checked with `gh attestation verify <installer> --repo Magnifica101/myLFR-desktop`.
- The fishstock catalogue is bundled with the application and never updated separately. Restoring a backup re-establishes the built-in stocks from it and validates every stock the receiver added.
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

No response time, reply or fix is guaranteed. myLFR is free software provided
as is.

Do not attach a production database or backup to a report; use the sanitized
problem report from **Settings → Bug report** instead.

Ordinary bugs that are not security problems go to the public
[issue tracker](https://github.com/Magnifica101/myLFR-desktop/issues/new/choose).
