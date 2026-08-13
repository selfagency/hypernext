//! Windows backend for [`RawWebView`] — WebView2 (Edge Chromium) in a child HWND.
//!
//! WebView2 is hosted by parenting a child window into the GTK window. Full
//! HWND plumbing (Win32 `CreateWindowExW`/`SetParent`) and the WebView2 COM
//! bootstrap are not exercised in this repository's CI (macOS/Linux runners);
//! this module is kept compile-clean and validated on a Windows host.
//!
//! # Status
//!
//! Windows is a post-1.0 target (macOS 14+ is the 1.0 target). This module
//! defines the backend contract (`RawWebViewWindows::new/provider`) and
//! exposes the same widget surface, but the real COM bootstrap is deferred
//! until a Windows build host exists.

use gtk4::prelude::*;
use url::Url;

use super::policy::WebviewPolicy;

/// A WebView2 host (compile-clean stub; real HWND/COM bootstrap deferred).
pub struct RawWebViewWindows {
    widget: gtk4::Widget,
}

impl RawWebViewWindows {
    /// Create the WebView2-aware placeholder widget.
    pub fn new(_policy: WebviewPolicy) -> Self {
        // The tab gets a placeholder widget; WebView2 is parented into the
        // native window on a Windows host (see module docs).
        let placeholder = gtk4::DrawingArea::builder()
            .hexpand(true)
            .vexpand(true)
            .build();
        Self {
            widget: placeholder.upcast::<gtk4::Widget>(),
        }
    }

    /// The GTK widget to place in the tab.
    pub fn widget(&self) -> gtk4::Widget {
        self.widget.clone()
    }

    /// Navigate to `url` (no-op until the COM bootstrap lands).
    pub fn load_url(&self, _url: &Url) {
        // TODO(1.1+): WebView2_64.dll bootstrap + ICoreWebView2::Navigate.
    }

    /// Apply `policy` (no-op until the COM bootstrap lands).
    pub fn set_policy(&mut self, _policy: &WebviewPolicy) {
        // TODO(1.1+): ICoreWebView2Settings (IsScriptEnabled, AreDefaultScriptDialogsEnabled,
        // IsWebMessageEnabled, AreDefaultContextMenusEnabled, IsStatusBarEnabled).
    }
}
