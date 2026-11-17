# myLFR Desktop

Local-first Windows desktop software for a single Licenced Fish Receiver business per installation.

This is a separate product from the myLFR web application. It has no authentication, workspace roles, Supabase runtime dependency, cloud database, analytics, or telemetry. Operational records are stored in SQLite under the signed-in Windows user's private application-data directory.

## What you need to know before using myLFR Desktop

The application shows this notice before first use. Keep this copy in step with `src/components/ResponsibilitiesNotice.tsx`.

**myLFR Desktop is free, open-source software released under Creative Commons Zero (CC0 1.0).** It has been placed in the public domain: nobody owns it, and anyone may use, copy, change or share it.

1. **You are responsible for your returns.** myLFR helps you record landings and prepare figures, but it never files or submits anything. Check its figures against your own records before you use them in a return. You remain responsible for your returns being accurate and filed on time.
2. **There is no warranty.** Because myLFR is free and in the public domain, it is provided as it is, with no promise that it is free of mistakes or right for your business. As far as the law allows, nobody involved in making it is responsible for any loss that comes from using it.
3. **It is not an official product.** myLFR is not made by, connected with, or endorsed by Fisheries New Zealand, the Ministry for Primary Industries, or FishServe.
4. **Your records stay on this computer.** myLFR never sends your records anywhere. Keeping backups is up to you: choose a backup folder in Settings, ideally on a USB drive, OneDrive or other cloud storage.
5. **Support is not guaranteed.** You can report problems on GitHub, and the maintainer will look at them when they can.

## Stack

- React 19, TypeScript, Vite, React Router, and React Query in the webview.
- Tauri 2 and Rust at the desktop trust boundary.
- SQLite with embedded migrations, exact scaled landing quantities, foreign keys, WAL, full synchronous writes, and immutable landing revisions.
- Independently versioned SQLite migrations and backup compatibility checks so supported older installations can be upgraded safely.
- ExcelJS and PDFMake are click-loaded for offline XLSX and PDF exports.

The React application calls only the typed commands in `src/lib/desktop.ts`. Rust performs validation and owns every database transaction. There is intentionally no generic SQL command.

## Implemented workflows

