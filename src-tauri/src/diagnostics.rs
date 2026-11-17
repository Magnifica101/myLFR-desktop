//! Best-effort, privacy-preserving diagnostics log.
//!
//! Handled application errors, Rust panics, WebView2 process failures, and
//! sessions that ended without shutting down are appended to a capped
//! JSON-lines file in the app data directory so they can be included in a
//! sanitised diagnostics export. The log never stores business records; free
//! text is scrubbed of filesystem paths and long digit runs before it is
//! written.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use chrono::Utc;
use serde_json::{Value, json};

const MAX_ENTRIES: usize = 100;
const MAX_MESSAGE_LEN: usize = 500;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Point the diagnostics log at `path` and install a panic hook that records
/// panics before the process exits. Safe to call once at startup; later calls
/// are ignored.
pub fn init(path: PathBuf) {
    if LOG_PATH.set(path).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "unknown".to_owned());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_owned());
        #[cfg(windows)]
        let stack_trace = crate::crash_handler::stack_frames();
        #[cfg(not(windows))]
        let stack_trace: Vec<String> = Vec::new();
        append(json!({
            "at": Utc::now().to_rfc3339(),
            "kind": "panic",
            "code": "PANIC",
            "message": sanitize(&message),
            "location": location,
            "stackTrace": stack_trace,
        }));
        previous(info);
    }));
}

/// Record a handled application error. `code` is the stable error code; `detail`
/// is the underlying error text, which is sanitised before it is written.
pub fn record_error(code: &str, detail: &str) {
    append(json!({
        "at": Utc::now().to_rfc3339(),
        "kind": "error",
        "code": code,
        "message": sanitize(detail),
    }));
}

/// Record an earlier session that ended without shutting down, with what the
/// Windows event log says about it. The entry is dated when that session was
/// last seen running, not when it was found. The session's last error output
/// is sanitised; every other field is built from fixed text, numbers, or
/// module file names.
pub fn record_unclean_exit(
    exit: &crate::session::UncleanExit,
    record: &crate::crash_cause::CrashRecord,
) {
    use crate::crash_cause::{CrashCause, CrashRecord, describe_exception};

    let mut entry = json!({
        "at": exit.last_seen_at.to_rfc3339(),
        "kind": "unclean-exit",
        "code": exit.code,
        "applicationVersion": sanitize(&exit.version),
        "sessionStartedAt": exit.started_at.map(|at| at.to_rfc3339()),
        "detectedAt": Utc::now().to_rfc3339(),
        "windowsCrashRecord": match record {
            CrashRecord::Found(_) => "found",
            CrashRecord::NotFound => "none",
            CrashRecord::Unavailable => "unavailable",
        },
    });
    if !exit.stack_trace.is_empty() {
        entry["stackTrace"] = json!(exit.stack_trace);
    }
    let last_output: Vec<String> = exit.last_output.iter().map(|line| sanitize(line)).collect();
    if !last_output.is_empty() {
        entry["lastOutput"] = json!(last_output);
    }
    // Rust prints why it is stopping itself as the last line of output.
    let reason = last_output
        .iter()
        .rev()
        .find(|line| !line.starts_with("note:"))
        .map(|line| {
            line.trim_start_matches("fatal runtime error: ")
                .trim_end_matches('.')
                .to_owned()
        });
    let message = match record {
        CrashRecord::Found(CrashCause::Fault {
            module,
            module_version,
            exception_code,
            offset,
        }) => {
            entry["faultingModule"] = json!(module);
            entry["moduleVersion"] = json!(module_version);
            entry["exceptionCode"] = json!(format!("0x{exception_code:08X}"));
            entry["faultOffset"] = json!(offset);
            match &reason {
                Some(reason) if *exception_code == 0xC000_0409 => {
                    format!("myLFR stopped itself after a fatal error: {reason}.")
                }
                _ => format!(
                    "myLFR crashed in {module} ({}).",
                    describe_exception(*exception_code)
                ),
            }
        }
        CrashRecord::Found(CrashCause::Hang) => {
            "myLFR stopped responding and was closed.".to_owned()
        }
        _ if exit.crash_exception.is_some() => {
            let code = exit.crash_exception.unwrap_or_default();
            entry["exceptionCode"] = json!(format!("0x{code:08X}"));
            format!("myLFR crashed ({}).", describe_exception(code))
        }
        _ if exit.code == "SYSTEM_RESTARTED" => {
            "myLFR was open when the computer restarted unexpectedly or lost power.".to_owned()
        }
        CrashRecord::NotFound => {
            "myLFR closed without shutting down, and Windows recorded no crash. It was most likely ended from Task Manager or by another program.".to_owned()
        }
        CrashRecord::Unavailable => {
            "myLFR closed without shutting down. It may have crashed, run out of memory, or been ended from Task Manager.".to_owned()
        }
    };
    entry["message"] = json!(message);
    append(entry);
}

