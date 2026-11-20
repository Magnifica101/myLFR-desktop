# myLFR Desktop

myLFR Desktop is free Windows software for Licensed Fish Receivers (LFRs). It gives you an easy way to record the fish you receive from each permit holder and vessel, and turns those records into the monthly figures you need for your Licensed Fish Receiver Return (LFRR). myLFR prepares the figures; you still check them and file your return with FishServe yourself.

Your records stay on your own computer. There is no account to set up, and your records are never sent over the internet. Each installation is for one LFR business.

## What you need to know before using myLFR Desktop

**myLFR Desktop is free, open-source software released under Creative Commons Zero (CC0 1.0).** It has been placed in the public domain: nobody owns it, and anyone may use, copy, change or share it.

1. **You are responsible for your returns.** myLFR helps you record landings and prepare figures, but it never files or submits anything. Check its figures against your own records before you use them in a return. You remain responsible for your returns being accurate and filed on time.
2. **There is no warranty.** Because myLFR is free and in the public domain, it is provided as it is, with no promise that it is free of mistakes or right for your business. As far as the law allows, nobody involved in making it is responsible for any loss that comes from using it.
3. **It is not an official product.** myLFR is not made by, connected with, or endorsed by Fisheries New Zealand, the Ministry for Primary Industries, or FishServe.
4. **Your records stay on this computer.** myLFR never sends your records anywhere. Keeping backups is up to you: choose a backup folder in Settings, ideally on a USB drive, OneDrive or other cloud storage.
5. **Support is not guaranteed.** You can report problems on GitHub, and the maintainer will look at them when they can.

## What myLFR does

**Recording landings**

- Enter each landing: the permit holder, the vessel, the invoice number, and which fish and how much.
- Weights are saved exactly as you type them, to two decimal places.
- If you change or delete a landing, myLFR keeps a copy of how it was before.
- Find any landing by date, permit holder, vessel, fish or invoice number.
- Keep a list of your permit holders and their vessels. A vessel used by more than one permit holder only needs entering once.
- All 12,256 fishstock codes are built in. Mark the ones you use most as favourites, and add new codes yourself.
- Greenweight, scallop meatweight and counted fish are always added up separately, never mixed.

**Returns and reports**

- The Home page shows your totals for the fishing year and how many days are left until your return is due on the 15th.
- Print or save a monthly summary for each permit holder, as a PDF or Excel file, with your business logo.
- Save your landings to Excel, with charts showing what came in and who it came from.
- Take a full copy of all your records out of myLFR at any time.

**Keeping your records safe**

- Your records stay on your computer. Nothing is sent anywhere, and there is no account to set up.
- myLFR backs up your records each day you make changes, to a folder you choose, such as a USB stick or OneDrive.
- If your computer breaks, install myLFR on a new one and restore your latest backup.
- Before restoring, myLFR checks the backup is complete and undamaged. If anything goes wrong, your records are put back as they were.

**Updates**

- myLFR only updates when you say so. It reminds you once a month to check, or it can check every day if you prefer.
- Before every update, it checks the update really came from myLFR and backs up your records.

**Help**

- Plain-English answers to common questions, even without internet, and a **Help** button on every page.
- Something not working? **Settings → Bug report** helps you report it, without sharing any business details.

## Stack

- React 19, TypeScript, Vite, React Router, and React Query in the webview.
- Tauri 2 and Rust at the desktop trust boundary.
- SQLite with embedded migrations, exact scaled landing quantities, foreign keys, WAL, full synchronous writes, and immutable landing revisions.
- Independently versioned SQLite migrations and backup compatibility checks so supported older installations can be upgraded safely.
- ExcelJS and PDFMake are click-loaded for offline XLSX and PDF exports.

The React application calls only the typed commands in `src/lib/desktop.ts`. Rust performs validation and owns every database transaction. There is intentionally no generic SQL command.

## Licence and contributions

myLFR Desktop is dedicated to the public domain under [CC0 1.0 Universal](LICENSE). The author has waived all copyright and related rights in it to the extent the law allows, and nobody owns it. Anyone may use, copy, modify, or redistribute it for any purpose without asking or giving credit. As the licence states, it is provided as is, with no warranty. A receiver remains responsible for the accuracy and filing of their own returns.

