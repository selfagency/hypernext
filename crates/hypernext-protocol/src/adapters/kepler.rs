//! Kepler adapter — wraps `kepler-protocol` (Phase 2, §3.5).
//!
//! Kepler (`kepler://` on 2009, `keplers://` on 10009) is Gemini's shape plus
//! a cache model: the request carries a last-cached timestamp and acceptable
//! language, and a `2x` response declares the body's length, last-updated and
//! expiry. A `7x` response says nothing changed and carries no body.
//!
//! - **Body parsing**: Kepler bodies are gemtext-shaped, so this adapter
//!   reuses Gemini's `gemtext_to_blocks` parser (Phase 2 §3.5 step 3).
//! - **SSRF** (invariant #8): `FetchPolicy::check_url` runs before the dial.
//! - **Cancellation** (ADR 0008): the exchange is wrapped in `tokio::select!`
//!   against `FetchContext::cancel`.
//! - **Size limits**: the response body is checked against
//!   `FetchPolicy::max_response_size`.
//! - **TOFU** (`keplers://`): the leaf certificate is pinned in the
//!   `tofu_certs` table on first contact; a changed cert fails with
//!   `TofuCertChanged` (Phase 2 §3.5 step 4).

use async_trait::async_trait;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HttpResponseDebug, HypernextError, Metadata, PageDoc,
};
use std::collections::HashMap;
use tokio::net::TcpStream;
use url::Url;

use crate::adapters::gemini::gemtext_to_blocks;
use crate::adapters::tcp_helper::{first_heading, span};
use crate::adapters::tofu;
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Kepler's plaintext port.
const DEFAULT_PORT: u16 = 2009;
/// Kepler's TLS port.
const DEFAULT_TLS_PORT: u16 = 10009;

/// The Kepler adapter. Stateless: TOFU pins live in the store.
#[derive(Debug, Default)]
pub struct KeplerAdapter;

