//! Looks up why an earlier myLFR session crashed, from the Windows event log.
//!
//! When a program crashes, or is closed while not responding, Windows Error
//! Reporting writes an "Application Error" (event 1000) or "Application Hang"
//! (event 1002) entry to the Application event log, whether or not the report
//! is sent anywhere. The entry is matched to the crashed session by process ID
//! and time. Only the faulting module's file name and version, the exception
//! code, and the fault offset are kept; folder paths, report IDs, and the rest
//! of the entry are not.

use chrono::{DateTime, Utc};

/// What the Windows event log says about a session that ended without
/// shutting down.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrashRecord {
    Found(CrashCause),
    /// Windows recorded no crash or hang for the process.
    NotFound,
    /// The event log could not be read, or this is not Windows.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrashCause {
    Fault {
        module: String,
        module_version: String,
        exception_code: u32,
        offset: String,
    },
    /// The app stopped responding and was closed.
    Hang,
}

/// Field positions in older event entries whose fields are not named.
const FAULT_FIELDS: [&str; 9] = [
    "AppName",
    "AppVersion",
    "AppTimeStamp",
    "ModuleName",
    "ModuleVersion",
    "ModuleTimeStamp",
    "ExceptionCode",
    "FaultingOffset",
    "ProcessId",
];
const HANG_FIELDS: [&str; 3] = ["AppName", "AppVersion", "ProcessId"];

/// Find the crash or hang entry for process `process_id` of `app_name` in the
/// XML `wevtutil qe /f:xml` writes.
pub fn parse(xml: &str, app_name: &str, process_id: u32) -> Option<CrashCause> {
    xml.split("<Event ").skip(1).find_map(|event| {
        let event_id = element_text(event, "EventID")?;
        let positions: &[&str] = match event_id.trim() {
            "1000" => &FAULT_FIELDS,
            "1002" => &HANG_FIELDS,
            _ => return None,
        };
        let fields = data_fields(event);
        let field = |name: &str| {
            fields
                .iter()
                .find(|(field, _)| field.as_deref() == Some(name))
                .or_else(|| {
                    let index = positions.iter().position(|position| *position == name)?;
                    fields.get(index).filter(|(field, _)| field.is_none())
                })
                .map(|(_, value)| value.trim())
        };
        if !field("AppName")?.eq_ignore_ascii_case(app_name)
            || parse_hex(field("ProcessId")?)? != process_id
        {
            return None;
        }
        if event_id.trim() == "1002" {
            return Some(CrashCause::Hang);
        }
        Some(CrashCause::Fault {
            module: file_name(field("ModuleName").unwrap_or_default()),
            module_version: field("ModuleVersion")
                .unwrap_or_default()
                .chars()
                .filter(|ch| ch.is_ascii_digit() || *ch == '.')
                .take(40)
                .collect(),
            exception_code: field("ExceptionCode")
                .and_then(parse_hex)
                .unwrap_or_default(),
            offset: format!(
                "0x{:x}",
                field("FaultingOffset")
                    .and_then(|offset| u64::from_str_radix(offset, 16).ok())
                    .unwrap_or_default()
            ),
        })
    })
}

/// A short description of a Windows exception code.
pub fn describe_exception(code: u32) -> &'static str {
    match code {
        0xC000_0005 => "memory access violation",
        0xC000_0409 => "stopped itself after a fatal error",
        0xC000_00FD => "stack overflow",
        0xC000_0374 => "heap corruption",
        0xC000_0017 | 0xC000_012D => "out of memory",
        0xC000_001D => "illegal instruction",
        0xC000_0094 => "division by zero",
        0xE06D_7363 => "unhandled C++ exception",
        0x8000_0003 => "breakpoint",
        _ => "unexpected exception",
    }
}

/// Make sure Windows records this process's crashes. A launcher can switch
/// that off for the programs it starts, and the setting is inherited; Node.js
/// does, so without this the development app would never have a crash record.
#[cfg(windows)]
pub fn keep_windows_crash_records() {
    const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetErrorMode() -> u32;
        fn SetErrorMode(mode: u32) -> u32;
    }
    // SAFETY: both calls only read or set this process's error-mode flags.
    unsafe {
        let mode = GetErrorMode();
        if mode & SEM_NOGPFAULTERRORBOX != 0 {
            SetErrorMode(mode & !SEM_NOGPFAULTERRORBOX);
        }
    }
}

