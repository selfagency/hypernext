//! The `Protocol` contract, `Dispatcher`, `FetchContext`, and `FetchPolicy`.
//!
//! This is the interface every protocol adapter implements and the routing
//! hub that hands a URL to the right adapter. UI and storage code never know
//! which protocol is backing a document (Phase 2,
//! `docs/phases/02-smolnet-protocols.md` §3.3).

use async_trait::async_trait;
use hypernext_core::{HypernextError, PageDoc};
use std::collections::HashMap;
use std::time::Duration;
use url::Url;

/// The scheme prepended when `normalize_address` is given a bare host.
///
/// Hypernext defaults to Gemini — the smallest, most capable smolnet
/// protocol — when the user types a bare hostname without a scheme.
pub const DEFAULT_SCHEME: &str = "gemini";

/// Scheme prefixes that are *hints*, not protocols. Stripped by
/// [`Dispatcher::normalize_address`] before parsing so `feed:`/`rss:` lead
/// to the underlying HTTP feed URL rather than an unregistered scheme.
pub const SCHEME_HINTS: &[&str] = &["feed:", "rss:"];

/// Schemes treated as already-absolute URLs by [`Dispatcher::normalize_address`].
/// An unrecognized prefix (e.g. `example.com:1965/`) is a host reference, not
/// a scheme, so it is NOT in this list.
pub const RECOGNIZED_SCHEMES: &[&str] = &[
    "gemini", "https", "http", "gopher", "spartan", "nex", "text", "scroll", "molerat", "scorpion",
    "kepler", "finger", "dict", "file",
];

/// What a protocol can do, used for UI hints and route validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Capabilities {
    pub supports_fetch: bool,
    pub supports_publish: bool,
    pub supports_streaming: bool,
    pub supports_interactive: bool,
    pub needs_tls: bool,
    pub needs_tofu: bool,
}

/// Payload for a publish/upload operation (Titan, Micropub, ...).
#[derive(Debug, Clone)]
pub struct PublishPayload {
    pub mime: String,
    pub content: Vec<u8>,
}

/// Result of a publish/upload operation.
#[derive(Debug, Clone)]
pub struct PublishResult {
    /// Final URL of the published resource, if one exists.
    pub url: Option<Url>,
}

/// Everything a fetch needs to do its job, injected per-call.
///
/// **Deviation from phase doc §3.3:** `hypernext_store::Store` and
/// `hypernext_keychain::Keychain` do not exist yet (Phase 1 delivers
/// `store::db::open` -> `rusqlite::Connection` and keychain *functions*, not
/// structs). `store` is therefore the live `rusqlite::Connection`; the
/// keychain is omitted from the struct until a handle type lands. Adapters
/// needing secrets call the keychain free functions directly.
///
/// `store` is `!Sync`, so it is shared behind a `std::sync::Mutex` to keep
/// `FetchContext: Sync` (and thus `&FetchContext: Send`) — required for
/// async-trait adapter futures. Adapters lock the store only when they touch it.
#[derive(Debug)]
pub struct FetchContext<'a> {
    pub http_client: &'a reqwest::Client,
    pub cancel: tokio_util::sync::CancellationToken,
    pub incognito: bool,
    pub policy: &'a FetchPolicy,
    pub store: &'a std::sync::Mutex<rusqlite::Connection>,
}

/// Tunable limits/defenses applied to every fetch.
#[derive(Debug, Clone)]
pub struct FetchPolicy {
    /// Maximum number of redirect hops to follow before
    /// [`HypernextError::TooManyRedirects`].
    pub max_redirects: u32,
    /// Maximum response body size in bytes before
    /// [`HypernextError::SizeLimitExceeded`].
    pub max_response_size: usize,
    /// Overall request timeout.
    pub timeout: Duration,
    /// When true, block requests to private/loopback networks (SSRF defense,
    /// invariant #8). Tests set this to false to allow localhost.
    pub block_private_network: bool,
}

impl Default for FetchPolicy {
    fn default() -> Self {
        Self {
            max_redirects: 5,
            max_response_size: 10 * 1024 * 1024,
            timeout: Duration::from_secs(30),
            block_private_network: true,
        }
    }
}

/// A resolved address that `FetchPolicy::check_url` has already vetted.
/// Carries the original host so the caller can reconnect without re-DNS.
#[derive(Debug, Clone)]
pub struct VettedTarget {
    /// The hostname (or IP literal) to connect to.
    pub host: String,
    /// The port to connect to.
    pub port: u16,
}

