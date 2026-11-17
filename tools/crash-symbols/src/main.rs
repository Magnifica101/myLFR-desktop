//! Turns the stack traces in a myLFR problem report into function names and
//! source lines, using the debug symbols kept from that version's release.
//!
//! Usage: crash-symbols <mylfr_desktop.pdb> <problem-report.json>
//!
//! Frames in myLFR (`mylfr-desktop.exe+0x…`) are looked up in the symbols;
//! frames in Windows or WebView2 modules are printed as they are.

use std::process::ExitCode;

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [symbols, report] = arguments.as_slice() else {
        eprintln!("Usage: crash-symbols <mylfr_desktop.pdb> <problem-report.json>");
        return ExitCode::FAILURE;
    };
    match run(symbols, report) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("crash-symbols: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(symbols: &str, report: &str) -> Result<(), Box<dyn std::error::Error>> {
    let pdb = pdb_addr2line::pdb::PDB::open(std::fs::File::open(symbols)?)?;
    let data = pdb_addr2line::ContextPdbData::try_from_pdb(pdb)?;
    let context = data.make_context()?;
    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(report)?)?;
    let entries = report["recentErrors"]
        .as_array()
        .ok_or("the file is not a myLFR problem report")?;
    let mut found = false;
    for entry in entries {
        let Some(frames) = entry["stackTrace"]
            .as_array()
            .filter(|frames| !frames.is_empty())
        else {
            continue;
        };
        found = true;
        println!(
            "{}  {}  {}",
            entry["at"].as_str().unwrap_or("?"),
            entry["code"].as_str().unwrap_or("?"),
            entry["message"].as_str().unwrap_or("")
        );
        for frame in frames.iter().filter_map(|frame| frame.as_str()) {
            let (location, repeated) = match frame.split_once(" (") {
                Some((location, rest)) => (location, format!(" ({rest}")),
                None => (frame, String::new()),
            };
            let offset = location
                .strip_prefix("mylfr-desktop.exe+0x")
                .and_then(|offset| u32::from_str_radix(offset, 16).ok());
            let Some(offset) = offset else {
                println!("    {frame}");
                continue;
            };
            match context.find_frames(offset)? {
                Some(found) if !found.frames.is_empty() => {
                    // Inlined functions come first, the function containing
                    // them last.
                    for (index, inlined) in found.frames.iter().enumerate() {
                        println!(
                            "    {}{}  {}:{}{}",
                            if index == 0 { "" } else { "  inlined into " },
                            inlined.function.as_deref().unwrap_or("?"),
                            inlined.file.as_deref().unwrap_or("?"),
                            inlined.line.unwrap_or(0),
                            if index == 0 { repeated.as_str() } else { "" }
                        );
                    }
                }
                _ => println!("    {frame}  (not in these symbols)"),
            }
        }
        println!();
    }
    if !found {
        println!("The report has no stack traces.");
    }
    Ok(())
}
