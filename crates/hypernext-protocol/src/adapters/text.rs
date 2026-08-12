//! Text adapter — wraps `text-protocol`, the deliberately minimal smolweb
//! protocol: plain TCP (and TLS), exactly three status codes, every document
//! `text/plain`.
//!
//! `text://` documents are plain text whose only structure is the optional
//! `=>` link line. This adapter maps text lines to preformatted
//! [`Block::Paragraph`]s (whitespace preserved) and link lines to
//! [`Block::Link`]s (Phase 2, `docs/phases/02-smolnet-protocols.md` §3.5).
//!
//! **SSRF (invariant #8):** the crate dials `TcpStream::connect` itself, so
//! the adapter runs `FetchPolicy::check_url` BEFORE calling it — the SSRF
//! gate is the pre-connect check.
//!
//! **Cancellation:** the crate reads to EOF with no timeout, so the adapter
//! wraps the call in `tokio::select!` with the `FetchContext::cancel` token.
//!
//! **Size limits:** the response body is checked against
//! `FetchPolicy::max_response_size` after the read.

use async_trait::async_trait;
use hypernext_core::{Block, HypernextError, PageDoc, Span, SpanRun, SpanStyle};
use url::Url;

use crate::adapters::tcp_helper::{first_heading, span, TcpProtocolHelper};
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Text's well-known plain-TCP port (the spec names it Mercury).
pub const TEXT_PORT: u16 = 1961;

/// A text adapter. Stateless; holds no resources between fetches.
pub struct TextAdapter;

impl TextAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TextAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Protocol for TextAdapter {
    fn scheme(&self) -> &'static str {
        "text"
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
        let helper = TcpProtocolHelper::new();
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("text URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(TEXT_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        helper.check_url(policy, &host, port).await?;

        let iri = url.as_str().to_string();
        let response = helper
            .select_cancel(&cancel, async {
                text_protocol::fetch(&iri).await.map_err(map_client_error)
            })
            .await?;

        helper.enforce_size(policy, response.body.len())?;

        self.handle_response(url, &response)
    }
}

impl TextAdapter {
    /// Map a text-protocol response to a `PageDoc` or error by status.
    fn handle_response(
        &self,
        url: &Url,
        response: &text_protocol::Response,
    ) -> Result<PageDoc, HypernextError> {
        let helper = TcpProtocolHelper::new();
        match response.header.status {
            text_protocol::Status::Ok => {
                let body = String::from_utf8_lossy(&response.body);
                let blocks = parse_body(&body, url);
                let title = first_heading(&blocks);
                Ok(helper.doc(
                    url,
                    url.clone(),
                    blocks,
                    title,
                    "GET",
                    Some(response.header.meta.clone()),
                    Some(response.body.len() as u64),
                ))
            }
            text_protocol::Status::Redirect => {
                // 30: `meta` is the target IRI. The Dispatcher follows the chain.
                let target = Url::parse(&response.header.meta)
                    .map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                Ok(helper.doc(url, target, Vec::new(), None, "GET", None, None))
            }
            text_protocol::Status::Nok => Err(HypernextError::Protocol(format!(
                "text error: {}",
                response.header.meta
            ))),
        }
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: text_protocol::ClientError) -> HypernextError {
    match e {
        text_protocol::ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        text_protocol::ClientError::Connect(m) => HypernextError::Network(format!("connect: {m}")),
        text_protocol::ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
        text_protocol::ClientError::Protocol(m) => HypernextError::Protocol(m),
    }
}

/// Convert a text-protocol body into normalized `Block`s.
///
/// Consecutive text lines group into a single preformatted paragraph (line
/// breaks preserved); `=>` link lines become [`Block::Link`]s.
fn parse_body(body: &str, base: &Url) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut para: Vec<String> = Vec::new();

    for line in text_protocol::parse_body(body) {
        match line {
            text_protocol::Line::Text(t) => para.push(t),
            text_protocol::Line::Link(link) => {
                flush_para(&mut para, &mut blocks);
                let target = base.join(&link.url).unwrap_or_else(|_| base.clone());
                let label = link.label.unwrap_or_else(|| link.url.clone());
                blocks.push(Block::Link {
                    url: target,
                    text: span(&label),
                });
            }
        }
    }
    flush_para(&mut para, &mut blocks);
    blocks
}