/// Record a WebView2 process failure. `process` and `reason` are fixed names
/// chosen by the caller, and `exit_code` is the process exit code, so nothing
/// here needs sanitising.
pub fn record_webview_failure(process: &str, reason: Option<&str>, exit_code: Option<i32>) {
    append(json!({
        "at": Utc::now().to_rfc3339(),
        "kind": "native",
        "code": "WEBVIEW_PROCESS_FAILED",
        "message": format!("The WebView2 {process} process failed."),
        "process": process,
        "reason": reason,
        "exitCode": exit_code.map(|code| format!("0x{:08X}", code as u32)),
    }));
}

/// Return up to `limit` most recent entries, oldest first.
pub fn recent(limit: usize) -> Vec<Value> {
    let Some(path) = LOG_PATH.get() else {
        return Vec::new();
    };
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let mut entries: Vec<Value> = read_lines(path)
        .iter()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if entries.len() > limit {
        entries.drain(0..entries.len() - limit);
    }
    entries
}

/// Read the log into its non-empty lines, or an empty vec if it does not exist.
fn read_lines(path: &PathBuf) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .map(|contents| {
            contents
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn append(entry: Value) {
    let Some(path) = LOG_PATH.get() else {
        return;
    };
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let mut lines = read_lines(path);
    lines.push(entry.to_string());
    if lines.len() > MAX_ENTRIES {
        lines.drain(0..lines.len() - MAX_ENTRIES);
    }
    let _ = fs::write(path, format!("{}\n", lines.join("\n")));
}

/// Best-effort removal of filesystem paths and long digit runs so an error
/// message can be shared for support without leaking records or local paths.
fn sanitize(message: &str) -> String {
    let cleaned = message
        .split_whitespace()
        .map(|token| {
            if looks_like_path(token) {
                "[path]".to_owned()
            } else {
                redact_digit_runs(token)
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.chars().count() > MAX_MESSAGE_LEN {
        let truncated: String = cleaned.chars().take(MAX_MESSAGE_LEN).collect();
        format!("{truncated}…")
    } else {
        cleaned
    }
}

fn looks_like_path(token: &str) -> bool {
    token.contains(":\\")
        || token.contains('\\')
        || token.contains("/home/")
        || token.contains("/Users/")
        || (token.starts_with('/') && token.len() > 3)
}

fn redact_digit_runs(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    let mut buffer = String::new();
    for ch in token.chars() {
        if ch.is_ascii_digit() {
            buffer.push(ch);
        } else {
            flush_run(&mut out, &mut buffer);
            out.push(ch);
        }
    }
    flush_run(&mut out, &mut buffer);
    out
}

fn flush_run(out: &mut String, buffer: &mut String) {
    if buffer.chars().count() >= 4 {
        out.push_str("[num]");
    } else {
        out.push_str(buffer);
    }
    buffer.clear();
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn redacts_paths_and_long_numbers() {
        let cleaned = sanitize("failed to open C:\\Users\\Sam\\mylfr.sqlite3 for permit 12345678");
        assert!(
            cleaned.contains("[path]"),
            "path should be redacted: {cleaned}"
        );
        assert!(
            cleaned.contains("[num]"),
            "long number should be redacted: {cleaned}"
        );
        assert!(!cleaned.contains("12345678"));
    }

    #[test]
    fn keeps_short_numbers_and_words() {
        assert_eq!(sanitize("version 3 failed"), "version 3 failed");
    }
}
