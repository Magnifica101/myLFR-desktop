//! Detects when myLFR stopped without shutting down.
//!
//! A process that crashes, is ended from Task Manager, runs out of memory, or
//! loses power cannot write anything as it dies. Instead, each running copy
//! keeps a small marker file that it refreshes while alive and removes when it
//! exits cleanly. A marker that is still present at the next launch, and is no
//! longer being refreshed, becomes an entry in the diagnostics log, along with
//! the cause Windows recorded if it crashed (see `crash_cause`) and what the
//! session's output file caught (see `crash_handler`). Markers hold only the
//! app version and when the session started, never business records, and
//! nothing leaves the device.

use std::fs::{self, File};
use std::io::{Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// How often a running copy refreshes its marker.
const HEARTBEAT: Duration = Duration::from_secs(60);
/// How long after launch earlier sessions are checked. Windows can take a few
/// seconds to log a crash, and a copy relaunched straight after one would
/// otherwise look before the entry is there.
const CHECK_DELAY: Duration = Duration::from_secs(20);
/// A marker untouched for this long has ended even if a process with its ID is
/// running, since process IDs are reused. Generous, so a busy or just-woken
/// copy is not mistaken for one that stopped.
const STALE_AFTER: Duration = Duration::from_secs(5 * 60);
/// The session output file is emptied when it grows past this, so a noisy
/// session cannot fill the disk. A crash's lines come last, so they survive.
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024;
/// How many of the last output lines an entry keeps.
const OUTPUT_LINES: usize = 8;

/// This process's session, once [`begin`] has run.
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

struct Session {
    path: PathBuf,
    contents: Vec<u8>,
    open: bool,
    /// Never closed: the process's error output may point at it.
    output: Option<File>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    version: String,
    started_at: DateTime<Utc>,
}

/// An earlier session that ended without shutting down.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UncleanExit {
    pub code: &'static str,
    pub process_id: Option<u32>,
    pub version: String,
    pub started_at: Option<DateTime<Utc>>,
    pub last_seen_at: DateTime<Utc>,
    /// The exception code the crash handler caught, if it ran.
    pub crash_exception: Option<u32>,
    /// `module+0xoffset` frames from the crash handler, innermost first.
    pub stack_trace: Vec<String>,
    /// The session's last lines of error output, not yet sanitised.
    pub last_output: Vec<String>,
}

/// Open this session and keep its marker fresh until [`end`], and shortly
/// afterwards record any earlier sessions that ended without shutting down.
/// `directory` holds only session markers and output files. Safe to call once
/// at startup; later calls are ignored.
pub fn begin(directory: &Path, version: &str) {
    let mut session = lock();
    if session.is_some() || fs::create_dir_all(directory).is_err() {
        return;
    }
    let own_id = std::process::id();
    let path = directory.join(format!("{own_id}.json"));
    // A marker named after this process is from an earlier session whose
    // process ID Windows has since reused. Set it aside to be reported.
    if path.exists() {
        let _ = fs::rename(&path, directory.join(format!("{own_id}.reused.json")));
        let _ = fs::rename(
            path.with_extension("log"),
            directory.join(format!("{own_id}.reused.log")),
        );
    }
    let output = File::create(path.with_extension("log")).ok();
    #[cfg(windows)]
    if let Some(output) = &output {
        // The development crash switch captures error output even when a
        // terminal is attached, so its messages can be tried there.
        let capture = cfg!(debug_assertions) && std::env::var_os("MYLFR_DEV_CRASH").is_some();
        crate::crash_handler::install(output, capture);
    }
    let marker = Marker {
        version: version.to_owned(),
        started_at: Utc::now(),
    };
    let Ok(contents) = serde_json::to_vec(&marker) else {
        return;
    };
    let _ = fs::write(&path, &contents);
    *session = Some(Session {
        path,
        contents,
        open: true,
        output,
    });
    drop(session);
    let directory = directory.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(CHECK_DELAY);
        let is_running = |id| id == own_id || process_is_running(id);
        for exit in collect_unclean_exits(&directory, Utc::now(), system_boot_time(), is_running) {
            let record = crate::crash_cause::look_up(exit.process_id, exit.last_seen_at);
            crate::diagnostics::record_unclean_exit(&exit, &record);
        }
    });
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(HEARTBEAT);
            let session = lock();
            let Some(session) = session.as_ref() else {
                continue;
            };
            if session.open {
                let _ = fs::write(&session.path, &session.contents);
            }
            if let Some(mut output) = session.output.as_ref()
                && output
                    .metadata()
                    .is_ok_and(|metadata| metadata.len() > MAX_OUTPUT_BYTES)
            {
                let _ = output.set_len(0);
                let _ = output.seek(SeekFrom::Start(0));
            }
        }
    });
}

