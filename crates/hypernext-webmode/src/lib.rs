//! # hypernext-webmode
//!
//! The raw-mode webview layer of Hypernext (Phase 3, p3-t4).
//!
//! This crate owns the only webview in the app (invariant #10): a per-raw-mode-
//! tab [`RawWebView`] that embeds the platform's native engine — [WebKitGTK 6.0]
//! on Linux, [WKWebView] on macOS, [WebView2] on Windows — and the per-tab
//! [`WebviewPolicy`] that gates its capabilities.
//!
//! Platform embedding differs per OS — see the ADR 0002 SPIKE decision
//! (`docs/references/0002-browser-engine-survey.md`) and the module docs of
//! [`raw_widget`]. On macOS, where GTK4 cannot host a foreign `NSView`,
//! raw mode uses a separate native window (Fallback A).
//!
//! [WebKitGTK 6.0]: webkit6
//! [WKWebView]: https://developer.apple.com/documentation/webkit/wkwebview
//! [WebView2]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/

pub mod policy;
pub mod raw_widget;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

pub use policy::WebviewPolicy;
pub use raw_widget::RawWebView;
