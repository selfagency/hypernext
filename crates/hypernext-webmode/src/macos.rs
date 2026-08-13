//! macOS backend for [`RawWebView`] (Fallback A — separate native window).
//!
//! GTK4 removed `GtkSocket`/`GtkPlug` (GTK3, X11-only) and exposes no
//! per-widget slot into which a foreign `NSView` can be embedded — the whole
//! GTK widget tree renders through a single `GdkMacosView`. There is therefore
//! no clean way to embed a `WKWebView` *inside* a GTK4 tab on macOS (see the
//! SPIKE section of `docs/references/0002-browser-engine-survey.md`).
//!
//! The ADR decision is **Fallback A**: the raw-mode view owns a *separate
//! native `NSWindow`* hosting the `WKWebView`. The tab still carries a
//! [`gtk::Widget`] (`RawWebView::widget()`) so the shell layout is unchanged;
//! that placeholder is an empty `gtk::DrawingArea`. The companion window is
//! positioned alongside the tab by the caller (Phase 4).
//!
//! # CI note
//!
//! macOS webview code cannot run in the CI test job (ubuntu/xvfb; the macos
//! job is build-only). This backend is validated manually on a macOS host via
//! the checklist in ADR 0002. It compiles cleanly under `#[cfg(target_os =
//! "macos")]` but its behaviour is not exercised by CI.

use gtk4::prelude::*;
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly, msg_send};
use objc2_app_kit::{NSApplication, NSAutoresizingMaskOptions, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use url::Url;

use super::policy::WebviewPolicy;

/// A live `WKWebView` hosted in a separate native window (Fallback A).
pub struct RawWebViewMacos {
    /// Placeholder widget the GTK tab shows (empty drawing area).
    widget: gtk4::Widget,
    /// The native window hosting the WKWebView.
    ///
    /// Kept alive for the webview's lifetime (dropping the `Retained` would
    /// tear down the window while the webview may still draw into it). Dead-code
    /// is expected until Phase 4 positions/uses it.
    #[allow(dead_code)]
    window: Retained<NSWindow>,
    /// The webview itself.
    webview: Retained<WKWebView>,
    /// Current policy.
    policy: WebviewPolicy,
}

unsafe impl Send for RawWebViewMacos {}
unsafe impl Sync for RawWebViewMacos {}

impl RawWebViewMacos {
    /// Build a new WKWebView in a separate window with `policy`.
    ///
    /// Must be called on the main thread (GTK main thread).
    pub fn new(policy: WebviewPolicy) -> Self {
        let mtm = MainThreadMarker::new().expect("RawWebViewMacos::new must run on main thread");

        // A running NSApplication is needed for the host window to appear.
        let _app = NSApplication::sharedApplication(mtm);

        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(900.0, 600.0));
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
        };

        let window = create_host_window(&webview, mtm);

        let placeholder = gtk4::DrawingArea::builder()
            .hexpand(true)
            .vexpand(true)
            .build();
        let this = Self {
            widget: placeholder.upcast::<gtk4::Widget>(),
            window,
            webview,
            policy,
        };
        this.apply_policy(mtm);
        this
    }

    /// The widget the GTK tab hosts.
    pub fn widget(&self) -> gtk4::Widget {
        self.widget.clone()
    }

    /// The native host window (Phase 4 positions it alongside the tab).
    #[allow(dead_code)]
    pub fn native_window(&self) -> &NSWindow {
        &self.window
    }

    /// Navigate the webview to `url`.
    pub fn load_url(&self, url: &Url) {
        let nsurl =
            NSURL::URLWithString(&NSString::from_str(url.as_str())).expect("parse NSURL from url");
        let request = NSURLRequest::requestWithURL(&nsurl);
        let request: &NSURLRequest = &request;
        unsafe {
            let _: () = msg_send![&self.webview, loadRequest: request];
        }
    }

    /// Re-apply the policy's mutable switches.
    pub fn set_policy(&mut self, policy: &WebviewPolicy) {
        self.policy = policy.clone();
        let mtm = MainThreadMarker::new().expect("set_policy on main thread");
        self.apply_policy(mtm);
    }

    fn apply_policy(&self, _mtm: MainThreadMarker) {
        let prefs = unsafe { self.webview.configuration().preferences() };
        unsafe {
            let _: () = msg_send![&prefs, setJavaScriptEnabled: self.policy.allow_scripts];
        }
        // Popups: no UIDelegate installed -> createWebViewWithConfiguration returns
        // nil -> window.open / target=_blank is blocked.
        // Downloads: WKDownload is started via the navigation delegate's policy
        // handler; the confirmation path lands in Phase 4 (p3-t7 wires adblock).
        // Cross-origin: enforced in the navigation delegate (Phase 4 wiring).
    }
}

/// Create the host NSWindow for `webview` (Fallback A) and return it.
fn create_host_window(webview: &WKWebView, mtm: MainThreadMarker) -> Retained<NSWindow> {
    let window = unsafe { NSWindow::new(mtm) };
    let style = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Resizable
        | NSWindowStyleMask::Miniaturizable;
    window.setStyleMask(style);

    // Place the webview as the window's content view, sized to the window.
    window.setContentSize(NSSize::new(900.0, 600.0));
    window.setContentView(Some(webview));
    unsafe {
        let _: () = msg_send![webview, setAutoresizingMask: NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable];
    }
    window
}
