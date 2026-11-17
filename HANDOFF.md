# myLFR Desktop release handoff

Read this before any release, signing, installation, backup/restore, or
packaged smoke work. It holds the rules for that work and the checks still
outstanding. Database compatibility rules are in
[`docs/database-versioning.md`](docs/database-versioning.md).

## Current status

- The Windows pilot release pipeline works. Do not resume earlier signing
  experiments unless a new, reproducible failure needs a narrowly scoped change.
- Release testing uses the self-signed pilot; public releases use `unsigned`.
  The application version is in `package.json`.
- Public releases are unsigned (decided 2026-11-15). With `publish` enabled,
  an `unsigned` run creates a **draft** GitHub release for the maintainer to
  review and publish. The workflow rejects publishing pilot-signed builds.
- Pilot certificate: subject `CN=myLFR Desktop Pilot Testing`, thumbprint
  `4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4`, valid 2026-08-09 to 2029-08-09.
- Each release run uploads `mylfr-debug-symbols-windows`, the debug symbols
  that turn crash-report stack traces into function names and lines. They are
  not shipped. Download them with the release packages and keep them while that
  version is in use; GitHub deletes them after 90 days. See
  [`docs/crash-reports.md`](docs/crash-reports.md).

## Mandatory controlled-attempt protocol

For one requested release, installation, signing, backup/restore, or packaged-smoke task, make no more than **three total attempts**, including the initial attempt. Keep an explicit attempt count. A retry is allowed only after the failed attempt has been inspected, the narrow cause is understood, the relevant guidance in this file has been updated, and a specific corrective change has been made. Do not repeat an unchanged failed command unless evidence shows the failure was transient.

After each failed attempt, pause further release/install/restore/smoke mutations and collect read-only evidence containing:

1. The attempted command or GitHub Actions run ID and the commit SHA.
2. Failure category: build, Rust/TypeScript test, Tauri bundle, Authenticode signing, updater signing, installer, runtime, database, backup/restore, networking, or smoke assertion.
3. The exact failed job/step and a short error excerpt, with secrets redacted.
4. Whether an artifact was uploaded and whether anything was publicly deployed.
5. The current Git branch and `git status --short` output.
6. Whether the installed app, database, backup, and pilot certificate remain intact.
7. The narrowest likely cause and the safest next diagnostic action. Clearly label inferences.

Before a retry, record the failure, cause, and corrected procedure in this handoff. Do not weaken a verification gate, regenerate credentials, change trust stores, replace operational data, or enable publication merely to make a retry pass.

Stop immediately even when attempts remain if there is a signer/thumbprint mismatch, unexpected publication, possible secret exposure, failed database or backup integrity check, uncertain restore/rollback state, unclear destructive scope, or doubt that operational data is preserved. After the third unsuccessful attempt, stop and hand control back to the user.

Suggested report heading:

`STOPPED AFTER ATTEMPT LIMIT — myLFR Desktop status handoff`

## Lessons from earlier failures

Each of these cost at least one failed attempt.

**Signing**

- Pass the generated Tauri configuration explicitly with `--config "$env:TAURI_CONFIG"`; an exported environment value alone is ignored.
- Tauri patches the executable during bundling and restores the raw unsigned build file afterward. Verify the preserved signed executable that was actually embedded, not the build output.
- Do not reopen or verify the executable inside the custom signing hook while Tauri owns it. Sign and copy there; verify afterward.
- Use a freshly compiled unsigned PE for signing preflight, not a catalog-signed Windows system binary.
- Never weaken the signature gates to get an artifact uploaded.

**Builds and checks**

- Do not commit through an API or other output-limited interface that can truncate a large file. Use native Git, and before dispatching a release confirm that `package-lock.json` parses as JSON and `src-tauri/Cargo.lock` parses as TOML.
- Run `cargo fmt` before tests. After removing a dependency, refresh `Cargo.lock` offline, then keep `--locked` on the final test run.
- `cargo test --exact` needs the module-qualified test name, such as `tests::backup_validation_rejects_attacker_defined_schema_and_triggers`. Otherwise it runs zero tests and proves nothing.
- When calling `powershell.exe` from WSL, pass a literal Windows path or add the variable to `WSLENV`; Linux variables are not passed through otherwise.

