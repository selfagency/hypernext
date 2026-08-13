//! Linux backend for [`RawWebView`] — WebKitGTK 6.0 via the `webkit6` crate.
//!
//! WebKitGTK 6.0 is the GTK4-era engine. Unlike macOS (where GTK4 cannot host a
//! foreign NSView, so a separate native window is used) the `webkit6::WebView`
//! **is** a `gtk4::Widget`, so it embeds in-tab natively — no separate window
//! needed. This is the CI-testable raw-webview path (runs under xvfb-run).
//!
//! `webkit6` 0.6 requires gtk4 0.11 (see ADR 0002). The workspace now pins
//! gtk4 0.11, so this backend is fully wired. Capabilities from
//! [`WebviewPolicy`] map onto `WebKitSettings` (scripts/storage) and the
//! `create` signal (popups).

use gtk4::prelude::*;
// webkit6's prelude brings in WebViewExt (load_uri, connect_create) and
// SettingsExt (set_enable_*), which are not part of gtk4's prelude.
use url::Url;
use webkit6::prelude::*;

use super::policy::WebviewPolicy;

/// Linux raw-mode view: a live `webkit6::WebView` hosted as a GTK widget.
pub struct RawWebViewLinux {
    webview: webkit6::WebView,
    /// The WebKitSettings the webview was built with; reused by `set_policy`.
    settings: webkit6::Settings,
    /// Current policy (retained so `set_policy` can diff / re-apply; dead
    /// until a future use reads it, matching `RawWebViewMacos`'s convention).
    #[allow(dead_code)]
    policy: WebviewPolicy,
}

impl RawWebViewLinux {
    /// Build a `webkit6::WebView` with `policy` applied.
    pub fn new(policy: WebviewPolicy) -> Self {
        // Start from the policy's capability switches; popups are denied at the
        // `create` signal (below). Scripts/storage follow the policy.
        let settings = webkit6::Settings::new();
        let mut this = Self {
            webview: webkit6::WebView::builder().settings(&settings).build(),
            settings,
            policy: WebviewPolicy::incognito(),
        };
        // The default WebKit `create` action would spawn a new window for
        // target=_blank. Raw-mode denies that unless `allow_popups` is set
        // (it stays false in every shipped policy today; Phase 4 will wire a
        // navigator to host the new webview when enabled).
        this.webview.connect_create(|_view, _action| None);
        this.apply_policy(&policy);
        this.policy = policy;
        this
    }

    /// The GTK widget to place in the tab (the webview itself).
    pub fn widget(&self) -> gtk4::Widget {
        self.webview.clone().upcast::<gtk4::Widget>()
    }

    /// Navigate to `url`.
    pub fn load_url(&self, url: &Url) {
        self.webview.load_uri(url.as_str());
    }

    /// (Re-)apply a webview policy to the WebKit settings.
    pub fn set_policy(&mut self, policy: &WebviewPolicy) {
        self.apply_policy(policy);
        self.policy = policy.clone();
    }

    fn apply_policy(&self, policy: &WebviewPolicy) {
        // Scripts: `enable-javascript` maps directly to `allow_scripts`.
        self.settings.set_enable_javascript(policy.allow_scripts);
        // Storage: WebKitGTK separates local storage from IndexedDB/WebSQL
        // ("HTML5 database"). Binary sites distinguish local storage from
        // database storage; gate both on `allow_storage`. `null` prefix +
        // `false` keeps cross-origin storage isolated (CORS stays strict; the
        // policy has no cross-origin knob mapped to a WebKit setting here).
        self.settings
            .set_enable_html5_local_storage(policy.allow_storage);
        self.settings
            .set_enable_html5_database(policy.allow_storage);
        // Popups are denied unconditionally by the `create` handler wired in
        // `new`; `allow_popups` is reserved for Phase 4 when a navigator can
        // host the new webview. Downloads (user-confirmation gating) and CORS
        // are policy fields enforced at the UI/HTTP layers (invariants), not
        // WebKit settings.
    }
}
