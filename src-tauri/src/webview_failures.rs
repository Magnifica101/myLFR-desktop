//! Records WebView2 process failures on Windows.
//!
//! The screens run in WebView2 processes separate from myLFR's own. When one of
//! them crashes, runs out of memory, or stops responding, myLFR keeps running
//! and WebView2 reports the failure here, so it can be written to the
//! diagnostics log. Only the kind of process, the reason, and the exit code are
//! kept; WebView2's process description and module path are not.

use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::ProcessFailedEventHandler;
use windows_core::Interface;

/// Watch the window's WebView2 for process failures. A crashed page process
/// leaves the window blank, so the page is reloaded once the failure is
/// recorded.
pub fn watch(controller: &ICoreWebView2Controller) {
    // SAFETY: called on the window's thread from `with_webview`, with the live
    // controller; the handler only reads the event arguments it is given.
    let _ = unsafe { register(controller) };
}

unsafe fn register(controller: &ICoreWebView2Controller) -> windows_core::Result<()> {
    let handler = ProcessFailedEventHandler::create(Box::new(|webview, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
        unsafe { args.ProcessFailedKind(&mut kind)? };
        let (reason, exit_code) = match args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
            Ok(args) => {
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
                let mut exit_code = 0;
                let reason = unsafe { args.Reason(&mut reason) }
                    .ok()
                    .map(|()| reason_name(reason));
                let exit_code = unsafe { args.ExitCode(&mut exit_code) }
                    .ok()
                    .map(|()| exit_code);
                (reason, exit_code)
            }
            Err(_) => (None, None),
        };
        crate::diagnostics::record_webview_failure(process_name(kind), reason, exit_code);
        if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
            && let Some(webview) = webview
        {
            unsafe { webview.Reload()? };
        }
        Ok(())
    }));
    let mut token = 0;
    unsafe {
        controller
            .CoreWebView2()?
            .add_ProcessFailed(&handler, &mut token)
    }
}

fn process_name(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> &'static str {
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => "browser",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "page",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => "unresponsive page",
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => "frame",
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "GPU",
        COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED => "utility",
        COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED => "sandbox helper",
        COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_PLUGIN_PROCESS_EXITED => "plugin",
        COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_BROKER_PROCESS_EXITED => "plugin broker",
        _ => "unknown",
    }
}

fn reason_name(reason: COREWEBVIEW2_PROCESS_FAILED_REASON) -> &'static str {
    match reason {
        COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED => "crashed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY => "out of memory",
        COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE => "unresponsive",
        COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED => "terminated",
        COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED => "launch failed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_PROFILE_DELETED => "profile deleted",
        _ => "unexpected",
    }
}