- First-run local business setup with manual structured address entry, in plain language: `LFR name` and `Fishserve Client Number` with short explanations, Street type examples, and a "Keep your records safe" section recommending a backup folder off the computer (USB, OneDrive, Google Drive, or a network drive) that can be chosen later.
- Dashboard fishing-year context and metrics with whole-kilogram greenweight, return reminder, last-successful-backup timestamp in Data recovery, and manual backup. With no backup folder set, the Data recovery action is an enabled `Choose backup folder now` that opens the folder picker, becoming `Back up now` once a folder is chosen. Every KPI counts only activity inside the selected fishing year, so permit holders and vessels reflect who actually landed in the period rather than who is on file.
- Fishing-year switcher on the Home page beside the period heading, saving the same preference the Business settings selector writes.
- Searchable permit holders that start as compact name-and-number rows and expand to vessels and management actions, with archive/restore and history-safe removal rules.
- A simpler Add permit holder form: no archived-vessel filter or archive guidance (those appear only when editing), a note that vessels are optional for shore-based permit holders, and registration guidance beside each new vessel's fields.
- Archived status that stays visible: with archived permit holders or vessels shown, current and archived entries share one case-insensitive A–Z order in the list and editor; archived permit holders carry an **Archived** label even while collapsed (and in the summary's accessible name), archived vessels are labelled with a clear gap before the label, and the permit holder and vessel filters work independently.
- Adding a vessel in the permit holder editor scrolls to the new vessel, focuses its registration field and highlights it in green with a 4.5-second fade (instant scroll and a steady highlight with reduced motion). A vessel added in the current edit shows **New vessel** with a **Remove** button that takes it off the form at once; saved vessels keep Delete, Archive or Remove link with confirmation.
- Individual vessel archive/restore in the permit holder editor. Vessels with current or historical landings offer Archive; unused vessels offer Delete. Changes remain pending with Undo until Save, and Cancel discards them. Archived vessels can be shown and restored, stay on historical records, and are excluded from new landing selections. Full Excel exports include each vessel's active or archived status.
- Confirmation popups before archiving or deleting a permit holder, naming the holder and permit and explaining the consequences, with Cancel focused and Escape cancelling. Vessel archive, delete and shared-link removal confirm in the same way and stay pending with Undo until **Save permit holder**. Notifications name the completed action: archived, restored or deleted.
- Shared vessels matched only by registration number: one vessel identity can be linked to multiple permit holders, with independent archive/restore for each link. Enter a registration and choose `Use this vessel` when a match exists. New registrations contain digits only, start with 1–9 and allow only outside whitespace. Names remain editable shared details; saved registrations identify the vessel. Landings and reports keep their original permit holder, while vessel searches and dashboard counts use the shared identity. Schema 10 consolidates matching numeric registrations without rewriting immutable snapshots, and flags legacy registration or name differences for review.
- Collapsible side navigation with a locally persisted expanded/collapsed preference.
- Landing create/edit/delete, exact two-decimal kilogram or whole-count validation, immutable save versions, and retained read-only delete snapshots.
- Deleted landings in search. Deleting a landing asks for confirmation and explains that a read-only snapshot is kept. Ticking **Include archived (deleted) landings** in Search landings lists them in a table with the same columns and widths as the results above, the deletion time under the landing date, and a view button that opens the snapshot: date, permit holder and number, vessel and registration, invoice, and every fishstock with its description, quantity and unit.
- Landing quantities use the catalogue-defined reporting basis: greenweight kilograms, scallop meatweight kilograms, or whole-individual counts for OYU5. Landing pages, summaries, dashboard KPIs, history, and PDF/XLSX exports keep unlike units separate.
- Fishstock search and favourites using the bundled 12,256-record catalogue, which is frozen: application updates never change it.
- Receiver-maintained fishstocks on the Species page. A receiver adds stocks missing from the list, choosing the code, name, reporting unit, and fishing year (never pre-selected), after a warning when the new stock looks like an existing one. Added stocks are labelled, count in the fishing year the receiver chose, and are included in backups and the data export. Only receiver-added stocks can be edited or removed: the name and fishing year can always change, the code and reporting unit only until a landing uses the stock, and a stock any landing uses can't be removed.
- Landing search by fishstock code and by invoice number, alongside the date, permit holder and vessel filters. The fishstock code finds every landing that uses one stock; any part of an invoice number, in any case, finds the landing for an invoice in hand, including deleted landings when those are included.
- Monthly summaries grouped by three-letter fish type, with XLSX/PDF output.
- Monthly summaries are for one permit holder at a time, and the PDF and Excel file names include the month, the permit holder's name and their permit number. The Excel workbook keeps its summary sheet and adds a sheet for each vessel with two sections: the vessel's totals by fish type, then a line for every fishstock on each of its landings (date, invoice number, fishstock code and name, fish type, quantity and unit).
- Export data page that saves landings as one Excel table for pivot tables: a row for each fishstock on each landing, with the date (as a real Excel date), year, month, permit holder and number, vessel and number, invoice number, fishstock code and name, fish type, unit, and quantity as a number. It can be narrowed by dates, permit holder and vessel.
- Export data analysis of exactly the landings selected for the Excel file. The same date, permit holder, vessel, fishstock and quantity-type filters drive the file and the figures. Summary cards, in one row when the window is wide enough, show permit holders, landings, greenweight, count, fishstocks and vessels (with shore-based landings), plus meatweight when present, with kilograms to the nearest kg. Received over time is one line graph grouped by month, week (from Monday) or day, explorable by hover or arrow keys. Doughnut charts split the selected quantity by fishstock and by fish type (the three-letter group used in monthly summaries, named after its largest stock), and by permit holder and by vessel: the 10 largest as slices and the rest as Other, a legend beside each, and a list below of every entry with its quantity and share (shore-based receipts listed with "No vessel number"). Each chart has Greenweight, Meatweight and Count buttons that never change the filters or the file. The side navigation shows Export data with a file-output icon.
- Export data file names that identify the permit holder: `myLFR-landing-data-<permit holder>-<from>-to-<to>.xlsx`, or `All-permit-holders` when no permit holder is chosen. Without From and To dates, the name uses the first and last landing dates selected.
- Optional business logo on PDF reports, chosen in Settings under Your logo and resized to at most 600 pixels on upload so exports, the local database, and backups stay small.
- Settings page grouped into labelled Your business, Data safety, and About sections, with status-first backup guidance, secondary technical details, and simplified support and export actions.
- Settings About section, second pass: Application updates sits beside an open Versions card (application, fishstock catalogue and database schema, with the database file under Technical details), and Bug report is a collapsed, full-width card at the bottom of the page.
- Backup location guidance. The Database backups card points to its information button, which explains choosing a folder off the computer (USB, OneDrive, Google Drive, or a network drive), and letting sync finish. Home and Settings share one set of backup status names. Folder paths are shown without the Windows `\\?\` prefix. A same-drive warning appears when backups share a drive with the records, except for folders inside OneDrive; for other sync folders, such as Dropbox, it can be hidden for that folder and returns if a different folder is chosen.
- Plain-English Windows installer and uninstaller wording. The welcome, progress and finish screens, the reinstall choices (with a reminder to have a recent backup before upgrading), and the removal screens use everyday language. The removal option says it permanently deletes myLFR business records, and the final screen says the records were kept unless that option was chosen. If myLFR is still open, the installer stops and asks the receiver to close it normally instead of force-closing it.
- Button names in bold wherever app guidance mentions them: dialogs, help, FAQ answers, warnings and notifications. FAQ answers, status messages and notifications share one bold-text renderer, and native dialogs never show raw Markdown markers.
- Readable Excel workbook data export (one sheet per table, identifiers resolved to names, greenweight in kilograms) for taking records out of myLFR, alongside a schema-versioned full JSON export for migrating into another system.
- Sanitized diagnostics export including application versions, backup status, and a persistent capped local error log that records handled faults and Rust panics with filesystem paths and long numbers redacted.
- Native crash reporting with nothing sent off the device: a session marker left behind by a crash, an out-of-memory stop, a Task Manager kill, or a power loss is logged at the next launch. On Windows the entry adds the crash Windows Error Reporting recorded, the app's last error output, and a crash-handler stack trace of module names and offsets, never memory contents. WebView2 process failures are logged, and a crashed page reloads. Release runs keep debug symbols, not shipped, that `tools/crash-symbols` uses to turn traces into functions and lines; see `docs/crash-reports.md`.
- Backup/restore and Tauri application updates.
- A plain-English responsibilities notice, shown before first use and kept in Settings under About. It states that the software is CC0 public domain with no warranty, that the receiver remains responsible for their returns, that it is not an official Fisheries New Zealand, MPI, or FishServe product, that records stay on the computer, and that support is not guaranteed. The "I understand" acknowledgement is stored only on this computer with the notice version; a restore clears it, and a raised version shows the notice again.
- Discoverable application updates, set in Settings to **Manual** (the default on a new installation) or **Automatic**. Manual shows a blue download button at the bottom of the sidebar on the first Monday after the 15th, never on the 15th itself (return day), unless a check already succeeded in that cycle; it leads to the update action in Settings. Automatic checks at most once a day, and a found update shows the same button, which opens the install review. **Check for updates now** always checks, whenever the receiver asks. Nothing appears across the page. A check that can't reach the update server doesn't count and is reported plainly. Installing is always confirmed, shows the release notes and download progress, and backs up first by default. Restoring a backup resets the setting to Manual.
- Native Rust-owned file selection for backup, restore, export, and diagnostics, plus opening the configured backup folder in the system file explorer, with single-use restore authorization and no renderer-supplied filesystem paths.
- Minimal renderer capabilities with unused native image and plugin authority removed.
- Restore validation against the exact versioned SQLite tables, indexes, foreign keys, and triggers before replacement.
- Backup import enforces actual decompressed sizes (32 KiB manifest, 512,000,000-byte database), streams database extraction with a 64 KiB buffer and incremental SHA-256, and rejects incorrect lengths or checksums before touching live records.
- Runtime updates requiring a valid Tauri updater signature from the committed public key. Signed builds also require Authenticode from their build-pinned Windows publisher; unsigned public releases opt out of that check explicitly at build time.
- Secretless release builds, isolated signing and publication jobs, immutable GitHub Action revisions with controlled updates, and publication as a draft GitHub release carrying the installer, its updater signature, `latest.json`, and `SHA256SUMS.txt`, with GitHub build provenance attestation once the repository is public.
- External regulatory resources open in the system browser.
- In-app FAQ, bundled for offline use: plain-English answers grouped by when a receiver needs them (Before you start, Every landing, Return day, New fishing year, Keeping records safe, When something goes wrong), with search, "See also" links, and a **Help** button on every page heading that lists that page's questions and opens the chosen answer. Every answer was read against the finished screens on 2026-11-16.
- Settings → Bug report copies the sanitized problem report and opens the public GitHub bug report form in the system browser, with the app version filled in and a warning not to include business records. There is no support email.
- Receiver-facing Windows installation, update, uninstall, backup, and pilot-certificate guidance in [docs/installing-windows.md](docs/installing-windows.md).

Planned and proposed product capabilities are tracked in [FEATURES.md](FEATURES.md).

## Licence and contributions

myLFR Desktop is dedicated to the public domain under [CC0 1.0 Universal](LICENSE). The author has waived all copyright and related rights in it to the extent the law allows, and nobody owns it. Anyone may use, copy, modify, or redistribute it for any purpose without asking or giving credit. As the licence states, it is provided as is, with no warranty. A receiver remains responsible for the accuracy and filing of their own returns.

Bug reports are welcome on the [issue tracker](https://github.com/Magnifica101/myLFR-desktop/issues/new/choose). Outside code changes are not accepted: pull requests are closed without review, because a subtle defect in weight arithmetic or landing revisions has regulatory consequences for the receiver using it. You are free to fork. Security vulnerabilities must be reported privately as described in [SECURITY.md](SECURITY.md), never in a public issue. See [CONTRIBUTING.md](CONTRIBUTING.md).

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

What each kind of check proves, what it cannot, and which a change needs before it counts as verified are in [docs/testing.md](docs/testing.md).

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

The application ships with a frozen list of 12,256 official fishstocks in [`src-tauri/resources/fishstock-catalogue.json`](src-tauri/resources/fishstock-catalogue.json), exported once from the reference table of the earlier myLFR web application. It seeds a new database and is never applied to an existing one: application updates do not change the list. `npm run catalogue:validate` checks the file's structure and checksum.

New fishstocks appear over time, and receivers add them themselves on the Species page, choosing how each is measured and which fishing year it belongs to. Official stocks are read-only. A receiver can edit or remove only stocks they added; a stock's code and reporting unit lock once a landing uses it, and nothing a landing uses is ever deleted.

Restoring a backup re-establishes the official stocks from the bundled list, because a backup file is untrusted. Receiver-added stocks are kept, after each passes the same validation as one added in the app.

Fishstocks do not all share one fishing year. Which catalogue stocks fall in the October, April, and February years, and how receiver-added stocks are handled, are in [docs/fishing-year-rules.md](docs/fishing-year-rules.md).

## Windows releases

Receiver-facing installation, update, uninstall, backup, and pilot certificate
guidance is in [docs/installing-windows.md](docs/installing-windows.md).

The `Release Windows` workflow builds an x64 current-user NSIS installer for Windows 10 22H2 and Windows 11. Public releases are unsigned: Windows shows them as from an unknown publisher, and receivers check the download against the release page instead (see [docs/installing-windows.md](docs/installing-windows.md)). Its default dispatch creates an unpublished pilot artifact signed by the stable self-signed `myLFR Desktop Pilot Testing` certificate. The artifact includes only the public certificate, fingerprint-pinned trust/removal scripts, and tester instructions; its private key never leaves protected local storage and GitHub Actions secrets.

The workflow has three signing modes:

- `pilot-self-signed` for testing on explicitly enrolled computers;
- `unsigned` for public releases;
- `production` for a publicly trusted certificate, if one is ever adopted.

Every run uploads its packages as a private GitHub Actions artifact. With `publish` enabled, an `unsigned` or `production` run also creates a **draft** GitHub release tagged `v<version>` with the installer, its `.sig`, `latest.json` and `SHA256SUMS.txt`. A draft is invisible to receivers and to the updater until the maintainer reviews and publishes it. The workflow rejects any attempt to publish a pilot-signed build. Once the repository is public, the signing job also records a GitHub build provenance attestation for the installer, which anyone can check with `gh attestation verify <installer> --repo Magnifica101/myLFR-desktop`.

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

## Packaged Windows smoke test

`scripts/windows-pilot-smoke.mjs` drives an installed build through WebView2's local Chrome DevTools Protocol endpoint. It verifies first-run setup, catalogue search, fishers/vessels, exact landing weights, revisions, backup creation and validation, a real restore round-trip, full export, sanitized diagnostics, update-check throttling, reports, and their visible screens.

Run it only against a fresh synthetic pilot installation. It refuses to continue unless the business client number is `PILOT-001`, but it intentionally creates and restores test data. From PowerShell, launch the installed pilot with a local debugging port, select an existing disposable backup folder, and run:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
Start-Process "$env:LOCALAPPDATA\myLFR Desktop\mylfr-desktop.exe"
$env:MYLFR_SMOKE_BACKUP_DIRECTORY = "$env:TEMP\myLFR-pilot\backups"
New-Item -ItemType Directory -Force $env:MYLFR_SMOKE_BACKUP_DIRECTORY | Out-Null
npm.cmd run smoke:windows:pilot
```

**It needs an unlocked Windows session, but not a person.** The script answers each native file dialog itself (`scripts/windows-dialog-helper.ps1`). It writes the path into the dialog's own file or folder box and clicks the dialog's own OK button, using Windows messages rather than keystrokes or the clipboard, and it answers the "replace it?" question with Yes. Nothing depends on which window has focus, so the computer can be used normally while it runs. Do not close the myLFR window, and do not lock the screen: the script checks for the lock screen (`Get-Process LogonUI`) and stops with a clear message if the session is locked.

It can be run from an agent session in WSL. A PowerShell started through Windows interop runs in the interactive desktop session, so `powershell.exe` from WSL can launch the installed app and run the script. Verified on 2026-10-10.

Set `MYLFR_CDP_PORT` if a port other than 9223 is used. For an offline-renderer check, add `--proxy-server=127.0.0.1:9` to the WebView2 arguments.

The script prints nothing while it works and a JSON summary when it finishes, so a quiet window is normal. Three things have each cost a run:

- **Press Enter after pasting the block.** PowerShell runs every pasted line except the last, which waits at the prompt.
- **If PowerShell says running scripts is disabled** (the 32-bit "Windows PowerShell (x86)" does this to `npm.ps1`), run `npm.cmd run smoke:windows:pilot` instead. No system setting needs changing.
- **If a dialog is ever completed by hand, choose the smoke backup folder**, not another one: the app writes a backup into whichever folder is chosen.

### Capturing what the screens actually look like

Development on Linux or WSL renders through WebKitGTK, but the product ships on Windows and renders through WebView2, which is Chromium. The two are different engines, so a layout approved in a development window is not evidence of what a receiver sees. The launch command for the development app also sets `WEBKIT_DISABLE_COMPOSITING_MODE=1`, which suppresses the `backdrop-filter` blur behind modals — a visible difference that only appears in the packaged build.

The smoke test can capture each screen it verifies, in the real engine against real pilot data. Set `MYLFR_SMOKE_SCREENSHOT_DIR` to an existing directory before running:

```powershell
$env:MYLFR_SMOKE_SCREENSHOT_DIR = "$env:TEMP\myLFR-pilot\screens"
New-Item -ItemType Directory -Force $env:MYLFR_SMOKE_SCREENSHOT_DIR | Out-Null
npm run smoke:windows:pilot
```

Seven numbered PNGs are written — Home, the backup information modal, permit holders, landings, monthly summaries, export data, and settings — and the file list is added to the JSON the script prints. Leave the variable unset and the script behaves exactly as before.

Each image is captured only after the assertion for that screen has passed, so a picture always corresponds to a verified state. Screens are captured at a fixed 1440x900 viewport so two runs are comparable; that is above the 1000px breakpoint where the sidebar collapses to icons, so captures show the full navigation. Images come back 1425 wide because the scrollbar is excluded. Full screens are captured beyond the viewport so a long page is reviewable in one image, but the modal is captured at viewport size only: `captureBeyondViewport` paints a fixed overlay once at the top and leaves the rest of the page beneath it unblurred, which would misrepresent what the user sees.

The smoke test is designed to be repeatable in a synthetic database that may contain other manual test records. Report assertions must remain scoped to the smoke permit holder and vessel, and UI report checks must select that permit holder. Do not assert that an entire month contains only the smoke landing.

### Post-install database checks

Close the application before taking a safety snapshot. Verify SQLite logically with `PRAGMA integrity_check`, the myLFR `application_id`, the supported `user_version`, and expected synthetic smoke-test records. Do not compare `mylfr.sqlite3-shm` byte-for-byte: it is transient coordination state and can change merely by opening a database copy, including through a read-only connection. Use an app-created `.mylfr-backup` or SQLite's backup API for recovery rather than assembling a backup from SQLite sidecar files.

Release, installation, restore, and packaged-smoke tasks permit at most three controlled attempts. After a failure, record evidence and update `HANDOFF.md` with the cause and corrected procedure before retrying. Critical signer, publication, secret, database-integrity, or rollback-safety failures still require an immediate stop.

## Verification

Pull requests run:

- npm dependency audit, repository security policy, and fishstock catalogue validation;
- TypeScript production build;
- Vitest bridge, setup, exact-weight, PDF, XLSX, fishstock, update, and notice tests;
- Rust migration, constraint, landing transaction/revision, fishstock, update, checksum, and backup/restore tests;
- Rust migration compatibility tests covering every supported schema, older-schema backup restore, future-schema rejection, and failed-migration version safety.

A production candidate must additionally be installed and smoke-tested on a current Windows 11 x64 machine, including offline use, print/PDF, update, backup, and replacement-PC restore. Windows 10 testing was waived on 2026-08-28 because no Windows 10 machine is available. See [docs/testing.md](docs/testing.md).