/// Look in the Windows event log for why process `process_id` ended. The
/// search starts shortly before the session was last seen running.
#[cfg(windows)]
pub fn look_up(process_id: Option<u32>, last_seen_at: DateTime<Utc>) -> CrashRecord {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Some(process_id) = process_id else {
        return CrashRecord::Unavailable;
    };
    let Some(app_name) = std::env::current_exe()
        .ok()
        .and_then(|path| Some(path.file_name()?.to_str()?.to_owned()))
    else {
        return CrashRecord::Unavailable;
    };
    let since = last_seen_at - chrono::Duration::minutes(2);
    let query = format!(
        "*[System[Provider[@Name='Application Error' or @Name='Application Hang'] and (EventID=1000 or EventID=1002) and TimeCreated[@SystemTime>='{}']]]",
        since.format("%Y-%m-%dT%H:%M:%S%.3fZ")
    );
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let wevtutil = std::path::Path::new(&system_root).join("System32\\wevtutil.exe");
    let output = std::process::Command::new(wevtutil)
        .args([
            "qe",
            "Application",
            &format!("/q:{query}"),
            "/f:xml",
            "/c:200",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(output) if output.status.success() => {
            match parse(
                &String::from_utf8_lossy(&output.stdout),
                &app_name,
                process_id,
            ) {
                Some(cause) => CrashRecord::Found(cause),
                None => CrashRecord::NotFound,
            }
        }
        _ => CrashRecord::Unavailable,
    }
}

#[cfg(not(windows))]
pub fn look_up(_process_id: Option<u32>, _last_seen_at: DateTime<Utc>) -> CrashRecord {
    CrashRecord::Unavailable
}

/// The text of the first `<name ...>text</name>` element in `xml`.
fn element_text<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{name}"))?;
    let rest = &xml[start..];
    let open_end = rest.find('>')?;
    if rest[..open_end].ends_with('/') {
        return Some("");
    }
    let rest = &rest[open_end + 1..];
    Some(&rest[..rest.find(&format!("</{name}>"))?])
}

