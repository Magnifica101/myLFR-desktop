# Testing myLFR Desktop

No single check proves that myLFR works for a receiver. Each kind of check
proves particular things and is blind to others, and the most common mistake is
treating a passing result from one level as evidence for another: a green test
run as proof that a screen looks right, or a development window as proof that
the installed product behaves the same way.

This document says what each level proves, what it cannot, and which level a
change needs before it can be called verified.

## The levels at a glance

| Level | Runs where | Proves | Cannot prove |
| --- | --- | --- | --- |
| [Automated tests](#1-automated-tests) | Any machine, and CI on every pull request | Database rules, migrations, backup and restore logic, and screen behaviour with the native bridge simulated | Layout and appearance, the real bridge, Tauri plugins, anything Windows-specific |
| [Development app on WSL or Linux](#2-development-app-on-wsl-or-linux) | `npm run desktop:dev` | The real screens wired to the real Rust code, and migrations on a long-lived database | What receivers see: it renders in WebKitGTK, not WebView2 |
| [Development app on Windows](#3-development-app-on-windows) | The Windows checkout | Live layout in WebView2, the engine receivers use | The installer, signing, updates, or the installed database |
| [Packaged Windows smoke test](#4-packaged-windows-smoke-test) | An installed build, on an unlocked Windows session | The shipped product end to end, in WebView2, against real files and dialogs | Printing; a production signature; behaviour on data it did not create |
| [Release verification](#7-release-verification) | Installed signed builds | Installation, Authenticode, updates, and migration of a real installed database | Nothing further: this is the final level |

## 1. Automated tests

```bash
nvm use
npm test                                    # Vitest: screens and the bridge
npx tsc --noEmit                            # types
npm run build                               # production frontend build
npm run security:policy                     # repository security rules
npm run catalogue:validate                  # bundled fishstock list and checksum
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
```

Continuous integration runs all of these, plus `npm audit --include=dev`, on
every pull request and every push to `main`, on Linux.

**What they prove.** The Rust tests run against real SQLite databases in
temporary directories: every migration, every supported older schema migrating
forward, backups from every supported schema validating and restoring, landing
revisions, fishstock rules, update decisions, and the restore trust boundary.
The Vitest tests render real screens in jsdom and check what they show and which
commands they send.

**What they cannot prove.**

- **Layout and appearance.** jsdom has no layout engine. A test can confirm that a
  button exists and is enabled, not that it is on screen, readable, or aligned.
- **The real bridge.** Screen tests replace the native bridge with
  `setDesktopTransportForTests`, so they prove the screen sends the right
  command, not that Rust receives or answers it the same way.
- **Tauri plugins and the desktop build.** `--no-default-features` leaves out the
  `desktop` feature: no updater, file dialogs, opener, or window. A change there
  needs at least `cargo build --features desktop` and usually the development
  app.
- **Windows.** CI builds and tests on Linux only. The Windows build is compiled
  only by the release workflow.
- **Their own reference points.** A test that both writes and checks a checksum,
  backup, or schema with the same library cannot notice that library changing.
  Where that matters, tests compare against an independent reference: the
  shipped catalogue's checksum was written by a Node.js exporter that has since been removed, and SHA-256
  is checked against the FIPS 180-2 vector.

## 2. Development app on WSL or Linux

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run desktop:dev
```

The two `WEBKIT_*` variables prevent a blank window under WSLg. The development
build uses its own identifier, `nz.co.mylfr.desktop.dev`, so it opens its own
database (`~/.local/share/nz.co.mylfr.desktop.dev/mylfr.sqlite3` on Linux) and
never touches an installed copy's records.

**What it proves.** The real screens talking to the real Rust code: commands,
validation messages, migrations, and the flow between screens. It is also the
only routine check against a **long-lived** database rather than a fresh one,
which matters: a fault that only affects databases created by an older build
cannot be seen from a fresh one.

**What it cannot prove.** What receivers see. This window renders through
WebKitGTK; the product renders through WebView2, which is Chromium. Fonts,
layout, and CSS support differ, and `WEBKIT_DISABLE_COMPOSITING_MODE=1` removes
the blur behind modals. Use it to check that something **works**, not that it
**looks right**, and say which engine is in use when asking someone to judge it.

**Practical notes.**

- **A new migration upgrades the development database for good.** An older build
  then refuses to open it. Copy all three files (`mylfr.sqlite3`, `-wal`, `-shm`)
  before running a branch that adds a migration.
- **Testing first-run screens** (the notice, setup) needs an empty database.
  Close the app, move the three database files into another folder, test, then
  close the app, delete the new files, and move the originals back. Check the
  restored database with `PRAGMA integrity_check`.
- **Read the database from a copy**, never the live file the running app holds,
  and copy all three files or recent writes will be missing.

## 3. Development app on Windows

The Windows checkout runs the same development build through WebView2. The setup
is in [`AGENTS.md`](../AGENTS.md). Open the window it starts, never
`http://localhost:1420` in a browser, which is only the frontend server without
the Rust bridge.

**What it proves.** Live layout in the engine receivers use, with fast reloads.

**What it cannot prove.** The installer, Authenticode signing, the updater, or the
installed database: it is still a development build with its own identifier and
database.

Development builds have two switches for seeing screens that otherwise need a
real event. Set `MYLFR_DEV_FAKE_UPDATE` to a version (for example `0.9.0`) and
update checks report it as available; installing it walks through the backup,
download, and install stages without doing any of them. `MYLFR_DEV_CRASH`
crashes the app on purpose; see [`crash-reports.md`](crash-reports.md).

## 4. Packaged Windows smoke test

[`scripts/windows-pilot-smoke.mjs`](../scripts/windows-pilot-smoke.mjs) drives an
**installed** build through WebView2's debugging port. It covers the
responsibilities notice, first-run setup, catalogue search, permit holders and
vessels, exact landing weights, revisions, backup creation and validation, a
real restore, full export, diagnostics, update-check throttling, and reports.
The commands to run it are in [`README.md`](../README.md) under *Packaged
Windows smoke test*.

**It needs an unlocked Windows session, not a person.** It answers native file
dialogs with Windows messages (`scripts/windows-dialog-helper.ps1`), so it needs
no keyboard and no focus, and it can be run from WSL or by an agent session: a
process started from WSL runs in the interactive session. It checks that the
session is unlocked and stops with a clear message if not. It has not been tried
from a scheduled task or from a session with no one logged in.

**It is destructive by design.** It creates synthetic records and restores a
backup over the database, so it refuses to continue unless the business client
number is `PILOT-001`. Run it only against a synthetic pilot installation.

**On a machine that holds real records,** set them aside first. Close myLFR,
copy the data folder (`%LOCALAPPDATA%\nz.co.mylfr.desktop`) somewhere that is not
cloud-synced, and check the copy against the original by checksum. Then rename the
data folder rather than deleting it, so the application starts fresh. After the
run, rename the synthetic folder away, rename the original back, and check its
checksums again. Never delete either folder until the real one is confirmed.

**What it cannot prove.** Printing, a production signature (pilot builds are
self-signed), or behaviour on data it did not create: it starts from a fresh
installation, so it shares the automated tests' blind spot for long-lived
databases. After a release that touches backup or the database, also back up the
long-lived Windows test database and confirm that the backup restores.

## 5. Checking what screens look like

Neither the automated tests nor the WSL development app are evidence of
appearance. For that:

- **Smoke test screenshots.** Set `MYLFR_SMOKE_SCREENSHOT_DIR` before running the
  smoke test, and it saves each verified screen, rendered by WebView2, at a fixed
  1440x900 size so runs can be compared. See `README.md`.
- **The Windows development app** for quick live checks.

A screen added since the screenshot list was last extended is not captured
until the smoke script is updated to visit it.

## 6. Offline checks

myLFR must work without a network connection. To check the packaged build
offline, add `--proxy-server=127.0.0.1:9` to the WebView2 arguments before
starting it, or disconnect the network, and confirm that:

- every screen and action except the update check still works;
- **Check for updates now** says it couldn't get update information; and
- the last successful check shown in Settings is unchanged, because a failed
  check is never recorded.

The decision behind the last two is unit-tested. Seeing it in the real app needs
a person and a network toggle (see *Verify the update check button offline as
well as online* in [`FEATURES.md`](../FEATURES.md)).

## 7. Release verification

Only an installed, signed build proves installation, Authenticode, the updater,
and migration of a real installed database. Release work follows the
controlled-attempt protocol and checks in [`HANDOFF.md`](../HANDOFF.md), and a
candidate is installed and smoke-tested on a current Windows 11 x64 machine,
including offline use, print and PDF, update, backup, and replacement-PC
restore. Windows 10 testing was waived on 2026-08-28 because no Windows 10
machine is available; see *Decisions* in `FEATURES.md`.

## Which level does a change need?

| Change | Verified when |
| --- | --- |
| Database schema or migration | Automated tests, including the schema matrix, **and** the development app on a long-lived database. Consider a backup from a database created before the change, too. |
| Backup, restore, or a dependency they rely on (`rusqlite`, `zip`, `sha2`) | Automated tests, **and** backups made by the previous build validating and restoring under the new one. Same-library tests cannot show this. |
| Screen behaviour | Vitest tests, **and** the development app. |
| Screen appearance or layout | WebView2: the Windows development app or smoke-test screenshots. |
| Tauri plugins, the updater, dialogs, or the desktop build | `cargo build --features desktop`, the development app, and, for the updater or installer, an installed build. |
| Installer, signing, or release workflow | A pilot release run and installation, under the `HANDOFF.md` protocol. |
| Documentation only | Review. |

State plainly which levels were run when reporting a change, and which were not.
"Tests pass" is a claim about level 1 only.