**Packages and installs**

- Inspect the downloaded release package, not only the build status, for stale version-specific filenames and instructions.
- A schema migration on first launch is one-way: the previous app version will refuse the migrated database. Keep a verified backup from before the upgrade until the new version is accepted.
- Packaged smoke assertions must filter reports to the smoke test's own permit holder and vessel. Never assume the test database contains no other records.
- The packaged smoke test restores into a fresh database, so it cannot catch a problem that only affects long-lived installations. Every backup of a database created before 2026-08-13 failed restore for that reason until schema 6; see `docs/database-versioning.md`. Test restore with a backup taken from the long-lived test database too.

**Packaged smoke test**

- **2026-10-10, smoke test of the 0.8.0 pilot built with Tauri 2.12.1, attempt 1 of 3.** Stopped before completion. Category: smoke assertion. The script had drifted from the application since its last full run. It expected schema 4 (the application is at 8), looked for weights as `23.45 kg` (the screens print `23.45` and `GW (kg)` in separate cells), waited for a Settings sentence that had been reworded, hard-coded a landing in August although Monthly summaries opens on the previous month, and did not expect the responsibilities notice to return after a restore, which clears its acknowledgement on purpose. Corrected in `scripts/windows-pilot-smoke.mjs`: the schema comes from `get_app_info`, dates come from the current month, and the notice is expected and accepted again after the restore.
- Before a human run, read each screen the script checks against the live synthetic application through the debug port (read-only), and run the smoke test after any change to screen wording, reporting units or the schema version. Most of the drift above was found by reading, not by running.
- Mistakes that cost time: the last pasted line waiting for Enter, and the 32-bit PowerShell refusing `npm.ps1` (use `npm.cmd`). The first dialog helper typed the path with keystrokes, which depends on window focus. Typing in another window took focus from the file dialog, and one dialog was completed on the Desktop, so a backup of the synthetic data was written there. The helper now uses Windows messages and needs no focus.
- **2026-10-10, attempt 2 of 3.** Stopped at the second dialog. The new helper did not recognise the open dialog's file-name box (an Edit with id 1148 inside a combo box; the folder picker's is 1152), and the save dialog's "replace it?" question is a TaskDialog whose Yes is pressed with `TDM_CLICK_BUTTON`, not a window to click. Fixed. Every dialog type was then rehearsed against the synthetic application (open, restore with the notice returning, a new save, a replace, diagnostics) before attempt 3.
- **2026-10-10, attempt 3 of 3: passed**, in 11 seconds, with 7 screens captured. The update-check assertion was corrected on the way: `begin_app_update_check` only reports whether a check is due, and a failed check must leave the 24-hour window open.
- An agent session can run the smoke test end to end. Real records must be copied, checked, and set aside first (see `docs/testing.md`), and checked again afterwards. The synthetic data folders it leaves behind (`nz.co.mylfr.desktop.smoke-*`, `.helper-test`, `.rehearsal`) and the temporary copies under `%TEMP%` are test data and can be deleted.
- When checking for a leftover dialog helper, exclude the checking process itself (`$PID`): its own command line contains the words being searched for and matches.

## Post-install SQLite verification

SQLite's `mylfr.sqlite3-shm` file is transient shared-memory coordination state. Its bytes can change when a connection opens, including when a copied database is opened read-only. **Never use a `-shm` hash comparison as an installation-integrity gate**, and do not treat `-shm` as application data that a backup must preserve.

Use this procedure instead:

1. Close `mylfr-desktop.exe` before taking a safety snapshot or inspecting operational files.
2. Prefer an app-created `.mylfr-backup` or SQLite's backup API for recoverable snapshots. Do not construct a restorable backup by copying only selected SQLite files.
3. Verify the installed database logically with `PRAGMA integrity_check`, `PRAGMA application_id`, `PRAGMA user_version`, and expected sentinel records. Packaged smoke must use only the synthetic `PILOT-001` profile.
4. Raw hashes of the main database and `-wal` while the app is closed may be recorded as supporting evidence, but they are not a substitute for logical integrity checks. Never include `-shm` in a byte-for-byte equality assertion.
5. Do not open a raw safety copy before any supporting hash comparison, because SQLite may update its transient sidecars. Preserve the untouched copy and inspect a second working copy if inspection is necessary.
6. In PowerShell, materialize loop output before piping it. Use `$rows = foreach (...) { ... }; $rows | ConvertTo-Json` instead of piping directly from a `foreach` statement. Always check the command exit code separately from its printed diagnostic data. Keep verification commands small and independent, so a reporting error cannot hide a successful integrity result.

## Protected assets and boundaries

Private signing material is kept outside the repository in protected local
storage on the maintainer's machine. It includes the pilot PFX/CER and password
plus the updater signing key. Do not print, copy into the
repository, commit, rotate, or upload these values. GitHub's protected `signing` environment must contain only the Authenticode and Tauri updater signing secrets. The protected `production` environment holds no secrets; the publication job uses the workflow's GitHub token to create a draft release. The old `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` secrets are no longer used and can be deleted. Repository variables pin the pilot and production Authenticode thumbprints.

Preserve these product boundaries:

- No Supabase, authentication, analytics, telemetry, or ordinary operational network traffic.
- Do not change Windows certificate stores without explicit need and user awareness.
- Do not overwrite or delete the installed SQLite database or known backups.
- Do not enable public distribution while using the self-signed pilot certificate.
- Keep application updates user-confirmed and cryptographically signed with the Tauri updater key.

## Before making the repository public

The repository is currently private. Work through this list in order, and do
not make the repository public until every item above "Make the repository
public" is ticked.

- [x] **Full-history secret scan.** Done 2026-10-04 with gitleaks 8.30.1 over
  every ref (98 commits) plus a manual pattern search for key files, `.env`
  files, signing keys, tokens, and personal details. No secrets found. The
  fresh history below makes this scan cover only the published tree, so re-run
  it over that tree just before publishing. Re-run 2026-11-17 over the exact
  tree of the public commit (150 files, from `2fbd91a`) with gitleaks 8.30.1
  (checksum verified) plus the same manual pattern search, and over all 181
  commits for information: no leaks found.
- [x] **Clean up the repository.** Done 2026-10-04: generated Tauri schemas
  ignored, unused platform icons removed, the finished security review
  removed, this file trimmed to its rules, and personal paths and details
  removed from the documents.
- [ ] **Publish a fresh history.** Decided 2026-10-04: the public repository
  starts from a single commit of the cleaned files, so earlier versions of the
  documents and the personal commit email are not published. Do this on the day
  of going public:
  1. Rename the current repository to `myLFR-desktop-archive` and keep it
     private. Nothing is deleted; it holds the full history and pull requests.
  2. Create a new private `Magnifica101/myLFR-desktop` repository, so the
     links built into the app, `SECURITY.md`, and the issue template stay
     correct.
  3. From a clean checkout of `main`, create an orphan branch with
     `git checkout --orphan public`, commit every file with the GitHub
     `noreply` address as author and committer, and push it as `main` to the
     new repository.
  4. Recreate the `signing` and `production` environments, their secrets, the
     repository variables, and branch protection in the new repository.
     These belong to the old repository and do not carry over.
  5. Run the release workflow in pilot mode once to prove the signing setup
     before relying on it.
  6. Point both local checkouts at the new repository.
- [ ] **Make the repository public.**
- [ ] **Immediately enable private vulnerability reporting:** repository
  Settings → Code security → Private vulnerability reporting → Enable. GitHub
  only offers this once the repository is public, and `SECURITY.md` points
  security researchers to it, so until this is done the policy names a channel
  that does not exist. Confirm the link in `SECURITY.md` opens the report form.
- [ ] **Enable secret scanning push protection** in the same Code security
  settings, so a key committed by mistake is blocked before it is published.
- [ ] **Check bug reporting end to end.** Issues are enabled, blank issues are
  disabled, and Settings → Bug report → Report on GitHub in the app opens the
  bug report form with the version filled in.
- [ ] **Turn off unused GitHub features** (Wiki, Projects, Discussions) so
  nothing suggests a channel that is not monitored.

