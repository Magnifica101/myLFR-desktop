# Feature backlog

This file is the source of truth for product features that are intended but not
yet implemented. Add ideas here before implementation begins; inclusion does
not guarantee a delivery date.

## Statuses

- **Proposed** — recorded for consideration, but not yet committed.
- **Planned** — accepted as intended work.
- **In progress** — implementation has started.

## Intended features

### Host the Windows installer on GitHub Releases

- Status: In progress
- Priority: Not set
- Tracking: None

Decided: the installer is hosted on GitHub Releases. What remains is finishing
the GitHub Releases publishing steps below, which can only be done once the
repository is public.

Decision recorded 2026-08-27, revised 2026-10-10: GitHub Releases hosts
everything. Each public release carries the installer, its updater signature,
and `latest.json`. There is no website: receivers download the installer
from the repository's GitHub Releases page. The updater endpoint built into
the app is
`https://github.com/Magnifica101/myLFR-desktop/releases/latest/download/latest.json`,
which GitHub redirects to the newest published release, so `desktop.mylfr.co.nz`
and Netlify are no longer part of updates. This ties installed copies to
GitHub and the repository name: moving either means existing copies stop
finding updates until reinstalled. Keep pilot and unsigned builds private;
GitHub's "latest" ignores drafts and prereleases, so a pilot release must
never be published as a full release.

GitHub does not charge for release downloads from a public repository, and
each release file may be up to 2 GiB; the installer is about 10 MB. Downloads
from a private repository need a GitHub sign-in, so live update tests wait for
the repository to be public. The fresh public history keeps the name
`Magnifica101/myLFR-desktop`, so the built-in endpoint stays valid.

Done: the app's updater endpoint (2026-10-10). Copies installed before then,
including the 0.8.0 pilot, still ask `desktop.mylfr.co.nz` and need
reinstalling once. Remaining, at release time: change
`scripts/prepare-release.mjs` so `latest.json` points at the GitHub release
asset instead of `desktop.mylfr.co.nz/downloads`, and replace the release
workflow's Netlify publication job with one that creates the GitHub release.
Both only work once the repository is public.

### Security vulnerability reporting policy (SECURITY.md)

- Status: In progress
- Priority: High
- Tracking: None

Publishing this repository makes the updater's signature verification and the
backup validation path readable by anyone.
Security researchers who find a flaw there need a private channel to report it,
because disclosing such a defect in a public issue would expose every installed
copy before a fix could ship.

`SECURITY.md` now states the supported versions (latest release only), the
private reporting route (GitHub private vulnerability reporting), and a 14-day
best-effort acknowledgement target, and the issue template points security
reports there. What remains is enabling private vulnerability reporting in the
repository settings, which GitHub only offers once the repository is public.
That must be done at the moment the repository becomes public, since the policy
names a channel that does not yet exist.

### Distribute the Windows installer unsigned

- Status: In progress
- Priority: High
- Tracking: None

Decided 2026-11-15, replacing the 2026-10-04 plan to buy a Certum Open Source
Code Signing certificate: public releases are distributed without Authenticode
signing. Pilot builds stay self-signed with the "myLFR Desktop Pilot Testing"
certificate and are never published.

Options considered (2026-11-15 prices): Certum Open Source (about NZ$100 a
year, issued to the maintainer by name, needs the public repository, out of
stock at the time, and its cloud key needs unofficial tools to sign in CI);
SSL.com individual validation with cloud signing (about US$309 a year);
Microsoft Artifact Signing (about US$120 a year, but not open to individuals in
New Zealand); the Microsoft Store (free signing only for MSIX packages, which
would delete records on uninstall and force automatic updates); and SignPath
Foundation (free, but requires an OSI-approved licence, which CC0 is not).

What unsigned means for receivers: Windows SmartScreen shows "Windows
protected your PC" with "Unknown publisher" until they choose **More info**
and **Run anyway**. Smart App Control on some Windows 11 computers, and some
managed work computers, can block the installer outright. Antivirus false
alarms are more likely. Trust instead comes from:

- downloading only from the repository's GitHub Releases page;
- `SHA256SUMS.txt` on each release, to compare with the installer;
- a GitHub build provenance attestation for each installer, proving it was
  built by the release workflow from the public source (once public);
- the Tauri updater signature, checked against the committed public key before
  any update installs.

Done (2026-11-15, not yet released):

- The updater skips the Authenticode publisher check only in builds compiled
  with `MYLFR_UNSIGNED_WINDOWS_RELEASE=1`; signed builds still pin their
  thumbprint, and builds with neither setting refuse updates.
- The release workflow publishes `unsigned` (or a future `production`) runs as
  a draft GitHub release with the installer, `.sig`, `latest.json` and
  `SHA256SUMS.txt`, attests the installer once the repository is public, and
  still rejects publishing pilot-signed builds. The Netlify publication job and
  script are removed.
- `latest.json` points at the GitHub release download, with spaces in the
  installer name replaced by hyphens.
- `AGENTS.md`, `README.md`, `HANDOFF.md`, the installation guide and the FAQ's
  installer warning answer describe unsigned installation.