Bug reports are welcome on the [issue tracker](https://github.com/Magnifica101/myLFR-desktop/issues/new/choose). Outside code changes are not accepted: pull requests are closed without review, because a subtle defect in weight arithmetic or landing revisions may have consequences for the receiver using it. You are free to fork. Security vulnerabilities must be reported privately as described in [SECURITY.md](SECURITY.md), never in a public issue. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Prerequisites are Node 22, Rust stable, and the platform dependencies listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
nvm use
npm ci --ignore-scripts
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
npm run desktop:dev
```

`npm run desktop:dev` merges `src-tauri/tauri.dev.conf.json`, which uses the separate
`nz.co.mylfr.desktop.dev` application identifier. Development therefore opens its own
`mylfr.sqlite3` in the platform's local application-data directory instead of the installed
pilot application's database. Release builds continue to use `nz.co.mylfr.desktop`.

The `--no-default-features` Rust test target exercises the database and backup/restore without requiring a graphical Linux Tauri runtime. Windows installers are built in Windows CI.

## Local data and recovery

- Live data: `%LOCALAPPDATA%\nz.co.mylfr.desktop\mylfr.sqlite3` through Tauri's application-data resolver.
- Protection: Windows account access plus BitLocker/device encryption. There is no app password.
- Backups: `.mylfr-backup` ZIP packages containing a safe SQLite copy and a checksummed manifest.
- Compatibility: backups record the application, database schema, backup format, and catalogue versions. A newer app can restore a supported older schema and migrate it forward; matching the exact app version is not required.
- Schedule: after the first successful data change each day when a destination is configured.
- Retention: 30 newest daily files plus the newest file from each of 12 months.
- Destination checks: warn when the selected folder is unavailable or appears to share the live database's storage volume.
- Restore: verifies file shape, SHA-256, application ID, the exact versioned SQLite schema and triggers, foreign keys, and SQLite integrity; it then migrates and normalizes a staged copy before atomic replacement, with a pre-restore safety copy for rollback. The restored installation uses the trusted catalogue bundled with the app and requires its backup folder to be selected again.

Backup files are not independently encrypted. Users must choose a trusted OneDrive, network, or encrypted removable destination.

The migration ledger, compatibility rules, and required test matrix are in
[docs/database-versioning.md](docs/database-versioning.md).

## Fishstock catalogue

The application ships with a frozen list of 12,256 fishstocks in [`src-tauri/resources/fishstock-catalogue.json`](src-tauri/resources/fishstock-catalogue.json), taken from an earlier version of myLFR on 26 August 2026. It seeds a new database and is never applied to an existing one: application updates do not change the list. `npm run catalogue:validate` checks the file's structure and checksum.

New fishstocks appear over time, and receivers add them themselves on the Species page, choosing how each is measured and which fishing year it belongs to. Built-in stocks are read-only. A receiver can edit or remove only stocks they added; a stock's code and reporting unit lock once a landing uses it, and nothing a landing uses is ever deleted.

Restoring a backup re-establishes the built-in stocks from the bundled list, because a backup file is untrusted. Receiver-added stocks are kept, after each passes the same validation as one added in the app.

Fishstocks do not all share one fishing year. Which catalogue stocks fall in the October, April, and February years, and how receiver-added stocks are handled, are in [docs/fishing-year-rules.md](docs/fishing-year-rules.md).

## Windows releases

Receiver-facing installation, update, uninstall, and backup guidance is in [docs/installing-windows.md](docs/installing-windows.md).

The `Release Windows` workflow builds an x64 current-user NSIS installer for Windows 10 22H2 and Windows 11. Public releases are unsigned: Windows shows them as from an unknown publisher, and receivers check the download against the release page instead (see [docs/installing-windows.md](docs/installing-windows.md)). Its default dispatch creates an unpublished pilot artifact signed by the stable self-signed `myLFR Desktop Pilot Testing` certificate. The artifact includes only the public certificate, fingerprint-pinned trust/removal scripts, and tester instructions; its private key never leaves protected local storage and GitHub Actions secrets.

The workflow has three signing modes:

- `pilot-self-signed` for testing on explicitly enrolled computers;
- `unsigned` for public releases;
- `production` for a publicly trusted certificate, if one is ever adopted.

Every run uploads its packages as a private GitHub Actions artifact. With `publish` enabled, an `unsigned` or `production` run also creates a **draft** GitHub release tagged `v<version>` with the installer, its `.sig`, `latest.json` and `SHA256SUMS.txt`. A draft is invisible to receivers and to the updater until the maintainer reviews and publishes it. The workflow rejects any attempt to publish a pilot-signed build. The signing job also records a GitHub build provenance attestation for the installer, which anyone can check with `gh attestation verify <installer> --repo Magnifica101/myLFR-desktop`.

The protected `signing` environment holds only signing secrets:

- `PILOT_WINDOWS_CERTIFICATE_BASE64`
- `PILOT_WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The protected `production` environment holds no secrets; its publication job uses the workflow's own GitHub token with permission only to create the draft release.

Repository variables available to the secretless build pin public identities:

- `PILOT_WINDOWS_CERTIFICATE_THUMBPRINT`
- `WINDOWS_CERTIFICATE_THUMBPRINT`

The workflow builds and tests without secrets, then imports the selected Authenticode certificate only in the isolated signing and bundling job. For signed modes it verifies the executable and installer against the pinned signer and removes imported signing material. It then writes `latest.json`, pointing at the installer's GitHub release download, and `SHA256SUMS.txt`. A separate protected publication job creates the draft GitHub release.

The pilot certificate is not publicly trusted and must never be presented as production security. Testers install `distribution/pilot/myLFR-Desktop-Pilot.cer` into their current user's Trusted Root and Trusted Publishers stores using the included fingerprint-pinned script, then remove it after testing. This enrollment trusts any test binary signed by that pilot key until the certificate is removed or expires.

The updater public key is committed in `tauri.conf.json`; its encrypted private key remains outside the repository and is supplied only to the isolated bundle step through GitHub Actions secrets. The resulting Tauri signature is checked by the updater before anything is installed. A signed build also requires a valid Authenticode signature from the publisher thumbprint compiled into it. An unsigned release build is compiled with `MYLFR_UNSIGNED_WINDOWS_RELEASE=1` and relies on the Tauri signature alone; a build with neither setting, such as a development build, refuses to install updates.

## Verification

Pull requests run:

- npm dependency audit (any exception is named, with its reason, in `scripts/audit-npm.mjs`), repository security policy, and fishstock catalogue validation;
- TypeScript production build;
- Vitest bridge, setup, exact-weight, PDF, XLSX, fishstock, update, and notice tests;
- Rust migration, constraint, landing transaction/revision, fishstock, update, checksum, and backup/restore tests;
- Rust migration compatibility tests covering every supported schema, older-schema backup restore, future-schema rejection, and failed-migration version safety.

A production candidate must additionally be installed and smoke-tested on a current Windows 11 x64 machine, including offline use, print/PDF, update, backup, and replacement-PC restore. Windows 10 testing was waived on 2026-08-28 because no Windows 10 machine is available.