impl KeplerAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Run the exchange over a connected stream, honoring the cancel token.
    async fn exchange(
        &self,
        url: &Url,
        stream: &mut (impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin),
        ctx: &FetchContext<'_>,
    ) -> Result<kepler_protocol::Response, HypernextError> {
        // We hold no cached copy, so last_cached is 0; request in English.
        let line = kepler_protocol::request_line(url.as_str(), 0, "en");
        let cancel = ctx.cancel.clone();
        tokio::select! {
            _ = cancel.cancelled() => Err(HypernextError::Cancelled),
            r = kepler_protocol::client::exchange(stream, line.as_bytes()) => {
                r.map_err(map_client_error)
            }
        }
    }

    /// Map a Kepler response to a `PageDoc` or error by status class.
    fn handle_response(
        &self,
        url: &Url,
        response: &kepler_protocol::Response,
    ) -> Result<PageDoc, HypernextError> {
        use kepler_protocol::wire::Status;
        match response.header.status() {
            Status::Input => {
                let prompt = match &response.header {
                    kepler_protocol::Header::Meta { meta, .. } => meta.clone(),
                    _ => String::new(),
                };
                Ok(self.doc(
                    url,
                    url.clone(),
                    vec![Block::Paragraph(span(&prompt))],
                    None,
                    response,
                ))
            }
            Status::Success => {
                let blocks = self.parse_body(response, url)?;
                let title = first_heading(&blocks);
                Ok(self.doc(url, url.clone(), blocks, title, response))
            }
            Status::Redirect => {
                let target = match &response.header {
                    kepler_protocol::Header::Meta { meta, .. } => meta.clone(),
                    _ => String::new(),
                };
                let target =
                    Url::parse(&target).map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                Ok(self.doc(url, target, Vec::new(), None, response))
            }
            Status::TemporaryFailure => Err(HypernextError::Protocol(format!(
                "kepler temporary failure {}: {}",
                response.header.code(),
                meta_text(response)
            ))),
            Status::PermanentFailure => {
                if response.header.code() == 51 {
                    Err(HypernextError::NotFound(meta_text(response)))
                } else {
                    Err(HypernextError::Protocol(format!(
                        "kepler permanent failure {}: {}",
                        response.header.code(),
                        meta_text(response)
                    )))
                }
            }
            Status::AuthRequired => Err(HypernextError::Unauthorized(format!(
                "authentication required for {}",
                url.host_str().unwrap_or("")
            ))),
            Status::Unchanged => {
                // A 7x says the cached copy is still current; we hold none, so
                // surface it as an empty document rather than an error.
                Ok(self.doc(url, url.clone(), Vec::new(), None, response))
            }
        }
    }

    /// Parse a successful body by MIME type into `Vec<Block>`.
    fn parse_body(
        &self,
        response: &kepler_protocol::Response,
        url: &Url,
    ) -> Result<Vec<Block>, HypernextError> {
        let mime = response.mime().unwrap_or("").to_string();
        let body = String::from_utf8_lossy(&response.body);
        match mime.as_str() {
            "text/gemini" => Ok(gemtext_to_blocks(&body, url)),
            "text/plain" => Ok(vec![Block::Paragraph(span(&body))]),
            "text/markdown" => Ok(crate::adapters::gemini::markdown_to_blocks(&body, url)),
            _ => Ok(vec![Block::Raw {
                mime,
                bytes: response.body.clone(),
            }]),
        }
    }

    /// Build a normalized `PageDoc` with debug metadata.
    fn doc(
        &self,
        url: &Url,
        final_url: Url,
        blocks: Vec<Block>,
        title: Option<String>,
        response: &kepler_protocol::Response,
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
                response: HttpResponseDebug {
                    status: response.header.code() as u16,
                    headers: HashMap::new(),
                    content_type: response.mime().map(|s| s.to_string()),
                    content_length: Some(response.body.len() as u64),
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

#[async_trait]
impl Protocol for KeplerAdapter {
    fn scheme(&self) -> &'static str {
        "kepler"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            needs_tls: true,
            needs_tofu: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        let policy = ctx.policy;
        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("kepler URL has no host".to_string()))?
            .to_string();
        let secure = url.scheme() == "keplers";
        let port = url.port().unwrap_or(if secure {
            DEFAULT_TLS_PORT
        } else {
            DEFAULT_PORT
        });

        // SSRF gate before dialing (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        let response = if secure {
            let mut stream = tofu::tls_connect(&vetted.host, vetted.port, ctx).await?;
            self.exchange(url, &mut stream, ctx).await?
        } else {
            let mut stream = TcpStream::connect((vetted.host.as_str(), vetted.port))
                .await
                .map_err(|e| {
                    HypernextError::Network(format!("tcp {}:{}: {e}", vetted.host, vetted.port))
                })?;
            self.exchange(url, &mut stream, ctx).await?
        };

        enforce_size(policy.max_response_size, response.body.len())?;

        self.handle_response(url, &response)
    }
}

/// Enforce `FetchPolicy::max_response_size` on a response body.
fn enforce_size(max: usize, body_len: usize) -> Result<(), HypernextError> {
    if body_len > max {
        return Err(HypernextError::SizeLimitExceeded(body_len));
    }
    Ok(())
}

