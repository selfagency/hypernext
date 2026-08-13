//! Webview policy: the per-tab capability switches for a raw-mode webview.
//!
//! A raw-mode tab embeds a platform webview only because it renders
//! un-sanitized origin content. That freedom is dangerous, so every capability
//! is gated behind an explicit flag. [`WebviewPolicy::default()`] returns the
//! **incognito-safe** defaults: scripts, storage, popups and cross-origin
//! requests are all off; downloads are permitted but always require the user's
//! explicit confirmation (never auto-accepted -- invariant #10's sibling rule).
//!
//! The incognito-safe defaults are the crate's security baseline. A normal
//! (non-incognito) tab enables scripts/storage per phase-doc 3.4 by overriding
//! the relevant fields on the default value.

/// Per-tab capability switches for a raw-mode webview.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebviewPolicy {
    /// Allow the page to run JavaScript. `false` in incognito.
    pub allow_scripts: bool,
    /// Allow cookies / localStorage / persistent storage. `false` in incognito.
    pub allow_storage: bool,
    /// Allow `window.open` / target=_blank new windows. `false` always by default.
    pub allow_popups: bool,
    /// Allow downloads. `true` by default, but a download is never started
    /// without explicit user confirmation (the UI must prompt).
    pub allow_downloads: bool,
    /// Allow cross-origin resource requests (CORS). `false` (strict) by default.
    pub allow_cross_origin: bool,
}

impl WebviewPolicy {
    /// Incognito-safe baseline.
    ///
    /// Scripts, storage, popups and cross-origin are all disabled; downloads
    /// are enabled but gated behind explicit user confirmation at the UI layer.
    pub fn incognito() -> Self {
        Self {
            allow_scripts: false,
            allow_storage: false,
            allow_popups: false,
            allow_downloads: true,
            allow_cross_origin: false,
        }
    }

    /// A permissive policy for a normal (non-incognito) raw-mode tab: scripts
    /// and storage on, everything else at the conservative default.
    pub fn standard() -> Self {
        Self {
            allow_scripts: true,
            allow_storage: true,
            allow_popups: false,
            allow_downloads: true,
            allow_cross_origin: false,
        }
    }
}

impl Default for WebviewPolicy {
    /// The default is the incognito-safe baseline. Callers that want scripts
    /// must opt in explicitly.
    fn default() -> Self {
        Self::incognito()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Default is incognito-safe: scripts/storage/popups/cross-origin all off,
    /// downloads on.
    #[test]
    fn default_is_incognito_safe() {
        let p = WebviewPolicy::default();
        assert!(!p.allow_scripts, "scripts must be off by default");
        assert!(!p.allow_storage, "storage must be off by default");
        assert!(!p.allow_popups, "popups must be off by default");
        assert!(p.allow_downloads, "downloads allowed (user-confirmed)");
        assert!(!p.allow_cross_origin, "cross-origin must be off by default");
    }

    /// `incognito()` matches `default()` exactly (they are the same baseline).
    #[test]
    fn incognito_matches_default() {
        assert_eq!(WebviewPolicy::default(), WebviewPolicy::incognito());
    }

    /// `standard()` enables scripts + storage, nothing else beyond the baseline.
    #[test]
    fn standard_enables_scripts_and_storage_only() {
        let p = WebviewPolicy::standard();
        assert!(p.allow_scripts, "standard enables scripts");
        assert!(p.allow_storage, "standard enables storage");
        assert!(!p.allow_popups, "standard still blocks popups");
        assert!(
            p.allow_downloads,
            "standard allows user-confirmed downloads"
        );
        assert!(!p.allow_cross_origin, "standard keeps CORS strict");
    }

    /// Field overrides are visible (a caller can flip one switch on default).
    #[test]
    fn can_override_single_field() {
        let p = WebviewPolicy {
            allow_scripts: true,
            ..WebviewPolicy::default()
        };
        assert!(p.allow_scripts);
        assert!(!p.allow_storage, "other fields unchanged");
        assert!(!p.allow_popups);
    }

    /// The policy type is Clone-equatable so tabs can compare / cache.
    #[test]
    fn policy_is_clone_and_eq() {
        let a = WebviewPolicy::default();
        let b = a.clone();
        assert_eq!(a, b);
    }
}
