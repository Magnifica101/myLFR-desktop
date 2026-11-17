//! Captures what myLFR was doing when it crashed, on Windows.
//!
//! Two things are written to this session's output file (see `session`), which
//! is read at the next launch:
//!
//! - The app's error output. A Windows app has nowhere to print it, so the
//!   one line Rust writes before stopping itself, such as "memory allocation
//!   of … bytes failed" or "has overflowed its stack", would otherwise be lost.
//! - A stack trace when a native crash reaches Windows' last-chance handler:
//!   the exception code and each frame as a module file name and offset. No
//!   memory contents are written, so no business records can be. A frame in
//!   myLFR itself is turned into a function name and line with the debug
//!   symbols kept for each release.
//!
//! The handler runs in a crashing process, so it does not allocate: it formats
//! into a fixed buffer and writes with one system call per line.

use std::ffi::c_void;
use std::fs::File;
use std::os::windows::io::AsRawHandle;
use std::sync::atomic::{AtomicPtr, Ordering};

const MAX_FRAMES: usize = 32;
const STD_ERROR_HANDLE: u32 = -12_i32 as u32;
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
const GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT: u32 = 0x2;
const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: u32 = 0x4;

#[repr(C)]
struct ExceptionRecord {
    code: u32,
    flags: u32,
    record: *mut ExceptionRecord,
    address: *mut c_void,
}

#[repr(C)]
struct ExceptionPointers {
    record: *const ExceptionRecord,
    context: *const c_void,
}

type Filter = unsafe extern "system" fn(*const ExceptionPointers) -> i32;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetStdHandle(id: u32) -> *mut c_void;
    fn SetStdHandle(id: u32, handle: *mut c_void) -> i32;
    fn SetUnhandledExceptionFilter(filter: Option<Filter>) -> Option<Filter>;
    fn RtlCaptureStackBackTrace(
        skip: u32,
        count: u32,
        frames: *mut *mut c_void,
        hash: *mut u32,
    ) -> u16;
    fn GetModuleHandleExW(flags: u32, address: *const c_void, module: *mut *mut c_void) -> i32;
    fn GetModuleFileNameW(module: *mut c_void, name: *mut u16, size: u32) -> u32;
    fn WriteFile(
        file: *mut c_void,
        buffer: *const u8,
        length: u32,
        written: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
}

/// Where the crash handler writes. Set once and never closed, since the
/// process's error output may point at it until the process ends.
static OUTPUT: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// Send the app's error output to `output` and install the crash handler.
/// Error output that already goes somewhere, such as the development
/// terminal, is left alone unless `capture_error_output` is set. `output` must
/// stay open for the life of the process.
pub fn install(output: &File, capture_error_output: bool) {
    let handle = output.as_raw_handle().cast::<c_void>();
    OUTPUT.store(handle, Ordering::SeqCst);
    // SAFETY: the handle belongs to a file that stays open for the life of the
    // process, and the filter only reads the exception it is given.
    unsafe {
        let current = GetStdHandle(STD_ERROR_HANDLE);
        if capture_error_output || current.is_null() || current as isize == -1 {
            SetStdHandle(STD_ERROR_HANDLE, handle);
        }
        SetUnhandledExceptionFilter(Some(on_crash));
    }
}

/// The current thread's stack as `module+0xoffset` frames, for panics.
pub fn stack_frames() -> Vec<String> {
    let mut frames = [std::ptr::null_mut(); MAX_FRAMES];
    // SAFETY: the buffer holds MAX_FRAMES entries.
    let count = unsafe {
        RtlCaptureStackBackTrace(
            1,
            MAX_FRAMES as u32,
            frames.as_mut_ptr(),
            std::ptr::null_mut(),
        )
    };
    frames[..count as usize]
        .iter()
        .map(|&address| {
            let mut line = Line::new();
            line.frame(address);
            String::from_utf8_lossy(line.as_bytes()).into_owned()
        })
        .collect()
}