/// Each `<Data>` element in order, with its `Name` attribute if it has one.
fn data_fields(event: &str) -> Vec<(Option<String>, String)> {
    let mut fields = Vec::new();
    let mut rest = event;
    while let Some(start) = rest.find("<Data") {
        rest = &rest[start + "<Data".len()..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        let attributes = &rest[..open_end];
        let name = attributes.split_once("Name=").and_then(|(_, value)| {
            let quote = value.chars().next()?;
            let value = &value[1..];
            Some(value[..value.find(quote)?].to_owned())
        });
        if attributes.ends_with('/') {
            fields.push((name, String::new()));
            rest = &rest[open_end + 1..];
            continue;
        }
        rest = &rest[open_end + 1..];
        let Some(close) = rest.find("</Data>") else {
            break;
        };
        fields.push((name, unescape(&rest[..close])));
        rest = &rest[close..];
    }
    fields
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn parse_hex(text: &str) -> Option<u32> {
    let text = text.trim();
    let digits = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .unwrap_or(text);
    u32::from_str_radix(digits, 16).ok()
}

/// Only the file name, so a module's folder never reaches the report.
fn file_name(module: &str) -> String {
    module
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .chars()
        .take(100)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAULT: &str = r"<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Application Error' Guid='{a0e9b465-b939-57d7-b27d-95d8e925ff57}'/><EventID>1000</EventID><TimeCreated SystemTime='2026-10-06T04:40:30.0505778Z'/></System><EventData><Data Name='AppName'>mylfr-desktop.exe</Data><Data Name='AppVersion'>0.8.0.0</Data><Data Name='AppTimeStamp'>6aafbd7b</Data><Data Name='ModuleName'>ntdll.dll</Data><Data Name='ModuleVersion'>10.0.26100.4652</Data><Data Name='ModuleTimeStamp'>6a9db36e</Data><Data Name='ExceptionCode'>c0000374</Data><Data Name='FaultingOffset'>0000000000104c7c</Data><Data Name='ProcessId'>0x5ea8</Data><Data Name='ProcessCreationTime'>0x1dd554cc8b9e61f</Data><Data Name='AppPath'>C:\Users\Sam\AppData\Local\myLFR Desktop\mylfr-desktop.exe</Data><Data Name='ModulePath'>C:\Windows\SYSTEM32\ntdll.dll</Data><Data Name='IntegratorReportId'>cbc8e837-15cd-46cc-8ff3-c51ccc965858</Data><Data Name='PackageFullName'></Data><Data Name='PackageRelativeAppId'></Data></EventData></Event>";

    const HANG: &str = r"<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Application Hang'/><EventID>1002</EventID></System><EventData><Data Name='AppName'>mylfr-desktop.exe</Data><Data Name='AppVersion'>0.8.0.0</Data><Data Name='ProcessId'>0x4488</Data><Data Name='StartTime'>0x1dd538c3f8c0e0e</Data><Data Name='TerminationTime'>4294967295</Data><Data Name='ExeFileName'>C:\Program Files\myLFR Desktop\mylfr-desktop.exe</Data><Data Name='HangType'>Quiesce</Data></EventData></Event>";

    /// Windows 10 writes the same fields without names.
    const UNNAMED_FAULT: &str = r"<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Application Error'/><EventID Qualifiers='0'>1000</EventID></System><EventData><Data>mylfr-desktop.exe</Data><Data>0.8.0.0</Data><Data>6aafbd7b</Data><Data>WebView2Loader.dll</Data><Data>1.0.2903.40</Data><Data>6a9db36e</Data><Data>c0000005</Data><Data>00000000000a1b2c</Data><Data>0x1f40</Data><Data/><Data>C:\Users\Sam\mylfr-desktop.exe</Data></EventData></Event>";

    #[test]
    fn finds_the_fault_for_the_crashed_process_and_keeps_only_safe_fields() {
        let cause = parse(FAULT, "mylfr-desktop.exe", 0x5ea8).unwrap();
        assert_eq!(
            cause,
            CrashCause::Fault {
                module: "ntdll.dll".to_owned(),
                module_version: "10.0.26100.4652".to_owned(),
                exception_code: 0xC000_0374,
                offset: "0x104c7c".to_owned(),
            }
        );
    }

    #[test]
    fn ignores_other_processes_and_other_programs() {
        assert_eq!(parse(FAULT, "mylfr-desktop.exe", 0x1234), None);
        assert_eq!(parse(FAULT, "WINWORD.EXE", 0x5ea8), None);
    }

    #[test]
    fn finds_a_hang_among_several_entries() {
        let xml = format!("{FAULT}\r\n{HANG}\r\n");
        assert_eq!(
            parse(&xml, "MYLFR-DESKTOP.EXE", 0x4488),
            Some(CrashCause::Hang)
        );
    }

    #[test]
    fn reads_entries_whose_fields_are_not_named() {
        let cause = parse(UNNAMED_FAULT, "mylfr-desktop.exe", 0x1f40).unwrap();
        assert_eq!(
            cause,
            CrashCause::Fault {
                module: "WebView2Loader.dll".to_owned(),
                module_version: "1.0.2903.40".to_owned(),
                exception_code: 0xC000_0005,
                offset: "0xa1b2c".to_owned(),
            }
        );
    }

    #[test]
    fn a_module_given_as_a_path_keeps_only_its_file_name() {
        let xml = FAULT.replace(
            "<Data Name='ModuleName'>ntdll.dll</Data>",
            "<Data Name='ModuleName'>C:\\Users\\Sam\\evil.dll</Data>",
        );
        let Some(CrashCause::Fault { module, .. }) = parse(&xml, "mylfr-desktop.exe", 0x5ea8)
        else {
            panic!("expected a fault");
        };
        assert_eq!(module, "evil.dll");
    }

    #[test]
    fn empty_or_unrelated_output_finds_nothing() {
        assert_eq!(parse("", "mylfr-desktop.exe", 1), None);
        assert_eq!(
            parse("<Event ><EventID>4624</EventID></Event>", "x", 1),
            None
        );
    }
}
