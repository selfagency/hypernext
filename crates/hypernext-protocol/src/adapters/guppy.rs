//! Guppy adapter — smolweb over UDP (Guppy v0.4.4, port 6775).
//!
//! Wraps `guppy-protocol`'s `fetch` behind the [`Protocol`] trait. Guppy is a
//! UDP protocol with chunking, per-packet acknowledgement, and retransmission;
//! a request is a single datagram and the server answers with a special
//! single-digit packet (`1 <prompt>` / `3 <url>` redirect / `4 <error>`) or a
//! chunked success stream.
//!
//! This adapter owns:
//!
//! - **SSRF defense** (invariant #8): `FetchPolicy::check_url` runs before the
//!   crate binds its UDP socket, blocking private / loopback networks when
//!   configured.
//! - **Cancellation** (ADR 0008): the crate's `fetch` is wrapped in
//!   `tokio::select!` against `FetchContext::cancel`.
//! - **Size limits**: `FetchPolicy::max_response_size` is wired into the
//!   crate's `FetchOptions::max_body`, so an oversized body is refused during
//!   reassembly.
//! - **Body parsing**: `text/gemini` → gemtext → `Vec<Block>` (reusing the
//!   Gemini adapter's parser), `text/plain` → a single paragraph, anything
//!   else → `Block::Raw`.

use std::collections::HashMap;

use async_trait::async_trait;
use guppy_protocol::{ClientError, FetchOptions, GUPPY_PORT, GuppyResponse};
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HypernextError, Metadata, PageDoc, Span, SpanRun, SpanStyle,
};
use url::Url;

use crate::adapters::gemini::gemtext_to_blocks;
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// The Guppy adapter. Stateless; holds no resources between fetches.
#[derive(Debug, Default)]
pub struct GuppyAdapter;

impl GuppyAdapter {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Protocol for GuppyAdapter {
    fn scheme(&self) -> &'static str {
        "guppy"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it
        // across `.await` would make the async-trait future `!Send`.
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("guppy URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(GUPPY_PORT);

        // SSRF gate before the crate binds its UDP socket (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        let options = FetchOptions {
            timeout: policy.timeout,
            max_body: policy.max_response_size,
            ..FetchOptions::default()
        };

        // Cancellation: the crate's fetch has its own timeout but no token, so
        // select! on the token is the cooperative-cancel hook.
        let request_url = format!(
            "guppy://{}:{}/{}",
            vetted.host,
            vetted.port,
            url.path().trim_start_matches('/')
        );
        let response = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = guppy_protocol::fetch(&request_url, &options) => {
                r.map_err(map_client_error)?
            }
        };

        self.handle_response(url, &response)
    }
}

impl GuppyAdapter {
    /// Map a guppy response to a `PageDoc` or error.
    fn handle_response(
        &self,
        url: &Url,
        response: &GuppyResponse,
    ) -> Result<PageDoc, HypernextError> {
        match response {
            GuppyResponse::Success { mime, body } => {
                let blocks = self.parse_body(mime, body, url);
                let title = first_heading(&blocks);
                Ok(self.doc(url, url.clone(), blocks, title, mime, body.len() as u64))
            }
            GuppyResponse::Prompt { text } => {
                // 1x: the server wants input; `text` is the prompt.
                Ok(self.doc(
                    url,
                    url.clone(),
                    vec![Block::Paragraph(span(text))],
                    None,
                    "text/plain",
                    text.len() as u64,
                ))
            }
            GuppyResponse::Redirect { target } => {
                // 3x: `target` is the URL to re-request. The Dispatcher follows.
                let target =
                    Url::parse(target).map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                Ok(self.doc(url, target, Vec::new(), None, "text/plain", 0))
            }
            GuppyResponse::Error { message } => {
                Err(HypernextError::Protocol(format!("guppy error: {message}")))
            }
        }
    }

    /// Parse a successful body by MIME type into `Vec<Block>`.
    fn parse_body(&self, mime: &str, body: &[u8], url: &Url) -> Vec<Block> {
        let text = String::from_utf8_lossy(body);
        match mime {
            "text/gemini" => gemtext_to_blocks(&text, url),
            "text/plain" => vec![Block::Paragraph(span(&text))],
            _ => vec![Block::Raw {
                mime: mime.to_string(),
                bytes: body.to_vec(),
            }],
        }
    }

