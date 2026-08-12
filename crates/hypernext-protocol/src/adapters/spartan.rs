//! Spartan adapter (plaintext TCP, `=:selector\tquery` for input).
//!
//! Wraps `spartan-protocol`'s `fetch` behind the [`Protocol`] trait. A spartan
//! reply is a single-digit status line (`2` success / `3` redirect / `4`
//! client error / `5` server error) plus a body on success. The preferred
//! document format is gemtext, so a success body parses through the shared
//! gemtext parser (the same one Gemini uses).
//!
//! **SSRF (invariant #8):** the crate dials `TcpStream::connect` itself, so
//! the adapter runs `FetchPolicy::check_url` BEFORE calling it.
//!
//! **Cancellation (ADR 0008):** the crate reads to EOF with no timeout, so the
//! adapter wraps the call in `tokio::select!` with the cancel token.
//!
//! **Size limits:** the reply body is checked against
//! `FetchPolicy::max_response_size`.

use async_trait::async_trait;
use hypernext_core::{Block, HypernextError, PageDoc};
use spartan_protocol::{fetch, ClientError, FetchOptions, Response, Status};
use url::Url;

use crate::adapters::gemini::gemtext_to_blocks;
use crate::adapters::tcp_helper::{first_heading, span, TcpProtocolHelper};
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Spartan's default port.
pub const SPARTAN_PORT: u16 = 300;

/// The Spartan adapter. Stateless; holds no resources between fetches.
#[derive(Debug, Default)]
pub struct SpartanAdapter {
    helper: TcpProtocolHelper,
}

impl SpartanAdapter {
    pub fn new() -> Self {
        Self {
            helper: TcpProtocolHelper::new(),
        }
    }
}

#[async_trait]
impl Protocol for SpartanAdapter {
    fn scheme(&self) -> &'static str {
        "spartan"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it across
        // `.await` would make the async-trait future `!Send`.
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("spartan URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(SPARTAN_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        let vetted = self.helper.check_url(policy, &host, port).await?;

        let options = FetchOptions {
            max_body: policy.max_response_size,
            ..Default::default()
        };

        // Cancellation: the crate reads to EOF with no timeout, so select! on
        // the token is the only cooperative-cancel hook.
        let response = self
            .helper
            .select_cancel(&cancel, async {
                fetch(
                    &format!("spartan://{}:{}{}", vetted.host, vetted.port, url.path()),
                    &options,
                )
                .await
                .map_err(map_client_error)
            })
            .await?;

        self.handle_response(url, &response)
    }
}