Checked 2026-11-15: an `unsigned` run from `main` with `publish` on
(GitHub Actions run `43695437811`, commit `f099094`) passed every job. It
created a draft `v0.8.0` release holding the installer (Windows reports it
NotSigned), its `.sig`, `latest.json` and `SHA256SUMS.txt`. The checksum
matched, `latest.json` pointed at the release download with a signature
matching the `.sig`, no tag was created, and attestation was skipped while the
repository is private. The test draft was then deleted.

Remaining: after the repository is public, the first published release,
an attestation check with `gh attestation verify`, and a live update test from
GitHub. If a certificate is adopted later, signed builds pin a thumbprint, so
plan how installed copies accept a renewed certificate before its first
renewal.

### Verify the update check button offline as well as online

- Status: Proposed
- Priority: Not set
- Tracking: None

`Check for updates now` (Settings → Application updates) always checks; only
automatic checks keep to the 24-hour window (decided 2026-11-17). A check is
recorded only once the update server has actually answered, so a failed
attempt leaves the window intact. Unit tests cover the decision, but nothing exercises the
real button against a real network state.

Both paths need to be seen working in an installed build:

- **Online.** Press the button, confirm the result appears, and confirm a second
  press checks again rather than being refused.
- **Offline.** Disconnect, press the button, confirm the failure is reported and
  that the stored `last_app_update_check` is unchanged. Reconnect and confirm the
  next press checks immediately.

The packaged Windows smoke test already covers update-check throttling, and its
notes describe running WebView2 behind `--proxy-server=127.0.0.1:9` for an
offline-renderer check, so extending that script is the likely home for this
rather than a separate manual procedure.

This is a verification gap, not a defect: the behaviour is believed correct and
is unit tested. It is recorded here because it cannot be proved without a human
and a network toggle, so it is not eligible for the overnight queue.

### Final check of the whole app for UI bugs

- Status: In progress
- Priority: Not set
- Tracking: None

A deliberate walk through every screen, dialog, and state of the application,
looking for layout and behaviour bugs: content shifting while typing, clipped or
overlapping text, awkward empty or error states, and controls that behave
differently from similar ones elsewhere. Do it on an installed Windows build,
because the development window on WSL renders in a different engine and is not
evidence of what receivers see (see `docs/testing.md`). The packaged smoke test
can capture the screens it visits, which gives a fixed set to review.

Do this near the end, once the screens have stopped changing and alongside the
in-app help work, so that it covers the final application.

Screen review progress (2026-11-08):

- **Home — reviewed.**
- **Permit holders — reviewed.**
- **Landings — reviewed.**
- **Species — reviewed.**
- **Monthly summaries — reviewed.**
- **Export data — reviewed.**
- **Resources — reviewed.**
- **FAQ — pending; next screen to review.**
- **Settings — pending.**

For the remaining screens, check wording, layout, controls, dialogs,
notifications, and empty/error states. FAQ content remains pending under the
in-app help work too.

This records the maintainer's screen-review progress. Native Windows verification
and installed-build checks remain separate requirements under `docs/testing.md`;
the outstanding checks noted elsewhere in this file still apply.

<!--
Use this format when adding another feature:

### Short feature name

- Status: Proposed | Planned | In progress
- Priority: Not set | High | Medium | Low
- Tracking: GitHub issue or pull request link, if one exists

Briefly describe the user need and the expected outcome. Avoid prescribing an
implementation unless it is an important product constraint.
-->

## Decisions

### Remaining Windows installer wizard paths

- Decision: Not required, 2026-08-28

The main installer and uninstall flows have been improved and verified on
Windows 11. The remaining maintenance, alternate-choice, and environment
variants are intentionally out of scope. Windows 10 testing is also not
available because no Windows 10 machine is available.

### Remaining Windows installer wording

- Decision: Not required, 2026-10-08

The installer and uninstaller screens were checked on a 0.8.0 pilot build and
are accepted as they are. Three further polish items are intentionally out of
scope: a `Try again` button when myLFR is still open (the installer already
stops, asks the receiver to close it normally, and never force-closes it), a
backup reminder beside the option that deletes records, and an
uninstall-complete screen that states outright whether records were kept or
deleted.

Some strings in `src-tauri/windows/English.nsh` are never displayed, because
the installer tool reads different names: `MUI_TEXT_DIRECTORY_INFO_TITLE`,
`MUI_TEXT_DIRECTORY_INFO_TEXT` and `MUI_UNTEXT_CONFIRM_TEXT`. The install-folder
and uninstall-confirm screens show the installer tool's own standard wording,
which is accepted. Do not assume that file's text is what receivers see.

## Maintaining this list

1. Add each intended feature under `Intended features` using the template above.
2. Update its status as a decision is made or work begins.
3. When the feature is implemented and verified, remove it from this file and
   add the delivered capability to `README.md` under `Implemented workflows`.
4. Keep release or acceptance tasks in `HANDOFF.md`; this file is for product
   capabilities rather than operational release checks.
5. Work that an agent can complete unattended is queued separately in
   `docs/overnight-queue.md`, with an acceptance check attached. An entry may
   appear in both: this file says what is wanted, that one says what will be
   done tonight.