/// Close this session cleanly. Call when the app exits normally and before
/// anything that ends the process without an exit event, such as installing an
/// update.
pub fn end() {
    if let Some(session) = lock().as_mut().filter(|session| session.open) {
        session.open = false;
        let _ = fs::remove_file(&session.path);
    }
}

/// Reopen the session after [`end`] when the exit did not happen after all,
/// for example because an update failed to install.
pub fn resume() {
    if let Some(session) = lock().as_mut().filter(|session| !session.open) {
        session.open = true;
        let _ = fs::write(&session.path, &session.contents);
    }
}

fn lock() -> std::sync::MutexGuard<'static, Option<Session>> {
    SESSION.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Find markers left by sessions that ended without shutting down, remove
/// them and their output files, and describe each one. Output files left by
/// sessions that ended cleanly are removed too. A marker is named after its process ID; one
/// whose process `is_running` and that was refreshed recently belongs to
/// another running copy and is left alone. A long-unrefreshed marker counts as
/// ended even if its process ID is in use, since Windows reuses process IDs.
/// `boot_time` is when the computer last started, if known; a session last
/// seen before it was cut off by a restart or power loss.
pub fn collect_unclean_exits(
    directory: &Path,
    now: DateTime<Utc>,
    boot_time: Option<DateTime<Utc>>,
    is_running: impl Fn(u32) -> bool,
) -> Vec<UncleanExit> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let stale_after = chrono::Duration::from_std(STALE_AFTER).unwrap_or_default();
    let mut exits = Vec::new();
    let mut outputs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        match path.extension().and_then(|extension| extension.to_str()) {
            Some("json") => {}
            Some("log") => {
                outputs.push(path);
                continue;
            }
            _ => continue,
        }
        let Some(last_seen_at) = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .map(DateTime::<Utc>::from)
        else {
            continue;
        };
        let restarted_since = boot_time.is_some_and(|boot| boot > last_seen_at);
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        let running = stem.parse().ok().is_some_and(&is_running);
        if !restarted_since && running && now - last_seen_at < stale_after {
            continue;
        }
        // A marker cut short by power loss may be empty or partly written; it
        // still shows that a session ended without shutting down.
        let marker = fs::read(&path)
            .ok()
            .and_then(|contents| serde_json::from_slice::<Marker>(&contents).ok());
        if fs::remove_file(&path).is_err() {
            continue;
        }
        let output = read_output(&path.with_extension("log"));
        exits.push(UncleanExit {
            code: if restarted_since {
                "SYSTEM_RESTARTED"
            } else {
                "UNEXPECTED_EXIT"
            },
            process_id: stem.split('.').next().and_then(|id| id.parse().ok()),
            version: marker
                .as_ref()
                .map(|marker| marker.version.clone())
                .unwrap_or_else(|| "unknown".to_owned()),
            started_at: marker.map(|marker| marker.started_at),
            last_seen_at,
            crash_exception: output.crash_exception,
            stack_trace: output.stack_trace,
            last_output: output.last_output,
        });
    }
    for output in outputs {
        let stem = output
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if !output.with_extension("json").exists() && !stem.parse().ok().is_some_and(&is_running) {
            let _ = fs::remove_file(output);
        }
    }
    exits.sort_by_key(|exit| exit.last_seen_at);
    exits
}

#[derive(Default)]
struct SessionOutput {
    crash_exception: Option<u32>,
    stack_trace: Vec<String>,
    last_output: Vec<String>,
}

/// Collapse runs of the same frame, as deep recursion leaves, into one entry
/// with a count.
fn collapse_repeats(frames: &[String]) -> Vec<String> {
    let mut collapsed: Vec<String> = Vec::new();
    let mut index = 0;
    while index < frames.len() {
        let run = frames[index..]
            .iter()
            .take_while(|frame| **frame == frames[index])
            .count();
        collapsed.push(if run > 1 {
            format!("{} (repeated {run} times)", frames[index])
        } else {
            frames[index].clone()
        });
        index += run;
    }
    collapsed
}

/// Read and remove a session's output file. Crash-handler lines are taken
/// apart; any other line is error output, of which the last few are kept.
fn read_output(path: &Path) -> SessionOutput {
    let mut output = SessionOutput::default();
    let Ok(contents) = fs::read(path) else {
        return output;
    };
    let _ = fs::remove_file(path);
    for line in String::from_utf8_lossy(&contents).lines() {
        let line = line.trim_end();
        if let Some(code) = line.strip_prefix("[crash] exception 0x") {
            output.crash_exception = u32::from_str_radix(code, 16).ok();
            output.stack_trace.clear();
        } else if let Some(frame) = line.strip_prefix("[frame] ") {
            output.stack_trace.push(frame.to_owned());
        } else if !line.is_empty() && !line.starts_with("note: run with `RUST_BACKTRACE") {
            output.last_output.push(line.to_owned());
        }
    }
    output.stack_trace = collapse_repeats(&output.stack_trace);
    let excess = output.last_output.len().saturating_sub(OUTPUT_LINES);
    output.last_output.drain(..excess);
    output
}