unsafe extern "system" fn on_crash(pointers: *const ExceptionPointers) -> i32 {
    let output = OUTPUT.load(Ordering::SeqCst);
    // SAFETY: Windows passes valid exception pointers to the filter.
    let record = unsafe {
        pointers
            .as_ref()
            .and_then(|pointers| pointers.record.as_ref())
    };
    let Some(record) = record.filter(|_| !output.is_null()) else {
        return EXCEPTION_CONTINUE_SEARCH;
    };
    let mut line = Line::new();
    line.push(b"[crash] exception 0x");
    line.hex(record.code as u64, 8);
    line.write(output);

    let mut frames = [std::ptr::null_mut(); MAX_FRAMES * 2];
    // SAFETY: the buffer holds the number of entries requested.
    let count = unsafe {
        RtlCaptureStackBackTrace(
            0,
            frames.len() as u32,
            frames.as_mut_ptr(),
            std::ptr::null_mut(),
        )
    } as usize;
    // The first frames are this handler and Windows' exception dispatch; the
    // crash itself starts at the faulting address.
    let start = frames[..count]
        .iter()
        .position(|&frame| frame == record.address)
        .unwrap_or(0);
    for &frame in frames[start..count].iter().take(MAX_FRAMES) {
        let mut line = Line::new();
        line.push(b"[frame] ");
        line.frame(frame);
        line.write(output);
    }
    // Let Windows Error Reporting record the crash as well.
    EXCEPTION_CONTINUE_SEARCH
}

/// One output line, built without allocating.
struct Line {
    buffer: [u8; 200],
    length: usize,
}

impl Line {
    fn new() -> Self {
        Self {
            buffer: [0; 200],
            length: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if self.length < self.buffer.len() - 1 {
                self.buffer[self.length] = byte;
                self.length += 1;
            }
        }
    }

    fn hex(&mut self, value: u64, min_digits: usize) {
        let mut digits = [0u8; 16];
        let mut count = 0;
        let mut rest = value;
        while count < min_digits || (rest != 0 && count < 16) {
            digits[count] = b"0123456789abcdef"[(rest & 0xF) as usize];
            rest >>= 4;
            count += 1;
        }
        digits[..count].reverse();
        self.push(&digits[..count]);
    }

    /// `module+0xoffset`, or the bare address if no module contains it.
    fn frame(&mut self, address: *mut c_void) {
        let mut module = std::ptr::null_mut();
        let mut name = [0u16; 260];
        // SAFETY: both buffers are the sizes passed; the module handle is not
        // reference-counted, so nothing needs releasing.
        let length = unsafe {
            if GetModuleHandleExW(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                    | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                address,
                &mut module,
            ) == 0
            {
                0
            } else {
                GetModuleFileNameW(module, name.as_mut_ptr(), name.len() as u32) as usize
            }
        };
        if length == 0 {
            self.push(b"0x");
            self.hex(address as u64, 1);
            return;
        }
        // Only the file name: the folder could name the user.
        let name = &name[..length.min(name.len())];
        let file_start = name
            .iter()
            .rposition(|&unit| unit == u16::from(b'\\') || unit == u16::from(b'/'))
            .map_or(0, |index| index + 1);
        for &unit in &name[file_start..] {
            self.push(&[if unit < 0x80 { unit as u8 } else { b'?' }]);
        }
        self.push(b"+0x");
        self.hex(address as u64 - module as u64, 1);
    }

    fn as_bytes(&self) -> &[u8] {
        &self.buffer[..self.length]
    }

    fn write(mut self, output: *mut c_void) {
        // `push` always leaves room for the line ending.
        self.buffer[self.length] = b'\n';
        self.length += 1;
        let mut written = 0;
        // SAFETY: `output` is the session's open output file.
        unsafe {
            WriteFile(
                output,
                self.buffer.as_ptr(),
                self.length as u32,
                &mut written,
                std::ptr::null_mut(),
            )
        };
    }
}