## Remaining acceptance work

- Physical printing and a first-run replacement-PC restore walkthrough using the setup-screen restore action.
- The first unsigned public release: a draft GitHub release from an `unsigned` run with `publish` on, reviewed and published once the repository is public, then a live GitHub update test from the previous version. See `Distribute the Windows installer unsigned` in `FEATURES.md`.

## Local packaged updater pilot

- **2026-11-10, 0.8.0 → 0.8.1, stopped after four install requests.** Commit
  `6398cb2`, GitHub Actions runs `42781223051` and `42781228417`. Both signed
  artifacts were uploaded privately and Windows independently verified the
  expected pilot signer. The pilot made a backup and downloaded 0.8.1 on each
  request, then reported a publisher mismatch and stayed on 0.8.0.
  The Windows PowerShell child inherited Codex's PowerShell 7 module path and
  could not load the signature cmdlet. The verifier now loads its own system
  module explicitly and distinguishes failure to run the check from a rejected
  signature. Start any new pilot run with a rebuilt starting installer that
  contains this fix.
- **2026-11-11, same two runs, attempt 1 of 3: passed.** The unchanged 0.8.0
  pilot was installed from WSL into the real profile (Codex's packaged runtime
  had redirected the first attempt's install, data, and feed into its own
  `Packages\OpenAI.Codex_*\LocalCache`), launched from Windows PowerShell 5.1,
  and driven through Settings over the WebView2 debug port: Check for updates
  now, Review and install 0.8.1, backup ticked, Install. It backed up, downloaded,
  passed both signature checks, installed, and reopened as 0.8.1 with schema 10,
  `PRAGMA integrity_check` ok, and the synthetic landing still listed. The real
  records' database and `-wal` hashes were unchanged. This confirms the earlier
  failure was the launching environment. The fix above is still needed for
  launches from PowerShell 7.
