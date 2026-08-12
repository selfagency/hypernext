//! Shared plumbing for the plaintext-TCP protocol adapters (Gopher, Spartan,
//! Nex, ...).
//!
//! These protocols are structurally similar: a TCP connection, a request
//! line, a response body read to EOF. They differ only in the wire format and
//! how the body maps to `Vec<Block>`. [`TcpProtocolHelper`] centralises the
//! parts they share (Phase 2, `docs/phases/02-smolnet-protocols.md` §3.5):
//!
//! - **SSRF pre-check** (invariant #8): `FetchPolicy::check_url` runs before
//!   the crate dials, blocking private / loopback networks when configured.
//! - **Cancellation** (ADR 0008): the crate's fetch is wrapped in
//!   `tokio::select!` against `FetchContext::cancel`.
//! - **Size limits**: the response body is checked against
//!   `FetchPolicy::max_response_size`.
//! - **`PageDoc` construction**: a normalized doc with debug metadata.
//!
//! The helper also exposes the small `span` / `first_heading` helpers shared by
//! every adapter so each one does not re-implement them.

use std::collections::HashMap;

use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HypernextError, Metadata, PageDoc, Span, SpanRun, SpanStyle,
};
use url::Url;

use crate::dispatcher::{FetchPolicy, VettedTarget};

/// Shared plumbing for the plaintext-TCP adapters. Stateless.
#[derive(Debug, Default)]
pub struct TcpProtocolHelper;

impl TcpProtocolHelper {
    pub fn new() -> Self {
        Self
    }

    /// Resolve `host`/`port` and run the SSRF gate (invariant #8). Every
    /// adapter calls this before dialing.
    pub async fn check_url(
        &self,
        policy: &FetchPolicy,
        host: &str,
        port: u16,
    ) -> Result<VettedTarget, HypernextError> {
        policy.check_url(host, port).await
    }

    /// Wrap a protocol-crate fetch in `tokio::select!` against the cancel
    /// token, so a cancelled fetch returns [`HypernextError::Cancelled`]
    /// instead of blocking on a read-to-EOF.
    pub async fn select_cancel<F, T>(
        &self,
        cancel: &tokio_util::sync::CancellationToken,
        fut: F,
    ) -> Result<T, HypernextError>
    where
        F: std::future::Future<Output = Result<T, HypernextError>>,
    {
        let cancel = cancel.clone();
        tokio::select! {
            _ = cancel.cancelled() => Err(HypernextError::Cancelled),
            r = fut => r,
        }
    }

    /// Enforce `FetchPolicy::max_response_size` on a response body.
    pub fn enforce_size(
        &self,
        policy: &FetchPolicy,
        body_len: usize,
    ) -> Result<(), HypernextError> {
        if body_len > policy.max_response_size {
            return Err(HypernextError::SizeLimitExceeded(body_len));
        }
        Ok(())
    }

    /// Build a normalized `PageDoc` with debug metadata. `method` is the
    /// request verb for the debug record (e.g. `"GET"`).
    #[allow(clippy::too_many_arguments)]
    pub fn doc(
        &self,
        url: &Url,
        final_url: Url,
        blocks: Vec<Block>,
        title: Option<String>,
        method: &str,
        content_type: Option<String>,
        content_length: Option<u64>,
    ) -> PageDoc {
        PageDoc {
            url: url.clone(),
            final_url,
            title,
            metadata: Metadata::default(),
            blocks,
            signature: None,
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: method.to_string(),
                    url: url.clone(),
                    headers: HashMap::new(),
                },
                response: hypernext_core::HttpResponseDebug {
                    status: 0,
                    headers: HashMap::new(),
                    content_type,
                    content_length,
                },
                timing: Default::default(),
                redirects: Vec::new(),
                parser_decisions: Vec::new(),
                tls: None,
            },
            from_cache: false,
        }
    }
}

/// A single unstyled text run.
pub fn span(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.to_string(),
            style: SpanStyle::default(),
            link: None,
        }],
    }
}

/// The first level-1 heading's text, used as the page title.
pub fn first_heading(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|b| match b {
        Block::Heading { level: 1, text, .. } => Some(text.clone()),
        _ => None,
    })
}