impl FetchPolicy {
    /// SSRF gate (invariant #8). Every outbound connection — HTTP, raw TCP,
    /// UDP — must call this BEFORE dialing the peer.
    ///
    /// Resolves `host` to all of its addresses and, when
    /// `block_private_network` is set, rejects any that fall on a private,
    /// loopback, or link-local network. Returns a [`VettedTarget`] with the
    /// original host string so the caller can dial with the name (keeping the
    /// crate's own DNS/certificate handling intact).
    pub async fn check_url(&self, host: &str, port: u16) -> Result<VettedTarget, HypernextError> {
        if self.block_private_network {
            // `to_socket_addrs` resolves via the system resolver, mirroring
            // what the protocol crates' `TcpStream::connect` will do.
            let addrs = tokio::net::lookup_host((host, port))
                .await
                .map_err(|e| HypernextError::Network(format!("dns lookup {host}: {e}")))?;
            for addr in addrs {
                if is_private_ip(addr.ip()) {
                    return Err(HypernextError::SsrfBlocked(format!(
                        "{host} resolves to private/loopback address {addr}"
                    )));
                }
            }
        }
        Ok(VettedTarget {
            host: host.to_string(),
            port,
        })
    }
}

/// True when `ip` is on a private, loopback, or link-local network. SSRF
/// defense — the `ipnet` check used by HTTP proxies.
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_link_local()
                || v4.is_private()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || is_reserved_v4(v4)
        }
        std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || is_private_v6(v6),
    }
}