- **2026-11-11, fresh pilot with the fix, 0.8.2 → 0.8.3, attempt 1 of 3:
  passed.** Commit `af369bc` (PR #89), runs `42887425516` (0.8.2) and
  `42887433476` (0.8.3); both installers Valid with the pinned pilot thumbprint,
  nothing published. Same procedure as above, with the previous pilot
  uninstalled and its data folder renamed aside first. It backed up, downloaded,
  passed both signature checks, installed, and reopened as 0.8.3 with schema 10,
  `PRAGMA integrity_check` ok, the expected application id, and the synthetic
  landing still listed. The real records' hashes were unchanged. Not exercised:
  a launch from PowerShell 7 (none is installed on the test PC).
- **2026-11-14, maintainer-driven update, 0.8.3 → 0.8.4, attempt 1 of 3:
  passed, backup not exercised.** Commit `6816a23` (PR #91, a visible FAQ
  change), run `43575943979`; installer Valid with the pinned pilot thumbprint,
  nothing published. The maintainer opened the pilot from its Desktop shortcut
  and used Check for updates now, Review and install 0.8.4, Install. It
  downloaded, passed both signature checks, installed into the real profile,
  and reopened as 0.8.4 (installed executable Valid with the pinned
  thumbprint) with schema 10, `PRAGMA integrity_check` ok, and the expected
  application id. The run used a new empty database with no backup folder, so
  the dialog correctly offered no backup and none was made.
- **Correction to the two 2026-11-11 entries.** That session's agent ran in the
  Claude desktop app, which is also a packaged app. Its installs, seeded data,
  and the Desktop shortcut target went into `Packages\Claude_*\LocalCache`, not
  the real profile, and its PowerShell hashes of the real records were of a
  stale packaged copy. The real records' files were last written on
  2026-11-07, so no pilot run touched them. The 2026-11-14 run is the first
  update verified in the real profile. Install, seed, and verify through a
  process that is not started by a packaged app (for example WSL's `/mnt/c`
  view), or have the maintainer do it.
- **2026-11-15, unsigned release pipeline from `main`, attempt 1 of 3:
  passed.** Commit `f099094` (PR #93), run `43695437811`, `signing_mode`
  `unsigned`, `publish` on. Build, bundle and publication jobs succeeded. The
  draft `v0.8.0` GitHub release held the NotSigned installer, its `.sig`,
  `latest.json` (GitHub download URL, signature matching the `.sig`) and
  `SHA256SUMS.txt` (checksum verified); no tag was created; attestation was
  skipped while the repository is private. The test draft was deleted. Not
  exercised: installing from or updating against a published release, which
  needs the repository to be public.
- **2026-11-17, maintainer-driven update with backup, 0.8.4 → 0.8.5, attempt 1
  of 3: passed.** Commit `ab8c9e0` (PR #97), run `43838264808`; installer
  Valid with the pinned pilot thumbprint, nothing published. With a backup
  folder set (OneDrive), Check for updates now, Review and install 0.8.5, backup
  ticked, Install: a pre-update backup was written a minute before the install,
  and the pilot reopened as 0.8.5 (installed executable Valid with the pinned
  thumbprint) with schema 10, `PRAGMA integrity_check` ok and the expected
  application id. Real records unchanged (last written 2026-11-07). Seen: a
  console window flashed during the update because the Authenticode check
  started Windows PowerShell without `CREATE_NO_WINDOW`; fixed in the next
  commit. The original test CA expired on 2026-11-17 and was replaced by a new
  60-day test CA, so 0.8.5 (built with the old CA) can no longer update from
  the local feed.
- **2026-11-17, console-window fix, 0.8.6 → 0.8.7, attempt 1 of 3: passed.**
  Commit `e52ccf1` (PR #98), runs `44033892234` (0.8.6) and `44033902926`
  (0.8.7), both built with the new 60-day test CA, installers Valid with the
  pinned pilot thumbprint, nothing published. 0.8.6 was installed over 0.8.5 by
  the maintainer. Its first check was refused by the then 24-hour limit on
  manual checks (0.8.5's check counted), so the pilot's
  `last_app_update_check` was cleared with the app closed (copy kept, nothing
  else changed). The update then ran with no console window, wrote a
  pre-update backup, and reopened as 0.8.7 (Valid, pinned thumbprint) with
  schema 10 and `PRAGMA integrity_check` ok. Real records unchanged. Manual
  checks were then changed to always run (see the next commit).
- **2026-11-17, manual check any time, 0.8.8 → 0.8.9, attempt 1 of 3:
  passed.** Commit `60e939b` (PR #99), runs `44040782931` (0.8.8) and
  `44040794573` (0.8.9), test CA 2, installers Valid with the pinned pilot
  thumbprint, nothing published. 0.8.8 was installed over 0.8.7 by the
  maintainer. Check for updates now found 0.8.9, and an immediate second press
  checked again with no 24-hour refusal. The update wrote a pre-update backup
  and reopened as 0.8.9 (Valid, pinned thumbprint) with schema 10 and
  `PRAGMA integrity_check` ok; the install took about four seconds, so the
  passive progress window was barely visible. Real records unchanged.

- Dispatch `Release Windows` on `main` with `pilot-self-signed`, publication off,
  a `pilot_update_version`, and the base64 DER **public** CA certificate for the
  local HTTPS server. Build the starting version and a higher version with the
  same CA. Keep the HTTPS private key off GitHub.
- These installers use the separate **myLFR Desktop Updater Pilot** install and
  data folders. Verify their Authenticode signatures and the pinned pilot
  thumbprint before installation. Use a synthetic business and a pilot backup
  folder. Serve only the higher version's manifest and installer at
  `https://127.0.0.1:18743` from the test PC.
- In the installed starting version, check for updates in Settings and leave
  the backup option ticked when installing. Verify the installed version,
  SQLite integrity, and synthetic records after reopening. Record the two run
  IDs and the result under the controlled-attempt protocol above.

Useful implementation files:

- `.github/workflows/release-windows.yml`
- `scripts/sign-windows-artifact.ps1`
- `scripts/windows-pilot-smoke.mjs`
- `distribution/pilot/install-pilot-certificate.ps1`
- `distribution/pilot/remove-pilot-certificate.ps1`
- `scripts/prepare-release.mjs`
- `README.md`
