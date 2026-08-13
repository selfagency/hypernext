//! HTTP adapter — the prefix-less `http`/`https` default (Phase 3, p3-t7).
//!
//! This adapter unblocks ordinary web fetches (previously
//! `UnknownScheme` for non-WebFinger addresses). It owns:
//!
//! - **Web-mode resolution**: per-origin `Reader`/`Raw` from
//!   `hypernext_store::webmode::resolve_mode`. `Reader` extracts into a
//!   `PageDoc` with `Vec<Block>`; `Raw` emits a `PageDoc` whose only block is
//!   `Block::Webview { url }` — the raw-render placeholder the UI switches to
//!   the platform webview for (invariant #10: the native shell never executes
//!   web content).
//! - **PGP verify before extract** (invariant #6): delegated to
//!   `hypernext_http::fetch_and_extract`, which verifies the raw bytes before
//!   any extraction (asserted by the `pgp_verify_runs_before_extract_*` tests).
//! - **Raw-mode adblock resource interception** (exit-criterion-3 raw leg):
//!   [`HttpAdapter::decide_policy`] checks resource requests against the
//!   bundled `AdblockEngine`; a matched tracker is rejected. The raw webview
//!   (p3-t6) calls this from its `decide_policy` resource interception.

use async_trait::async_trait;
use hypernext_core::{Block, HypernextError, PageDoc};
use reqwest::Client;
use url::Url;

use crate::dispatcher::{Capabilities, FetchContext, Protocol};

use hypernext_http::adblock::AdblockEngine;
use hypernext_http::policy::FetchPolicy as HttpFetchPolicy;

/// Re-export of the raw-mode resource type so the webview's interception code
/// (and tests) need not reach into `hypernext_http`.
pub use hypernext_http::adblock::RequestType;

/// The `http`/`https` adapter. Stateless per fetch; holds the policy-bound
/// client and its fetch policy. The raw-mode adblock engine is deliberately
/// kept **out** of this struct (it is `!Send`/`!Sync` — see [`decide_policy`])
/// so the adapter stays a `Send + Sync` `Protocol` object (async-trait).
pub struct HttpAdapter {
    /// Policy-bound reqwest client (SSRF redirect policy built in).
    client: Client,
    /// Fetch policy (size/time/SSRF/scheme) used for extraction.
    policy: HttpFetchPolicy,
    /// The scheme route this instance registers under (`http` or `https`).
    /// The same logic serves both; two instances (one per scheme) are registered
    /// in the default dispatcher because [`Protocol::scheme`] is a single key.
    scheme: &'static str,
}

impl Default for HttpAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpAdapter {
    pub fn new() -> Self {
        Self::with_policy(HttpFetchPolicy::default())
    }

    /// Build an adapter with an explicit fetch policy for the `https` scheme
    /// (the default). The client is built from `policy` so the SSRF redirect
    /// policy is baked in at the `Client` level.
    pub fn with_policy(policy: HttpFetchPolicy) -> Self {
        Self::with_scheme(policy, "https")
    }

    /// Build an adapter serving a specific scheme (`http` or `https`). Both use
    /// identical fetch logic; this only picks the dispatcher routing key.
    pub fn with_scheme(policy: HttpFetchPolicy, scheme: &'static str) -> Self {
        let client = hypernext_http::build_client(&policy);
        Self {
            client,
            policy,
            scheme,
        }
    }

    /// Raw-mode resource interception decision for a webview `decide_policy`
    /// callback (exit-criterion-3 raw leg).
    ///
    /// Adblock never runs in incognito (invariant #9: adblock must not run in
    /// incognito; enforced here at the adapter boundary, not in the engine). When
    /// `incognito`, every resource request is allowed (`Allow`). Otherwise a
    /// request matching the bundled lists is rejected (`Reject`).
    ///
    /// `source_origin` is the page URL the request originates from; `resource_type`
    /// is the requested resource type. The top-level document navigation
    /// (`RequestType::Document`) is always allowed from here — blocking is for
    /// subresources.
    ///
    /// A [`thread_local`] engine is used because Brave's `adblock::Engine` is
    /// `!Send` (interior `Rc`), so it cannot live in a `Send + Sync` struct or
    /// be shared across threads. Each thread lazily builds (or reuses) its own
    /// bundled engine; the webview's interception callback runs on the UI thread.
    pub fn decide_policy(
        &self,
        resource: &Url,
        source_origin: &Url,
        resource_type: RequestType,
        incognito: bool,
    ) -> ResourceDecision {
        if incognito {
            return ResourceDecision::Allow;
        }
        with_engine(|engine| {
            if engine.should_block(resource, source_origin, resource_type) {
                ResourceDecision::Reject
            } else {
                ResourceDecision::Allow
            }
        })
    }

    /// Convert the dispatcher-level policy into the `hypernext-http` policy, so
    /// SSRF / size / redirect settings set at the `FetchContext` flow through to
    /// the extraction path. Incognito is handled by webmode resolution, not here.
    fn http_policy(&self, ctx: &FetchContext) -> HttpFetchPolicy {
        // ctx.policy is the protocol-level FetchPolicy; map its constraints onto
        // the http-crate policy. Defaults cover anything ctx does not set.
        HttpFetchPolicy {
            max_redirects: ctx.policy.max_redirects as usize,
            max_response_size: ctx.policy.max_response_size as u64,
            timeout: ctx.policy.timeout,
            block_private_network: ctx.policy.block_private_network,
            ..self.policy.clone()
        }
    }
}