/// When the computer last started, from the system uptime.
fn system_boot_time() -> Option<DateTime<Utc>> {
    let uptime = system_uptime()?;
    Some(Utc::now() - chrono::Duration::from_std(uptime).ok()?)
}

#[cfg(windows)]
fn system_uptime() -> Option<Duration> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetTickCount64() -> u64;
    }
    // SAFETY: GetTickCount64 takes no arguments and cannot fail.
    Some(Duration::from_millis(unsafe { GetTickCount64() }))
}

#[cfg(target_os = "linux")]
fn system_uptime() -> Option<Duration> {
    let contents = fs::read_to_string("/proc/uptime").ok()?;
    let seconds: f64 = contents.split_whitespace().next()?.parse().ok()?;
    Some(Duration::from_secs_f64(seconds))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn system_uptime() -> Option<Duration> {
    None
}

/// Development builds only: when `MYLFR_DEV_CRASH` is `abort`, `out-of-memory`,
/// `stack-overflow`, or `access-violation`, crash on purpose 30 seconds after
/// launch so crash reporting can be tried in the development app.
#[cfg(debug_assertions)]
pub fn crash_for_testing_if_asked() {
    let Ok(kind) = std::env::var("MYLFR_DEV_CRASH") else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        match kind.as_str() {
            "abort" => std::process::abort(),
            "out-of-memory" => {
                let memory = vec![0_u8; 1 << 46];
                std::hint::black_box(memory);
            }
            "stack-overflow" => {
                #[allow(unconditional_recursion)]
                fn recurse(depth: u64) -> u64 {
                    let frame = std::hint::black_box([depth; 64]);
                    recurse(depth + 1) + frame[0]
                }
                std::hint::black_box(recurse(0));
            }
            #[cfg(windows)]
            "access-violation" => {
                const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC000_0005;
                const EXCEPTION_NONCONTINUABLE: u32 = 1;
                #[link(name = "kernel32")]
                unsafe extern "system" {
                    fn RaiseException(code: u32, flags: u32, count: u32, arguments: *const usize);
                }
                // SAFETY: raises an exception nothing handles, which ends the
                // process the way a real native crash does.
                unsafe {
                    RaiseException(
                        EXCEPTION_ACCESS_VIOLATION,
                        EXCEPTION_NONCONTINUABLE,
                        0,
                        std::ptr::null(),
                    )
                };
            }
            _ => {}
        }
    });
}

#[cfg(windows)]
fn process_is_running(id: u32) -> bool {
    use std::ffi::c_void;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, id: u32) -> *mut c_void;
        fn GetExitCodeProcess(process: *mut c_void, code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    // SAFETY: the handle is checked for null, used only for the exit-code
    // query, and closed before returning.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id);
        if process.is_null() {
            return false;
        }
        let mut code = 0;
        let running = GetExitCodeProcess(process, &mut code) != 0 && code == STILL_ACTIVE;
        CloseHandle(process);
        running
    }
}

#[cfg(target_os = "linux")]
fn process_is_running(id: u32) -> bool {
    Path::new(&format!("/proc/{id}")).exists()
}