impl SpartanAdapter {
    /// Map a spartan response to a `PageDoc` or error by status.
    fn handle_response(&self, url: &Url, response: &Response) -> Result<PageDoc, HypernextError> {
        match response.status {
            Status::Success => {
                let body = String::from_utf8_lossy(&response.body);
                let blocks = match response.meta.as_str() {
                    "text/gemini" => gemtext_to_blocks(&body, url),
                    "text/plain" => vec![Block::Paragraph(span(&body))],
                    _ => vec![Block::Raw {
                        mime: response.meta.clone(),
                        bytes: response.body.clone(),
                    }],
                };
                let title = first_heading(&blocks);
                Ok(self.helper.doc(
                    url,
                    url.clone(),
                    blocks,
                    title,
                    "GET",
                    Some(response.meta.clone()),
                    Some(response.body.len() as u64),
                ))
            }
            Status::Redirect => {
                // 3x: META is an absolute path on the same host. The Dispatcher
                // follows the chain.
                let target = url
                    .join(response.meta.trim_start_matches('/'))
                    .unwrap_or_else(|_| url.clone());
                Ok(self
                    .helper
                    .doc(url, target, Vec::new(), None, "GET", None, None))
            }
            Status::ClientError => Err(HypernextError::NotFound(response.meta.clone())),
            Status::ServerError => Err(HypernextError::Protocol(response.meta.clone())),
        }
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
        ClientError::Timeout(step) => HypernextError::Network(format!("{step} timed out")),
        ClientError::Protocol(m) => HypernextError::InvalidResponse(m),
        ClientError::BodyTooLarge { max } => HypernextError::SizeLimitExceeded(max),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;
    use hypernext_core::{Span, SpanRun};

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn resp(status: Status, meta: &str, body: &[u8]) -> Response {
        Response {
            status,
            meta: meta.to_string(),
            body: body.to_vec(),
        }
    }

    #[test]
    fn happy_path_gemtext_parses_to_blocks() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(Status::Success, "text/gemini", b"# Hi\n\nBody text.\n"),
            )
            .unwrap();
        assert_eq!(doc.title.as_deref(), Some("Hi"));
        assert!(doc
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Hi")));
        assert!(doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))));
    }

    #[test]
    fn malformed_status_is_invalid_response() {
        let err = map_client_error(ClientError::Protocol("bad status line".to_string()));
        assert_eq!(err.code(), "INVALID_RESPONSE");
    }

    #[test]
    fn empty_success_body_yields_no_blocks() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let doc = adapter
            .handle_response(&u, &resp(Status::Success, "text/gemini", b""))
            .unwrap();
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn oversized_body_is_rejected() {
        let adapter = SpartanAdapter::new();
        let policy = FetchPolicy {
            max_response_size: 10,
            ..Default::default()
        };
        let err = adapter.helper.enforce_size(&policy, 100).unwrap_err();
        assert_eq!(err.code(), "SIZE_LIMIT_EXCEEDED");
    }

    #[test]
    fn redirect_sets_final_url() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/old");
        let doc = adapter
            .handle_response(&u, &resp(Status::Redirect, "/new/path/", b""))
            .unwrap();
        assert_eq!(doc.final_url.as_str(), "spartan://example.com/new/path/");
    }

    #[test]
    fn client_error_is_not_found() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let err = adapter
            .handle_response(&u, &resp(Status::ClientError, "not found", b""))
            .unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn server_error_is_protocol_error() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let err = adapter
            .handle_response(&u, &resp(Status::ServerError, "boom", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn plain_text_becomes_paragraph() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let doc = adapter
            .handle_response(&u, &resp(Status::Success, "text/plain", b"hi"))
            .unwrap();
        assert_eq!(
            doc.blocks,
            vec![Block::Paragraph(Span {
                runs: vec![SpanRun {
                    text: "hi".to_string(),
                    style: Default::default(),
                    link: None,
                }],
            })]
        );
    }

    #[test]
    fn scheme_and_capabilities_are_exported() {
        let adapter = SpartanAdapter::new();
        assert_eq!(adapter.scheme(), "spartan");
        assert!(adapter.capabilities().supports_fetch);
        assert!(!adapter.capabilities().needs_tls);
    }

    #[tokio::test]
    async fn missing_host_is_invalid_url() {
        let adapter = SpartanAdapter::new();
        let policy = FetchPolicy {
            block_private_network: false,
            ..Default::default()
        };
        let c = ctx(&policy);
        let err = adapter.fetch(&url("spartan:///"), &c).await.unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
    }

    #[test]
    fn unknown_mime_becomes_raw_block() {
        let adapter = SpartanAdapter::new();
        let u = url("spartan://example.com/");
        let doc = adapter
            .handle_response(&u, &resp(Status::Success, "image/png", b"\x89PNG"))
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
    fn client_errors_map() {
        assert_eq!(
            map_client_error(ClientError::BadUrl("b".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::Io("i".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Timeout("read")).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Protocol("p".into())).code(),
            "INVALID_RESPONSE"
        );
        assert_eq!(
            map_client_error(ClientError::BodyTooLarge { max: 10 }).code(),
            "SIZE_LIMIT_EXCEEDED"
        );
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
}
