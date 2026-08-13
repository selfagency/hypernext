//! The raw-mode webview widget — the only webview in Hypernext (invariant #10).
//!
//! `RawWebView` is a thin platform switch: it owns a [`gtk4::Widget`] that the
//! raw-mode tab hosts, and forwards navigation/policy calls to the per-OS
//! native engine.
//!
//! Platform behaviour (see ADR 0002 SPIKE section):
//!
//! - **Linux** (`webkit6`): the `WebView` *is* a `gtk4::Widget`, so it embeds
//!   in-tab natively. This is the CI-testable path.
//! - **macOS** (`objc2-web-kit`): GTK4 has no foreign-NSView embedding slot, so
//!   the SPIKE chose **Fallback A** — the `WKWebView` lives in a *separate*
//!   native window and the tab hosts an empty placeholder widget. Local-only.
//! - **Windows** (`webview2-com`): post-1.0 target; compile-clean placeholder.

use url::Url;

use crate::policy::WebviewPolicy;

#[cfg(target_os = "macos")]
mod macos_backend {
    pub(super) use crate::macos::RawWebViewMacos as RawWebViewImpl;
}

#[cfg(target_os = "linux")]
mod linux_backend {
    pub(super) use crate::linux::RawWebViewLinux as RawWebViewImpl;
}

#[cfg(target_os = "windows")]
mod windows_backend {
    pub(super) use crate::windows::RawWebViewWindows as RawWebViewImpl;
}

// Bring the platform backend into scope under the single name `RawWebViewImpl`.
#[cfg(target_os = "linux")]
use linux_backend::RawWebViewImpl;
#[cfg(target_os = "macos")]
use macos_backend::RawWebViewImpl;
#[cfg(target_os = "windows")]
use windows_backend::RawWebViewImpl;

/// A raw-mode webview: a [`gtk4::Widget`] + the native engine behind it.
pub struct RawWebView {
    inner: RawWebViewImpl,
}

impl RawWebView {
    /// Create a raw-mode webview with `policy` applied.
    ///
    /// Display-required on every platform (needs a GTK main loop / display —
    /// see `docs/references/gtk-testing.md`; on CI Linux run under `xvfb-run`).
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    pub fn new(policy: WebviewPolicy) -> Self {
        Self {
            inner: RawWebViewImpl::new(policy),
        }
    }

    /// The `gtk4::Widget` to place in the raw-mode tab.
    pub fn widget(&self) -> gtk4::Widget {
        self.inner.widget()
    }

    /// Navigate to `url`.
    pub fn load_url(&self, url: &Url) {
        self.inner.load_url(url);
    }

    /// (Re-)apply a webview policy.
    pub fn set_policy(&mut self, policy: &WebviewPolicy) {
        self.inner.set_policy(policy);
    }
}

#[cfg(test)]
mod tests {
    /// `RawWebView::new()` returns a widget (the TDD gate).
    ///
    /// Display-required and, on Linux, run under `xvfb-run` (see
    /// `docs/references/gtk-testing.md`). It is gated to Linux because the
    /// test harness thread is not the GTK main thread: on macOS `gtk4::init()`
    /// asserts main-thread and WKWebView construction needs a running
    /// NSApplication, so the macOS backend is exercised only via the manual
    /// macOS checklist in ADR 0002 (macOS webview is CI-untestable). On Linux
    /// the backend is the CI-testable gtk4 widget, and non-main-thread GTK init
    /// works under xvfb.
    #[cfg(target_os = "linux")]
    #[test]
    fn new_returns_a_widget() {
        use super::*;
        use gtk4::prelude::*;
        assert!(gtk4::init().is_ok() || gtk4::is_initialized());
        let view = RawWebView::new(WebviewPolicy::default());
        let widget = view.widget();
        let _ = widget.width_request();
    }
}
