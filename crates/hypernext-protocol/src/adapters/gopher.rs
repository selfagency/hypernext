//! Gopher adapter (RFC 1436, Gopher+ attributes, RFC 4266 URLs).
//!
//! Wraps `gopher-protocol`'s `fetch` behind the [`Protocol`] trait. A gopher
//! reply is a body with no status line; the item-type character in the URL
//! path is the only hint about the bytes. A menu (`application/gopher-menu`)
//! parses into `Vec<Block::Link>`; a text file becomes a paragraph; anything
//! else becomes a `Block::Raw`.
//!
//! **SSRF (invariant #8):** the crate dials `TcpStream::connect` itself, so
//! the adapter runs `FetchPolicy::check_url` BEFORE calling it.
//!
//! **Cancellation (ADR 0008):** the crate reads to EOF with no timeout, so
//! the adapter wraps the call in `tokio::select!` with the cancel token.
//!
//! **Size limits:** the reply body is checked against
//! `FetchPolicy::max_response_size`.

use async_trait::async_trait;
use gopher_protocol::{ClientError, GopherKind, Response, fetch, parse_menu};
use hypernext_core::{Block, HypernextError, PageDoc};
use url::Url;

use crate::adapters::tcp_helper::{TcpProtocolHelper, first_heading, span};
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Gopher's well-known port (RFC 1436).
pub const GOPHER_PORT: u16 = 70;

/// The Gopher adapter. Stateless; holds no resources between fetches.
#[derive(Debug, Default)]
pub struct GopherAdapter {
    helper: TcpProtocolHelper,
}

impl GopherAdapter {
    pub fn new() -> Self {
        Self {
            helper: TcpProtocolHelper::new(),
        }
    }
}

