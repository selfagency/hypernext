//! Linux backend for [`RawWebView`] — DEFERRED.
//!
//! WebKitGTK 6.0 is the correct GTK4-era engine, but its Rust binding
//! `webkit6` 0.6 requires gtk4 **0.11** (`gtk = ^0.11`), while Hypernext pins
//! gtk4 **0.9**. Only one `gtk4-sys` may link `gtk-4`, so `webkit6` cannot be
//! added to this graph without upgrading the whole workspace to gtk4 0.11.
//! See the ADR 0002 SPIKE section and the phase-doc 3.4 correction.
//!
//! Until that upgrade lands (a maintainer-owned, cross-cutting change), this
//! module provides a GTK4-only placeholder so `RawWebView` still yields a
//! [`gtk4::Widget`] on Linux. The `TODO(gtk4-0.11)` marks the seam where the
//! `webkit6::WebView` embeds directly as the widget.

use gtk4::prelude::*;
use url::Url;

use super::policy::WebviewPolicy;

/// Linux raw-mode view. Placeholder until the workspace upgrades to gtk4 0.11
/// (see module docs); then `self.webview: webkit6::WebView` and
/// `widget()` returns `webview.upcast::<gtk4::Widget>()`.
pub struct RawWebViewLinux {
    widget: gtk4::Widget,
}

impl RawWebViewLinux {
    /// Create the placeholder widget with `policy`.
    pub fn new(_policy: WebviewPolicy) -> Self {
        let placeholder = gtk4::DrawingArea::builder()
            .hexpand(true)
            .vexpand(true)
            .build();
        // TODO(gtk4-0.11): construct `webkit6::WebView::builder()...build()` and
        // store it; the WebKitGTK WebView is itself a gtk4::Widget, so in-tab
        // embedding works natively on Linux (no separate window needed).
        Self {
            widget: placeholder.upcast::<gtk4::Widget>(),
        }
    }

    /// The GTK widget to place in the tab.
    pub fn widget(&self) -> gtk4::Widget {
        self.widget.clone()
    }

    /// Navigate to `url` (no-op until the webkit6 backend is wired).
    pub fn load_url(&self, _url: &Url) {
        // TODO(gtk4-0.11): self.webview.load_uri(url.as_str()).
    }

    /// Apply `policy` (no-op until the webkit6 backend is wired).
    pub fn set_policy(&mut self, _policy: &WebviewPolicy) {
        // TODO(gtk4-0.11): WebKitSettings enable-javascript / popups toggles.
    }
}