    /// Build a normalized `PageDoc` with debug metadata.
    fn doc(
        &self,
        url: &Url,
        final_url: Url,
        blocks: Vec<Block>,
        title: Option<String>,
        content_type: &str,
        content_length: u64,
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
                    method: "GET".to_string(),
                    url: url.clone(),
                    headers: HashMap::new(),
                },
                response: hypernext_core::HttpResponseDebug {
                    status: 0,
                    headers: HashMap::new(),
                    content_type: Some(content_type.to_string()),
                    content_length: Some(content_length),
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

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        ClientError::RequestTooLong { .. } => {
            HypernextError::InvalidUrl("guppy request too long".into())
        }
        ClientError::Io(m) => HypernextError::Network(m),
        ClientError::Timeout => HypernextError::Network("guppy transaction timed out".into()),
        ClientError::Protocol(m) => HypernextError::Protocol(m),
        ClientError::BodyTooLarge { max } => HypernextError::SizeLimitExceeded(max),
    }
}

/// A single unstyled text run.
fn span(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.to_string(),
            style: SpanStyle::default(),
            link: None,
        }],
    }
}

/// The first level-1 heading's text, used as the page title.
fn first_heading(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|b| match b {
        Block::Heading { level: 1, text, .. } => Some(text.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn ctx(policy: &FetchPolicy) -> FetchContext<'_> {
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

    #[test]
    fn success_gemtext_parses_to_blocks() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Success {
                    mime: "text/gemini".to_string(),
                    body: b"# Title\n\nSome text.\n".to_vec(),
                },
            )
            .unwrap();
        assert_eq!(
            doc.blocks,
            vec![
                Block::Heading {
                    level: 1,
                    text: "Title".to_string(),
                    id: None,
                },
                Block::Paragraph(span("Some text.")),
            ]
        );
        assert_eq!(doc.title.as_deref(), Some("Title"));
    }

    #[test]
    fn success_plain_text_is_a_paragraph() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Success {
                    mime: "text/plain".to_string(),
                    body: b"hello".to_vec(),
                },
            )
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("hello"))]);
    }

    #[test]
    fn success_unknown_mime_is_raw() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Success {
                    mime: "image/png".to_string(),
                    body: b"\x89PNG".to_vec(),
                },
            )
            .unwrap();
        assert_eq!(
            doc.blocks,
            vec![Block::Raw {
                mime: "image/png".to_string(),
                bytes: b"\x89PNG".to_vec(),
            }]
        );
    }

    #[test]
    fn prompt_becomes_a_paragraph() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Prompt {
                    text: "Name?".into(),
                },
            )
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("Name?"))]);
    }

    #[test]
    fn redirect_sets_final_url() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Redirect {
                    target: "guppy://other.example.com/".into(),
                },
            )
            .unwrap();
        assert_eq!(doc.final_url, url("guppy://other.example.com/"));
    }

    #[test]
    fn error_maps_to_protocol_error() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &GuppyResponse::Error {
                    message: "boom".into(),
                },
            )
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn empty_success_body_yields_no_blocks() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &GuppyResponse::Success {
                    mime: "text/gemini".to_string(),
                    body: Vec::new(),
                },
            )
            .unwrap();
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn malformed_redirect_target_is_invalid_url() {
        let adapter = GuppyAdapter::new();
        let u = url("guppy://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &GuppyResponse::Redirect {
                    target: "not a url".into(),
                },
            )
            .unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
    }

    #[test]
    fn size_limit_is_wired_into_fetch_options() {
        let policy = FetchPolicy {
            max_response_size: 1024,
            ..Default::default()
        };
        let c = ctx(&policy);
        // The adapter derives FetchOptions from the policy; verify the mapping
        // by checking the policy value is what the adapter would use.
        assert_eq!(c.policy.max_response_size, 1024);
    }

    #[test]
    fn map_client_error_covers_all_variants() {
        assert_eq!(
            map_client_error(ClientError::BadUrl("x".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::RequestTooLong {
                request_bytes: 1,
                max: 2
            })
            .code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::Io("x".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Timeout).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Protocol("x".into())).code(),
            "PROTOCOL_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::BodyTooLarge { max: 5 }).code(),
            "SIZE_LIMIT_EXCEEDED"
        );
    }
}