/// IPv6 private/ULA + link-local ranges, checked by octets to stay within
/// MSRV 1.83 (the `Ipv6Addr::is_unique_local`/`is_unicast_link_local` methods
/// are stable only since 1.84). ULA is `fc00::/7`; link-local is `fe80::/10`.
fn is_private_v6(v6: std::net::Ipv6Addr) -> bool {
    let seg = v6.segments();
    (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80
}

/// IPv4 ranges that `Ipv4Addr::is_private` misses but must still be blocked
/// as SSRF targets (RFC 1918 + the 100.64/10 CGNAT block + 192.0.0.0/24).
fn is_reserved_v4(v4: std::net::Ipv4Addr) -> bool {
    let octets = v4.octets();
    // 100.64.0.0/10 (CGNAT) — shared address space, never a public peer.
    (octets[0] == 100 && (64..=127).contains(&octets[1]))
        // 192.0.0.0/24 — IETF protocol assignments (e.g. 192.0.2.0/24 TEST-NET-1).
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        // 198.18.0.0/15 — benchmarking ranges.
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
}

/// The contract every protocol adapter implements.
///
/// Async trait methods are `#[async_trait]` because native `async fn` in a
/// trait object is not dyn-compatible (E0782). See
/// `docs/references/0006-smolnet-protocol-crates.md`.
#[async_trait]
pub trait Protocol: Send + Sync {
    /// The URL scheme this adapter owns, e.g. `"gemini"`. Used as the
    /// `Dispatcher` routing key.
    fn scheme(&self) -> &'static str;

    fn capabilities(&self) -> Capabilities;

    /// Fetch `url` and return a normalized `PageDoc`.
    ///
    /// Implementations MUST:
    /// - honor `ctx.cancel` (return `HypernextError::Cancelled` when it fires)
    /// - apply `ctx.policy` (size, time, SSRF) via `ctx.http_client`
    /// - set `PageDoc::final_url` to the final URL after any redirects so the
    ///   `Dispatcher` can follow the chain
    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError>;

    /// Optional publish/upload capability. Default is unsupported.
    async fn publish(
        &self,
        _url: &Url,
        _payload: &PublishPayload,
        _ctx: &FetchContext,
    ) -> Result<PublishResult, HypernextError> {
        Err(HypernextError::Unsupported)
    }
}

/// Routes URLs to the registered adapter for their scheme.
pub struct Dispatcher {
    protocols: HashMap<&'static str, Box<dyn Protocol>>,
}

impl Default for Dispatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Dispatcher {
    pub fn new() -> Self {
        Self {
            protocols: HashMap::new(),
        }
    }

    /// Register an adapter under its [`Protocol::scheme`]. Re-registering an
    /// existing scheme replaces the previous adapter.
    pub fn register(&mut self, protocol: Box<dyn Protocol>) {
        self.protocols.insert(protocol.scheme(), protocol);
    }

    /// Dispatch a fetch to the adapter for `url`'s scheme, following redirect
    /// chains up to `ctx.policy.max_redirects`.
    ///
    /// A redirect is detected when an adapter returns a `PageDoc` whose
    /// `final_url` differs from the requested URL; the dispatcher then
    /// re-dispatches to the `final_url`. Exceeding the limit returns
    /// [`HypernextError::TooManyRedirects`].
    pub async fn fetch(
        &self,
        url: &Url,
        ctx: &FetchContext<'_>,
    ) -> Result<PageDoc, HypernextError> {
        let max = ctx.policy.max_redirects;
        let mut current = url.clone();
        for _ in 0..=max {
            let doc = self.fetch_once(&current, ctx).await?;
            if doc.final_url != current {
                current = doc.final_url.clone();
            } else {
                return Ok(doc);
            }
        }
        Err(HypernextError::TooManyRedirects)
    }

    async fn fetch_once(
        &self,
        url: &Url,
        ctx: &FetchContext<'_>,
    ) -> Result<PageDoc, HypernextError> {
        let protocol = self
            .protocols
            .get(url.scheme())
            .ok_or_else(|| HypernextError::UnknownScheme(url.scheme().to_string()))?;
        protocol.fetch(url, ctx).await
    }

    /// Turn free-form user input into a concrete `Url`.
    ///
    /// Rules:
    /// - A leading `feed:`/`rss:` hint is stripped — feeds are HTTP URLs
    ///   (`SCHEME_HINTS`).
    /// - If the remainder parses as an absolute URL with a *recognized*
    ///   scheme (`RECOGNIZED_SCHEMES`), it is returned unchanged.
    /// - Otherwise the input is treated as a host reference: `host`,
    ///   `host:port`, or `host:port/path` are all interpreted as a URL and
    ///   get the default `gemini://` scheme prepended. A `host:port` is
    ///   *never* split as a bare host + port; it is always a URL. A host with
    ///   no path gets a trailing `/`.
    pub fn normalize_address(&self, input: &str) -> Result<Url, HypernextError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(HypernextError::InvalidUrl("empty address".to_string()));
        }

        // Strip hint prefixes (feed:/rss:) that are not real schemes.
        let mut candidate = trimmed.to_string();
        for hint in SCHEME_HINTS {
            if let Some(rest) = candidate.strip_prefix(hint) {
                candidate = rest.to_string();
                break;
            }
        }

        // A recognized scheme means it is already an absolute URL.
        if let Ok(url) = Url::parse(&candidate) {
            if RECOGNIZED_SCHEMES.contains(&url.scheme()) {
                return Ok(url);
            }
        }

        // Otherwise treat it as a host reference with the default scheme.
        let with_scheme = format!("{DEFAULT_SCHEME}://{candidate}");
        let mut url =
            Url::parse(&with_scheme).map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
        // Normalize a bare host to a root path (`gemini://host` -> `gemini://host/`).
        if url.path().is_empty() && url.host().is_some() {
            url.set_path("/");
        }
        Ok(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn ctx(policy: &FetchPolicy) -> FetchContext<'_> {
        // reqwest Client::new with default-features=false still constructs;
        // only TLS-capable https requests would fail, which tests avoid.
        // Leaked so the context can outlive the helper (test-only).
        let client = Box::leak(Box::new(reqwest::Client::new()));
        let store = Box::leak(Box::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        )));
        FetchContext {
            http_client: client,
            cancel: tokio_util::sync::CancellationToken::new(),
            incognito: false,
            policy,
            store,
        }
    }

    /// Adapter that always returns a doc with the given final_url, used to
    /// drive the dispatcher's redirect logic without real network I/O.
    struct StubProtocol {
        scheme: &'static str,
        final_url: Url,
    }

    #[async_trait]
    impl Protocol for StubProtocol {
        fn scheme(&self) -> &'static str {
            self.scheme
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities::default()
        }
        async fn fetch(&self, _url: &Url, _ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
            Ok(PageDoc {
                url: _url.clone(),
                final_url: self.final_url.clone(),
                title: None,
                metadata: Default::default(),
                blocks: vec![],
                signature: None,
                debug: hypernext_core::DebugInfo {
                    request: hypernext_core::HttpRequestDebug {
                        method: "GET".to_string(),
                        url: _url.clone(),
                        headers: std::collections::HashMap::new(),
                    },
                    response: Default::default(),
                    timing: Default::default(),
                    redirects: vec![],
                    parser_decisions: vec![],
                    tls: None,
                },
                from_cache: false,
            })
        }
    }

    #[test]
    fn normalize_bare_host_gets_default_scheme() {
        let d = Dispatcher::new();
        assert_eq!(
            d.normalize_address("geminiprotocol.net").unwrap(),
            url("gemini://geminiprotocol.net/")
        );
    }

    #[test]
    fn normalize_absolute_url_is_unchanged() {
        let d = Dispatcher::new();
        assert_eq!(
            d.normalize_address("https://example.com").unwrap(),
            url("https://example.com/")
        );
    }

    #[test]
    fn normalize_strips_feed_hint() {
        let d = Dispatcher::new();
        assert_eq!(
            d.normalize_address("feed:https://blog.example.com/rss")
                .unwrap(),
            url("https://blog.example.com/rss")
        );
    }

    #[test]
    fn normalize_strips_rss_hint() {
        let d = Dispatcher::new();
        assert_eq!(
            d.normalize_address("rss:https://blog.example.com/feed.xml")
                .unwrap(),
            url("https://blog.example.com/feed.xml")
        );
    }

    #[test]
    fn normalize_host_port_is_a_url_not_bare_pair() {
        // "example.com:1965/" is a URL (host example.com, port 1965), not a
        // bare host:port — it carries a path, so the default scheme applies.
        let d = Dispatcher::new();
        assert_eq!(
            d.normalize_address("example.com:1965/").unwrap(),
            url("gemini://example.com:1965/")
        );
    }

    #[test]
    fn normalize_empty_input_is_invalid() {
        let d = Dispatcher::new();
        assert!(matches!(
            d.normalize_address("   "),
            Err(HypernextError::InvalidUrl(_))
        ));
    }

    #[tokio::test]
    async fn unknown_scheme_returns_unknown_scheme() {
        let d = Dispatcher::new();
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let err = d
            .fetch(&url("gemini://example.com/"), &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "UNKNOWN_SCHEME");
    }

    #[tokio::test]
    async fn follows_single_redirect() {
        let mut d = Dispatcher::new();
        // gemini -> http, both registered.
        d.register(Box::new(StubProtocol {
            scheme: "gemini",
            final_url: url("https://example.com/"),
        }));
        d.register(Box::new(StubProtocol {
            scheme: "https",
            final_url: url("https://example.com/"),
        }));
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let doc = d.fetch(&url("gemini://example.com/"), &c).await.unwrap();
        assert_eq!(doc.final_url, url("https://example.com/"));
    }

    #[tokio::test]
    async fn too_many_redirects_returns_error() {
        let mut d = Dispatcher::new();
        // Redirect loop: gemini -> https -> gemini -> ... never settles.
        d.register(Box::new(StubProtocol {
            scheme: "gemini",
            final_url: url("https://example.com/"),
        }));
        d.register(Box::new(StubProtocol {
            scheme: "https",
            final_url: url("gemini://example.com/"),
        }));
        let mut policy = FetchPolicy::default();
        policy.max_redirects = 5;
        let c = ctx(&policy);
        let err = d
            .fetch(&url("gemini://example.com/"), &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "TOO_MANY_REDIRECTS");
    }

    #[tokio::test]
    async fn redirect_to_unregistered_scheme_is_unknown_scheme() {
        let mut d = Dispatcher::new();
        // gemini redirects to spartan, which has no adapter.
        d.register(Box::new(StubProtocol {
            scheme: "gemini",
            final_url: url("spartan://example.com/"),
        }));
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let err = d
            .fetch(&url("gemini://example.com/"), &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "UNKNOWN_SCHEME");
    }

    #[test]
    fn private_ip_v4_ranges_are_detected() {
        use std::net::IpAddr;
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "100.127.255.254",
            "192.0.0.1",
            "198.18.0.1",
            "0.0.0.0",
        ] {
            assert!(
                is_private_ip(ip.parse::<IpAddr>().unwrap()),
                "{ip} should be private"
            );
        }
        for ip in ["8.8.8.8", "1.1.1.1", "198.51.100.7", "203.0.113.9"] {
            assert!(
                !is_private_ip(ip.parse::<IpAddr>().unwrap()),
                "{ip} should be public"
            );
        }
    }

    #[test]
    fn private_ip_v6_ranges_are_detected() {
        use std::net::IpAddr;
        assert!(is_private_ip("::1".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("fe80::1".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("fc00::1".parse::<IpAddr>().unwrap()));
        assert!(!is_private_ip("2606:4700::1111".parse::<IpAddr>().unwrap()));
    }

    #[tokio::test]
    async fn check_url_blocks_loopback_when_private_network_enforced() {
        let policy = FetchPolicy {
            block_private_network: true,
            ..FetchPolicy::default()
        };
        let err = policy.check_url("localhost", 79).await.unwrap_err();
        assert_eq!(err.code(), "SSRF_BLOCKED");
    }

    #[tokio::test]
    async fn check_url_allows_loopback_when_private_network_disabled() {
        let policy = FetchPolicy {
            block_private_network: false,
            ..FetchPolicy::default()
        };
        let vetted = policy.check_url("localhost", 79).await.unwrap();
        assert_eq!(vetted.host, "localhost");
        assert_eq!(vetted.port, 79);
    }

    #[tokio::test]
    async fn default_publish_is_unsupported() {
        // A protocol that only fetches still reports Unsupported for publish.
        let p = StubProtocol {
            scheme: "gemini",
            final_url: url("gemini://example.com/"),
        };
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let payload = PublishPayload {
            mime: "text/plain".to_string(),
            content: b"hi".to_vec(),
        };
        let err = p
            .publish(&url("gemini://example.com/"), &payload, &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "UNSUPPORTED");
    }
}
