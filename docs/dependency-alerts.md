# Dependency alerts

Dependabot vulnerability alerts and automated security fixes are enabled on this
repository. This document records how alerts are judged, and the standing
reasoning behind any that have been dismissed, so a dismissal does not have to
be re-derived months later.

## Latest review — 2026-11-10

- GitHub had no open issues. The Verify run after bringing the vessel work to
  `main` passed Rust checks and failed the npm audit step.
- Updated Vite to 8.2.6, Vitest and its mocker to 4.1.12, and the Undici version
  used by jsdom to 7.30.2. The npm lockfile audit reports zero vulnerabilities.
- Updated Rustls to 0.23.46 and ZIP to 9.0.5. The Windows updater previously
  pulled in a separate ZIP 4.x release. Updater 2.14.1 uses the same patched ZIP
  release as the backup code, so the lockfile has only one ZIP version.
- ZIP now rejects some malformed entries before the app can check their size.
  The backup reader reports those invalid entries as invalid backups and still
  applies its own size, checksum, and SQLite integrity checks.
- GitHub code scanning and secret scanning are disabled on this private
  repository. Other Dependabot version updates are tracked separately.

## Previous review — 2026-10-13

Reviewed the live GitHub issue and pull-request lists, recent Actions runs,
Dependabot alerts (including dismissed alerts), npm audit and available npm
updates, and a dry-run Cargo update against `main` at
`eaa6200149d94bda217b2a61a0ab16e70d205d04`.

- No open issues, pull requests, or Dependabot alerts. The latest Verify run
  on `main` passed. Dependabot alerts and automated security fixes are enabled.
- `npm audit --include=dev` reported zero vulnerabilities before and after these updates.
- Two dismissed Cargo advisories still matched the lockfile. The historical
  dismissal comments cite Rust 1.85, but the project now declares Rust 1.90.
  Targeted updates in this change remove those affected versions without
  updating Tauri or its plugins:
  - `time` 0.3.45 → 0.3.47, the first patched version for
    [GHSA-r6v5-fh4h-64xc](https://github.com/advisories/GHSA-r6v5-fh4h-64xc).
  - `serde_with` 3.17.0 → 3.21.0, the first patched version for
    [GHSA-7gcf-g7xr-8hxj](https://github.com/advisories/GHSA-7gcf-g7xr-8hxj).
  Both alerts were dismissed as `not_used`; these updates remove the affected
  dependency versions, rather than asserting that the application was exploitable.
- Updated `@tanstack/react-query` 5.104.1 → 5.104.2 for the upstream
  [mutation handling fixes](https://github.com/TanStack/query/releases/tag/release-2026-10-11-1936),
  and `@testing-library/react` 16.3.2 → 16.3.3 for its
  [event dispatch fix](https://github.com/testing-library/react-testing-library/releases/tag/v16.3.3).
- The dismissed `glib` advisory remains subject to the Windows target exclusion
  documented below.
- Code scanning and secret scanning are disabled on the private repository.
  This is a coverage limit, not a clean scan result. The publication prerequisites
  remain in [`HANDOFF.md`](../HANDOFF.md).

Other available updates were deferred: Tauri and updater dependencies need
desktop and installed-build verification; PDF and React changes need their
export and screen checks; major test-tool upgrades need a separate migration.
A blanket Cargo update proposed 146 package changes, including updater
signature verification dependencies. Keep those separate from this targeted
maintenance change. This review does not replace an application security scan.

## How to judge an alert

Ask these in order. The first "no" usually settles it.

1. **Is the crate or package in the shipped Windows artifact?** The product ships
   on Windows and uses WebView2. Dependencies gated to other platforms are
   resolved in the lockfile but never compiled into what a receiver installs.
   Check the dependency's `target` gate, not just its presence in
   `Cargo.lock` or `package-lock.json`.
2. **Is it reachable from code this project calls?** A transitive crate may be
   present but the vulnerable API never exercised.
3. **Can it be fixed at a layer this project controls?** A direct dependency can
   be bumped. A transitive one pinned by an upstream crate cannot, and forcing it
   means overriding the dependency graph of a framework this project relies on.
4. **What is the blast radius if it is real?** Anything touching the updater
   signature path, Authenticode verification, or backup integrity is treated
   as urgent regardless of severity score.

Record the answer. An alert dismissed without a reason someone can check is
worse than an alert left open.

## Why alerts matter more than the current alert count suggests

Enabling alerts was deliberate. The updater's signature verification and the
backup validation path are both security-relevant, and a real advisory in any
dependency they touch needs to reach the author quickly.
The risk to guard against is alert fatigue: a permanently unfixable alert sitting
on the page trains everyone to ignore the page. Dismiss what cannot be actioned,
with the reasoning written down, so what remains is worth reading.

## Dismissed alerts

### glib — GHSA-wrw7-89jp-8q8g (medium)

Unsoundness in the `Iterator` and `DoubleEndedIterator` implementations for
`glib::VariantStrIter`. Affects `>= 0.15.0, < 0.20.0`; the lockfile resolves
`glib 0.18.5`.

**Dismissed as "not used", on 2026-08-26.** Three independent reasons, any one of
which is sufficient:

- **Not in the product.** `glib` is reached only through `gtk`, `webkit2gtk`,
  `gdk`, `gio`, `pango`, `soup3`, `javascriptcore-rs` and `wry`. Every one of
  those is declared under
  `cfg(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd"))`.
  The Windows build uses WebView2 and compiles none of it. Dependabot reads the
  lockfile, which records the resolution for every platform, and has no view of
  target gates.
- **Not built in CI.** `.github/workflows/verify.yml` runs
  `cargo test --no-default-features`, which excludes the `desktop` feature and
  therefore the whole GTK stack. The only place this code is ever compiled is a
  developer's Linux or WSL machine running `npm run desktop:dev`.
- **Not fixable at any layer this project controls.** The patched release is
  `glib 0.20.0`. `wry` pins `webkit2gtk =2.0.2` exactly and `gtk ^0.18`, and
  `gtk` — the GTK3 binding — is frozen at `0.18.2` because gtk-rs has moved to
  GTK4. No version of Tauri can lift the ceiling; `cargo update -p glib` resolves
  to no change, which was verified rather than assumed.

**When to revisit.** The GTK4-era bindings exist and are maintained: `gtk4` and
`webkit6` both had releases in 2026. If `wry` migrates its Linux backend to
them, `glib` moves past 0.20 and this resolves on its own. That migration is
upstream work and has no announced timeline. There is nothing to do here in the
meantime, and nothing to wait for either.