#[async_trait]
impl Protocol for GopherAdapter {
    fn scheme(&self) -> &'static str {
        "gopher"
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
            .ok_or_else(|| HypernextError::InvalidUrl("gopher URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(GOPHER_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        let vetted = self.helper.check_url(policy, &host, port).await?;

        // Cancellation: the crate reads to EOF with no timeout, so select! on
        // the token is the only cooperative-cancel hook.
        let response = self
            .helper
            .select_cancel(&cancel, async {
                fetch(&format!(
                    "gopher://{}:{}{}",
                    vetted.host,
                    vetted.port,
                    url.path()
                ))
                .await
                .map_err(map_client_error)
            })
            .await?;

        self.helper.enforce_size(policy, response.body.len())?;

        let blocks = parse_body(&response, url);
        let title = first_heading(&blocks);
        Ok(self.helper.doc(
            url,
            url.clone(),
            blocks,
            title,
            "GET",
            Some(response.mime.clone()),
            Some(response.body.len() as u64),
        ))
    }
}

/// Map a gopher reply body to `Vec<Block>` by its inferred MIME type.
fn parse_body(response: &Response, base: &Url) -> Vec<Block> {
    match response.mime.as_str() {
        "application/gopher-menu" => menu_to_links(&String::from_utf8_lossy(&response.body), base),
        "text/plain" => vec![Block::Paragraph(span(&String::from_utf8_lossy(
            &response.body,
        )))],
        _ => vec![Block::Raw {
            mime: response.mime.clone(),
            bytes: response.body.clone(),
        }],
    }
}

/// Convert a gopher menu into `Vec<Block::Link>`. Info and error lines become
/// paragraphs; navigable items become links; a URL item's target is used
/// verbatim.
fn menu_to_links(body: &str, base: &Url) -> Vec<Block> {
    let mut blocks = Vec::new();
    for item in parse_menu(body) {
        match item.kind {
            GopherKind::Info | GopherKind::Error => {
                blocks.push(Block::Paragraph(span(&item.display)));
            }
            _ => {
                let target = item
                    .url
                    .as_deref()
                    .map(|u| base.join(u).unwrap_or_else(|_| base.clone()))
                    .unwrap_or_else(|| base.clone());
                blocks.push(Block::Link {
                    url: target,
                    text: span(&item.display),
                });
            }
        }
    }
    blocks
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        ClientError::Connect(m) => HypernextError::Network(format!("connect: {m}")),
        ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
        ClientError::BadPlusHeader(m) => HypernextError::InvalidResponse(m),
        ClientError::PlusError(m) => HypernextError::Protocol(m),
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

    fn resp(mime: &str, body: &[u8]) -> Response {
        Response {
            mime: mime.to_string(),
            body: body.to_vec(),
        }
    }

    #[test]
    fn happy_path_menu_parses_to_links() {
        let body = "1Software\t/software\tgopher.example\t70\r\niA note\t\t\t\r\n0Readme\t/readme.txt\tgopher.example\t70\r\n";
        let base = url("gopher://gopher.example/");
        let blocks = parse_body(&resp("application/gopher-menu", body.as_bytes()), &base);
        assert_eq!(blocks.len(), 3);
        assert!(
            matches!(&blocks[0], Block::Link { url, .. } if url.as_str() == "gopher://gopher.example/1/software")
        );
        assert!(matches!(&blocks[1], Block::Paragraph(_)));
        assert!(
            matches!(&blocks[2], Block::Link { url, .. } if url.as_str() == "gopher://gopher.example/0/readme.txt")
        );
    }

    #[test]
    fn malformed_menu_line_is_skipped() {
        // A resource line with no host is skipped by the parser.
        let body = "1Bad\t/sel\t\t70\r\n0Good\t/good.txt\texample.test\t70\r\n";
        let base = url("gopher://example.test/");
        let blocks = parse_body(&resp("application/gopher-menu", body.as_bytes()), &base);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], Block::Link { url, .. } if url.as_str() == "gopher://example.test/0/good.txt")
        );
    }

    #[test]
    fn empty_menu_yields_no_blocks() {
        let base = url("gopher://example.test/");
        let blocks = parse_body(&resp("application/gopher-menu", b""), &base);
        assert!(blocks.is_empty());
    }

    #[test]
    fn oversized_body_is_rejected() {
        let adapter = GopherAdapter::new();
        let policy = FetchPolicy {
            max_response_size: 10,
            ..Default::default()
        };
        let err = adapter.helper.enforce_size(&policy, 100).unwrap_err();
        assert_eq!(err.code(), "SIZE_LIMIT_EXCEEDED");
    }

    #[test]
    fn text_file_becomes_paragraph() {
        let base = url("gopher://example.test/0/readme.txt");
        let blocks = parse_body(&resp("text/plain", b"hello world"), &base);
        assert_eq!(
            blocks,
            vec![Block::Paragraph(Span {
                runs: vec![SpanRun {
                    text: "hello world".to_string(),
                    style: Default::default(),
                    link: None,
                }],
            })]
        );
    }

    #[test]
    fn binary_becomes_raw_block() {
        let base = url("gopher://example.test/9/blob");
        let blocks = parse_body(&resp("application/octet-stream", b"\x00\x01\x02"), &base);
        assert_eq!(
            blocks,
            vec![Block::Raw {
                mime: "application/octet-stream".to_string(),
                bytes: vec![0, 1, 2],
            }]
        );
    }

    #[test]
    fn url_item_uses_target_verbatim() {
        let body = "hExternal\tURL:https://example.test/\t.\t70\r\n";
        let base = url("gopher://example.test/");
        let blocks = parse_body(&resp("application/gopher-menu", body.as_bytes()), &base);
        assert!(
            matches!(&blocks[0], Block::Link { url, .. } if url.as_str() == "https://example.test/")
        );
    }

    #[test]
    fn scheme_and_capabilities_are_exported() {
        let adapter = GopherAdapter::new();
        assert_eq!(adapter.scheme(), "gopher");
        assert!(adapter.capabilities().supports_fetch);
        assert!(!adapter.capabilities().needs_tls);
    }

    #[tokio::test]
    async fn missing_host_is_invalid_url() {
        let adapter = GopherAdapter::new();
        let policy = FetchPolicy {
            block_private_network: false,
            ..Default::default()
        };
        let c = ctx(&policy);
        let err = adapter.fetch(&url("gopher:///0/x"), &c).await.unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
    }

    #[test]
    fn client_errors_map() {
        assert_eq!(
            map_client_error(ClientError::BadUrl("b".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::Connect("c".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Io("i".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::BadPlusHeader("p".into())).code(),
            "INVALID_RESPONSE"
        );
        assert_eq!(
            map_client_error(ClientError::PlusError("e".into())).code(),
            "PROTOCOL_ERROR"
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
