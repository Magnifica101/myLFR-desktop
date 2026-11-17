# Reading crash reports

myLFR records crashes in its diagnostics log, which reaches the maintainer
only when a receiver copies the problem report (Settings → Bug report) into a
GitHub issue. Nothing is sent automatically. This page explains the crash
entries in that report and how to turn their stack traces into function names
and source lines.

## What is recorded

| Entry `code` | What happened | How it is caught |
| --- | --- | --- |
| `PANIC` | A Rust panic | Panic hook, at the time; on Windows with a `stackTrace` |
| `UNEXPECTED_EXIT` | The app ended without shutting down: a crash, running out of memory, or being ended from Task Manager | A session marker left behind, found at the next launch |
| `SYSTEM_RESTARTED` | The computer restarted or lost power while the app was open | As above, with the computer started since the marker was last refreshed |
| `WEBVIEW_PROCESS_FAILED` | A WebView2 process (the screens) crashed, ran out of memory, or stopped responding while the app kept running | WebView2's process-failed event |

An `UNEXPECTED_EXIT` entry can carry:

- `windowsCrashRecord`: `found` when Windows Error Reporting logged the crash
  (Application event 1000) or a hang (event 1002) for that process, `none`
  when it logged nothing (most likely ended from Task Manager), or
  `unavailable` when the event log could not be read.
- `faultingModule`, `moduleVersion`, `exceptionCode`, `faultOffset`: from the
  Windows record. Common codes: `0xC0000005` memory access violation,
  `0xC00000FD` stack overflow, `0xC0000409` the app stopped itself after a
  fatal error (Rust abort, including running out of memory), `0xC0000374`
  heap corruption.
- `lastOutput`: the app's last lines of error output, sanitised. For a
  `0xC0000409` stop this holds the reason, for example `memory allocation of
  [num] bytes failed`.
- `stackTrace`: from myLFR's crash handler, innermost frame first, each as
  `module+0xoffset`. A `0xC0000409` stop ends the process without running the
  handler, so it has no trace; its reason is in `lastOutput`.

No memory contents are recorded, so a report cannot contain business records.
Module entries are file names only.

## Turning a stack trace into functions and lines

Frames in `mylfr-desktop.exe` need the debug symbols of the exact version that
crashed (`applicationVersion`). Each release run uploads them as the
`mylfr-debug-symbols-windows` artifact (`mylfr_desktop.pdb` and the matching
unsigned `mylfr-desktop.exe`). They are not shipped to receivers. GitHub
deletes artifacts after 90 days, so download the symbols with each release's
packages and keep them while that version is in use.

Save the problem report as a `.json` file, then run:

```bash
cargo run --manifest-path tools/crash-symbols/Cargo.toml -- path/to/mylfr_desktop.pdb path/to/report.json
```

Each trace is printed with function names and source lines. Inlined functions
are listed under the frame they were inlined into. Frames in Windows or
WebView2 modules are printed as they are; their module and version identify
the Windows or WebView2 build involved.

## Trying it in the development app

Development builds crash on purpose 30 seconds after launch when
`MYLFR_DEV_CRASH` is set to `abort`, `out-of-memory`, `stack-overflow`, or
`access-violation`. In PowerShell in the Windows checkout:

```powershell
$env:MYLFR_DEV_CRASH = 'access-violation'; npm run desktop:dev
```

After the crash, remove the variable (`Remove-Item Env:MYLFR_DEV_CRASH`) and
launch normally. About 20 seconds after launch the crash appears in the
problem report. The development build's symbols are
`src-tauri/target/debug/mylfr_desktop.pdb`, and they change with every
rebuild.