/// The free-text message a non-success Kepler response carries.
fn meta_text(response: &kepler_protocol::Response) -> String {
    match &response.header {
        kepler_protocol::Header::Meta { meta, .. } => meta.clone(),
        _ => String::new(),
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: kepler_protocol::ClientError) -> HypernextError {
    match e {
        kepler_protocol::ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        kepler_protocol::ClientError::Connect(m) => HypernextError::Network(m),
        kepler_protocol::ClientError::Io(m) => HypernextError::Network(m),
        kepler_protocol::ClientError::Protocol(m) => HypernextError::InvalidResponse(m),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kepler_protocol::wire::{CacheInfo, Header};

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn resp(header: Header, body: &[u8]) -> kepler_protocol::Response {
        kepler_protocol::Response {
            header,
            body: body.to_vec(),
        }
    }

    fn success(mimetype: &str, body: &[u8]) -> kepler_protocol::Response {
        resp(
            Header::Success {
                code: 20,
                cache: CacheInfo {
                    length: body.len() as i64,
                    last_updated: 1_777_745_482,
                    expires: 1_777_759_482,
                },
                mimetype: mimetype.to_string(),
            },
            body,
        )
    }

    #[test]
    fn parses_gemtext_success_body() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let body = b"# Hello\n\nWelcome to the capsule.\n";
        let doc = adapter
            .handle_response(&u, &success("text/gemini", body))
            .unwrap();
        assert_eq!(doc.title.as_deref(), Some("Hello"));
        assert_eq!(doc.blocks.len(), 2);
        assert!(matches!(&doc.blocks[0], Block::Heading { level: 1, text, .. } if text == "Hello"));
    }

    #[test]
    fn parses_plain_text_success_body() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(&u, &success("text/plain", b"just text"))
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("just text"))]);
    }

    #[test]
    fn parses_markdown_success_body() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(&u, &success("text/markdown", b"# Hi\n\nSome text.\n"))
            .unwrap();
        assert!(
            doc.blocks
                .iter()
                .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Hi"))
        );
    }

    #[test]
    fn unknown_mime_becomes_raw_block() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(&u, &success("image/png", b"\x89PNG"))
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
    fn parses_redirect_status() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 31,
                        status: kepler_protocol::wire::Status::Redirect,
                        meta: "kepler://other.example/".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap();
        assert_eq!(doc.final_url, url("kepler://other.example/"));
    }

    #[test]
    fn parses_input_status_as_prompt() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 10,
                        status: kepler_protocol::wire::Status::Input,
                        meta: "Your name?".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("Your name?"))]);
    }

    #[test]
    fn not_found_maps_to_not_found() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 51,
                        status: kepler_protocol::wire::Status::PermanentFailure,
                        meta: "not found".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn other_permanent_failure_maps_to_protocol_error() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 59,
                        status: kepler_protocol::wire::Status::PermanentFailure,
                        meta: "bad request".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn auth_required_maps_to_unauthorized() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 61,
                        status: kepler_protocol::wire::Status::AuthRequired,
                        meta: "certificate required".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap_err();
        assert_eq!(err.code(), "UNAUTHORIZED");
    }

    #[test]
    fn unchanged_status_returns_empty_doc() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Unchanged {
                        code: 70,
                        expires: 1_777_759_482,
                    },
                    b"",
                ),
            )
            .unwrap();
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn oversized_body_is_rejected() {
        assert!(matches!(
            enforce_size(5, 100),
            Err(HypernextError::SizeLimitExceeded(100))
        ));
        assert!(enforce_size(100, 5).is_ok());
        // Boundary: exactly at the limit is allowed.
        assert!(enforce_size(5, 5).is_ok());
    }

    #[test]
    fn temporary_failure_maps_to_protocol_error() {
        let adapter = KeplerAdapter::new();
        let u = url("kepler://example.com/");
        let err = adapter
            .handle_response(
                &u,
                &resp(
                    Header::Meta {
                        code: 44,
                        status: kepler_protocol::wire::Status::TemporaryFailure,
                        meta: "slow down".to_string(),
                    },
                    b"",
                ),
            )
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn scheme_and_capabilities() {
        let adapter = KeplerAdapter::new();
        assert_eq!(adapter.scheme(), "kepler");
        let caps = adapter.capabilities();
        assert!(caps.supports_fetch && caps.needs_tls && caps.needs_tofu);
    }

    #[test]
    fn map_client_error_variants() {
        use kepler_protocol::ClientError;
        assert_eq!(
            map_client_error(ClientError::BadUrl("x".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::Connect("x".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Io("x".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Protocol("x".into())).code(),
            "INVALID_RESPONSE"
        );
    }
}
