//! Error types for the `hypernext-http` crate (ADR 0009: thiserror).

use url::Url;

/// Errors surfaced by fetch policy validation and HTTP fetching.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The URL's scheme or resolved address is disallowed by policy.
    #[error("SSRF blocked: {url} ({reason})")]
    SsrfBlocked { url: Url, reason: String },

    /// The response body exceeded `FetchPolicy::max_response_size`.
    #[error("response exceeded max size of {limit} bytes")]
    SizeLimitExceeded { limit: u64 },

    /// A redirect chain exceeded `FetchPolicy::max_redirects`.
    #[error("redirect limit of {limit} exceeded")]
    RedirectLimit { limit: usize },

    /// A redirect hop was refused by the policy (SSRF / disallowed host).
    #[error("redirect refused: {url}")]
    RedirectRefused { url: Url },

    /// DNS resolution failed for a host.
    #[error("DNS resolution failed for host {host}")]
    Dns {
        host: String,
        #[source]
        source: std::io::Error,
    },

    /// Malformed URL.
    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),

    /// A detected PGP signature did not verify (tampered content or no key).
    #[error("PGP signature invalid")]
    PgpInvalid,

    /// The underlying HTTP client failed (network, TLS, timeout, ...).
    #[error("HTTP client error: {0}")]
    Network(#[from] reqwest::Error),
}