/// Decision from raw-mode resource interception.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceDecision {
    /// Allow the resource request through.
    Allow,
    /// Reject the resource request (matched tracker).
    Reject,
}

// A per-thread, lazily-initialized bundled adblock engine.
//
// Brave's `adblock::Engine` contains `Rc` (interior `RefCell`) and is
// `!Send`/`!Sync`, so it cannot be stored in the `Send + Sync` `HttpAdapter`
// nor shared across threads. `thread_local!` gives each thread its own engine,
// built on first use (the bundled EasyList + EasyPrivacy).
thread_local! {
    static ADBLOCK: std::cell::RefCell<AdblockEngine> =
        std::cell::RefCell::new(AdblockEngine::new());
}

/// Run `f` with the calling thread's adblock engine.
fn with_engine<T>(f: impl FnOnce(&AdblockEngine) -> T) -> T {
    ADBLOCK.with(|cell| f(&cell.borrow()))
}

#[async_trait]
impl Protocol for HttpAdapter {
    fn scheme(&self) -> &'static str {
        // Instance scheme (`http` or `https`); the default dispatcher registers
        // one instance per scheme. WebFinger owns `/.well-known/webfinger` on
        // https and wins there by longest-prefix; this adapter is the prefix-less
        // default for both schemes.
        self.scheme
    }

    fn path_prefix(&self) -> Option<&'static str> {
        // Prefix-less: this adapter is the https/http default. WebFinger owns
        // the `/.well-known/webfinger` prefix and wins there (longest-prefix).
        None
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Read the per-origin web mode from the store BEFORE any await; the store
        // is a !Sync rusqlite::Connection behind a Mutex, so we lock, read, drop.
        let mode = {
            let store = ctx.store.lock().expect("store mutex not poisoned");
            hypernext_store::webmode::resolve_mode(url, &store, ctx.incognito)
        };

        match mode {
            hypernext_store::webmode::WebMode::Raw => {
                // Raw rendering placeholder: the UI switches this tab to the
                // platform webview. No HTML extraction here — invariant #10.
                Ok(raw_doc(url, url))
            }
            hypernext_store::webmode::WebMode::Reader => {
                let policy = self.http_policy(ctx);
                // fetch_and_extract verifies PGP on the raw bytes BEFORE
                // extraction (invariant #6). On PGP failure it returns
                // hypernext_http::Error::PgpInvalid -> mapped to Pgp below.
                let doc = hypernext_http::fetch_and_extract(url, &self.client, &policy)
                    .await
                    .map_err(http_err_to_hypernext)?;
                Ok(doc)
            }
        }
    }
}

/// Build a `PageDoc` for raw mode: the raw-render placeholder block that tells
/// the UI to show the platform webview for `url` (no extraction; invariant #10).
fn raw_doc(original: &Url, final_url: &Url) -> PageDoc {
    let debug = hypernext_core::DebugInfo {
        request: hypernext_core::HttpRequestDebug {
            method: "GET".to_string(),
            url: original.clone(),
            headers: std::collections::HashMap::new(),
        },
        response: Default::default(),
        timing: hypernext_core::TimingDebug {
            total_ms: Some(0),
            ..Default::default()
        },
        redirects: Vec::new(),
        parser_decisions: vec!["http::raw - raw webview placeholder (p3-t7)".to_string()],
        tls: None,
    };
    PageDoc {
        url: original.clone(),
        final_url: final_url.clone(),
        title: None,
        metadata: Default::default(),
        blocks: vec![Block::Webview {
            url: original.clone(),
        }],
        signature: None,
        debug,
        from_cache: false,
    }
}

/// Map a `hypernext_http` error onto the top-level `HypernextError`, preserving
/// the category (PGP error not swallowed, etc.).
fn http_err_to_hypernext(e: hypernext_http::Error) -> HypernextError {
    match e {
        hypernext_http::Error::PgpInvalid => HypernextError::Pgp("signature invalid".to_string()),
        hypernext_http::Error::SsrfBlocked { url, .. } => {
            HypernextError::SsrfBlocked(format!("{url}"))
        }
        hypernext_http::Error::SizeLimitExceeded { limit } => {
            HypernextError::SizeLimitExceeded(limit as usize)
        }
        hypernext_http::Error::RedirectLimit { .. }
        | hypernext_http::Error::RedirectRefused { .. } => HypernextError::TooManyRedirects,
        hypernext_http::Error::Dns { host, .. } => {
            HypernextError::Network(format!("dns lookup {host}"))
        }
        other => HypernextError::Network(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn decide_policy_rejects_matched_tracker() {
        let adapter = HttpAdapter::new();
        let decision = adapter.decide_policy(
            &url("https://ads.doubleclick.net/ad?id=1"),
            &url("https://example.com/page"),
            RequestType::Image,
            false,
        );
        assert_eq!(decision, ResourceDecision::Reject);
    }

    #[test]
    fn decide_policy_allows_clean_resource() {
        let adapter = HttpAdapter::new();
        let decision = adapter.decide_policy(
            &url("https://cdn.example.com/app.js"),
            &url("https://example.com/page"),
            RequestType::Script,
            false,
        );
        assert_eq!(decision, ResourceDecision::Allow);
    }

    #[test]
    fn decide_policy_never_blocks_in_incognito() {
        let adapter = HttpAdapter::new();
        // Even a known tracker is allowed in incognito (invariant #9).
        let decision = adapter.decide_policy(
            &url("https://ads.doubleclick.net/ad?id=1"),
            &url("https://example.com/page"),
            RequestType::Image,
            true,
        );
        assert_eq!(decision, ResourceDecision::Allow);
    }
}
