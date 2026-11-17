---
name: run-desktop-app
description: Launch the myLFR Tauri desktop app in dev mode on WSL2 and verify a change in the real window. Use when asked to run, start, or check the app, or to confirm a UI or command change works outside the test suite.
---

# Running myLFR Desktop in dev

Verified working on WSL2 (Ubuntu, WSLg) on 2026-08-23.

## Launch

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run desktop:dev
```

Run it in the background — it stays up until stopped. `npm run desktop:dev` maps to
`tauri dev --config src-tauri/tauri.dev.conf.json`, which starts Vite on
<http://localhost:1420> and then `cargo run`. First build takes ~10-15s; subsequent
launches are faster. The window is ready once the log reaches `Running target/debug/mylfr-desktop`.

The two `WEBKIT_*` variables prevent a blank window under WSLg's software rendering.

### Expected log noise, not failure

```
libEGL warning: failed to open /dev/dri/renderD128: Permission denied
```

WSL has no GPU passthrough here; WebKit falls back to software rendering. Harmless.

### This window is not the engine users see

The development window renders through **WebKitGTK**. The shipped Windows build renders
through **WebView2**, which is Chromium. Layout, font rendering and CSS support differ,
so this window is good for checking that a change *works* and rough for checking that it
*looks right*.

One concrete case: `WEBKIT_DISABLE_COMPOSITING_MODE=1` above suppresses the
`backdrop-filter: blur(5px)` behind modals. Modals look flat here and blurred in the real
product.

When asking the user to judge appearance, say which engine they are looking at. For an
answer about what receivers actually see, capture the screens from the packaged build
instead — set `MYLFR_SMOKE_SCREENSHOT_DIR` and run the Windows pilot smoke test, as
described under `Capturing what the screens actually look like` in `README.md`.

### Confirming it really started

```bash
ps -o pid,etime,rss,cmd -C mylfr-desktop
```

A healthy window sits around 160 MB RSS. If the process is absent, read the launch log
rather than relaunching blind.

## Frontend-only changes reload themselves

Vite HMR is live. Editing anything under `src/` updates the running window with no
relaunch. Rust changes under `src-tauri/src/` trigger a rebuild and restart, which takes
a few seconds — watch the log for `Finished` before interacting again.

## No screenshot path exists in this environment

`import`, `grim`, `scrot`, and `gnome-screenshot` are all absent, there is no browser
driver, and `sudo` needs a password — so the window cannot be captured from the agent
side. Do not claim to have looked at it.

Instead: launch it, verify the process is healthy, then state the exact on-screen values
you expect and ask the user to confirm. Compute those expected values from the dev
database (below) so the check is concrete rather than a vague "does it look right".

## Reading the dev database

The dev build uses its own identifier, so it never touches real data:

| Build | Data directory |
|---|---|
| `desktop:dev` | `~/.local/share/nz.co.mylfr.desktop.dev/` |
| release | `~/.local/share/nz.co.mylfr.desktop/` |

The database is `mylfr.sqlite3` in WAL mode. **Copy all three files** before opening it,
or the copy will look like it has no tables — recent writes live in the `-wal`:

```bash
S=~/.local/share/nz.co.mylfr.desktop.dev/mylfr.sqlite3
cp "$S" /tmp/dev-copy.db && cp "$S-wal" /tmp/dev-copy.db-wal && cp "$S-shm" /tmp/dev-copy.db-shm
```

Query the copy, never the live file — the running app holds it. Python's stdlib `sqlite3`
is available; there is no `sqlite3` CLI, no `pandas`, and no `pip`.

## Stopping

Kill the background task. Note that anything changed through the UI persists in the dev
database, so reset any preference you toggled while testing.

## Checks before calling a change done

```bash
npx vitest run                                  # frontend
npx tsc --noEmit                                # types
cargo test --manifest-path src-tauri/Cargo.toml # backend
cargo fmt --manifest-path src-tauri/Cargo.toml  # needs --manifest-path from repo root
```