/// Flush accumulated text lines as one preformatted paragraph.
fn flush_para(para: &mut Vec<String>, blocks: &mut Vec<Block>) {
    if !para.is_empty() {
        blocks.push(Block::Paragraph(preformatted(&para.join("\n"))));
        para.clear();
    }
}

/// A preformatted span (whitespace preserved).
fn preformatted(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.to_string(),
            style: SpanStyle {
                preformatted: true,
                ..Default::default()
            },
            link: None,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;
    use pretty_assertions::assert_eq;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn resp(status: text_protocol::Status, meta: &str, body: &[u8]) -> text_protocol::Response {
        text_protocol::Response {
            header: text_protocol::Header {
                status,
                meta: meta.to_string(),
            },
            body: body.to_vec(),
        }
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
    fn happy_path_parses_text_and_links() {
        let adapter = TextAdapter::new();
        let u = url("text://example.org/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    text_protocol::Status::Ok,
                    "text/plain;charset=utf-8",
                    b"hello\n=> text://example.org/a.txt A link\n",
                ),
            )
            .unwrap();
        assert_eq!(
            doc.blocks,
            vec![
                Block::Paragraph(preformatted("hello")),
                Block::Link {
                    url: url("text://example.org/a.txt"),
                    text: span("A link"),
                },
            ]
        );
        // The paragraph is preformatted.
        if let Block::Paragraph(s) = &doc.blocks[0] {
            assert!(s.runs[0].style.preformatted);
        }
    }

    #[test]
    fn consecutive_text_lines_group_into_one_preformatted_paragraph() {
        let adapter = TextAdapter::new();
        let u = url("text://example.org/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    text_protocol::Status::Ok,
                    "text/plain",
                    b"line one\nline two\n",
                ),
            )
            .unwrap();
        assert_eq!(
            doc.blocks,
            vec![Block::Paragraph(preformatted("line one\nline two"))]
        );
    }

    #[test]
    fn redirect_sets_final_url() {
        let adapter = TextAdapter::new();
        let u = url("text://example.org/");
        let doc = adapter
            .handle_response(
                &u,
                &resp(
                    text_protocol::Status::Redirect,
                    "text://example.org/moved",
                    b"",
                ),
            )
            .unwrap();
        assert_eq!(doc.final_url, url("text://example.org/moved"));
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn nok_status_is_protocol_error() {
        let adapter = TextAdapter::new();
        let u = url("text://example.org/");
        let err = adapter
            .handle_response(&u, &resp(text_protocol::Status::Nok, "not found", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn empty_body_yields_no_blocks() {
        let adapter = TextAdapter::new();
        let u = url("text://example.org/");
        let doc = adapter
            .handle_response(&u, &resp(text_protocol::Status::Ok, "text/plain", b""))
            .unwrap();
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn oversized_body_is_rejected() {
        let helper = TcpProtocolHelper::new();
        let policy = FetchPolicy {
            max_response_size: 10,
            ..Default::default()
        };
        let err = helper.enforce_size(&policy, 100).unwrap_err();
        assert_eq!(err.code(), "SIZE_LIMIT_EXCEEDED");
    }

    #[test]
    fn relative_link_resolves_against_base() {
        let base = url("text://example.org/dir/page");
        let blocks = parse_body("=> /other A", &base);
        assert_eq!(
            blocks,
            vec![Block::Link {
                url: url("text://example.org/other"),
                text: span("A"),
            }]
        );
    }

    #[test]
    fn client_errors_map_to_hypernext_errors() {
        assert_eq!(
            map_client_error(text_protocol::ClientError::BadUrl("bad".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(text_protocol::ClientError::Connect("c".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(text_protocol::ClientError::Io("io".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(text_protocol::ClientError::Protocol("p".into())).code(),
            "PROTOCOL_ERROR"
        );
    }

    #[test]
    fn adapter_identity_and_capabilities() {
        let adapter = TextAdapter::new();
        assert_eq!(adapter.scheme(), "text");
        assert!(adapter.capabilities().supports_fetch);
        assert!(!adapter.capabilities().needs_tls);
        let defaulted = TextAdapter::default();
        assert_eq!(defaulted.scheme(), "text");
    }

    #[tokio::test]
    async fn url_without_host_is_invalid() {
        // A text URL with no host must be rejected before any dial.
        let adapter = TextAdapter::new();
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let err = adapter.fetch(&url("text:///path"), &c).await.unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
    }
}