/// Without a way to tell, assume the process is running, so only
/// long-unrefreshed markers are reported.
#[cfg(not(any(windows, target_os = "linux")))]
fn process_is_running(_id: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::FileTimes;
    use std::time::SystemTime;

    fn write_marker(directory: &Path, name: &str, contents: &str, age: Duration) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, contents).unwrap();
        let modified = SystemTime::now() - age;
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
        path
    }

    const MARKER: &str = r#"{"version":"0.8.0","startedAt":"2026-10-10T01:00:00Z"}"#;

    #[test]
    fn fresh_markers_belong_to_running_copies_and_are_kept() {
        let directory = tempfile::tempdir().unwrap();
        let path = write_marker(directory.path(), "1.json", MARKER, Duration::from_secs(30));
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| true);
        assert!(exits.is_empty());
        assert!(path.exists());
    }

    #[test]
    fn a_fresh_marker_whose_process_has_gone_is_reported_straight_away() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(directory.path(), "1.json", MARKER, Duration::from_secs(30));
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| false);
        assert_eq!(exits.len(), 1);
        assert_eq!(exits[0].code, "UNEXPECTED_EXIT");
        assert_eq!(exits[0].process_id, Some(1));
    }

    #[test]
    fn a_marker_set_aside_because_its_process_id_was_reused_is_reported() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(
            directory.path(),
            "7.reused.json",
            MARKER,
            Duration::from_secs(30),
        );
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| true);
        assert_eq!(exits.len(), 1);
        assert_eq!(exits[0].process_id, Some(7));
    }

    #[test]
    fn stale_markers_are_reported_once_as_unexpected_exits() {
        let directory = tempfile::tempdir().unwrap();
        let path = write_marker(
            directory.path(),
            "1.json",
            MARKER,
            Duration::from_secs(3600),
        );
        let boot = Utc::now() - chrono::Duration::days(1);
        let exits = collect_unclean_exits(directory.path(), Utc::now(), Some(boot), |_| true);
        assert_eq!(exits.len(), 1);
        assert_eq!(exits[0].code, "UNEXPECTED_EXIT");
        assert_eq!(exits[0].version, "0.8.0");
        assert_eq!(
            exits[0].started_at,
            Some("2026-10-10T01:00:00Z".parse().unwrap())
        );
        assert!(!path.exists());
        assert!(
            collect_unclean_exits(directory.path(), Utc::now(), Some(boot), |_| true).is_empty()
        );
    }

    #[test]
    fn a_session_last_seen_before_the_computer_started_was_cut_off_by_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(directory.path(), "1.json", MARKER, Duration::from_secs(120));
        let boot = Utc::now() - chrono::Duration::seconds(60);
        let exits = collect_unclean_exits(directory.path(), Utc::now(), Some(boot), |_| true);
        assert_eq!(exits.len(), 1);
        assert_eq!(exits[0].code, "SYSTEM_RESTARTED");
    }

    #[test]
    fn a_damaged_marker_is_still_reported() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(directory.path(), "1.json", "", Duration::from_secs(3600));
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| true);
        assert_eq!(exits.len(), 1);
        assert_eq!(exits[0].version, "unknown");
        assert_eq!(exits[0].started_at, None);
    }

    #[test]
    fn other_files_are_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let path = write_marker(
            directory.path(),
            "notes.txt",
            "x",
            Duration::from_secs(3600),
        );
        assert!(collect_unclean_exits(directory.path(), Utc::now(), None, |_| true).is_empty());
        assert!(path.exists());
    }

    #[test]
    fn a_crashed_session_brings_its_stack_trace_and_last_output() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(directory.path(), "9.json", MARKER, Duration::from_secs(30));
        let output = "starting\nmemory allocation of 70368744177664 bytes failed\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n[crash] exception 0xC0000005\n[frame] KERNELBASE.dll+0xc483a\n[frame] mylfr-desktop.exe+0x2ed4b5\n[frame] mylfr-desktop.exe+0x4519f3\n[frame] mylfr-desktop.exe+0x4519f3\n[frame] mylfr-desktop.exe+0x4519f3\n";
        fs::write(directory.path().join("9.log"), output).unwrap();
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| false);
        assert_eq!(exits[0].crash_exception, Some(0xC000_0005));
        assert_eq!(
            exits[0].stack_trace,
            [
                "KERNELBASE.dll+0xc483a",
                "mylfr-desktop.exe+0x2ed4b5",
                "mylfr-desktop.exe+0x4519f3 (repeated 3 times)"
            ]
        );
        assert_eq!(
            exits[0].last_output,
            [
                "starting",
                "memory allocation of 70368744177664 bytes failed"
            ]
        );
        assert!(!directory.path().join("9.log").exists());
    }

    #[test]
    fn only_the_last_output_lines_are_kept() {
        let directory = tempfile::tempdir().unwrap();
        write_marker(directory.path(), "9.json", MARKER, Duration::from_secs(30));
        let output: String = (1..=20).map(|line| format!("line {line}\n")).collect();
        fs::write(directory.path().join("9.log"), output).unwrap();
        let exits = collect_unclean_exits(directory.path(), Utc::now(), None, |_| false);
        assert_eq!(exits[0].last_output.len(), OUTPUT_LINES);
        assert_eq!(exits[0].last_output.last().unwrap(), "line 20");
    }

    #[test]
    fn output_files_of_clean_sessions_are_removed_and_running_ones_kept() {
        let directory = tempfile::tempdir().unwrap();
        let ended = directory.path().join("3.log");
        let running = directory.path().join("4.log");
        fs::write(&ended, "x").unwrap();
        fs::write(&running, "x").unwrap();
        write_marker(directory.path(), "4.json", MARKER, Duration::from_secs(30));
        collect_unclean_exits(directory.path(), Utc::now(), None, |id| id == 4);
        assert!(!ended.exists());
        assert!(running.exists());
    }
}
