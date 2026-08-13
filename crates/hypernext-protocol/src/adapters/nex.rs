//! Nex adapter (plaintext TCP, `=>` link lines).
//!
//! Wraps `nex-protocol`'s `fetch` behind the [`Protocol`] trait. Nex has no
//! status codes or headers: the server sends text or binary data and closes
//! the connection. Directory content is plain text where each line beginning
//! `=> ` is a link; a document's display type follows its file extension,
//! defaulting to plain text. Directory listings parse through the crate's
//! `parse_listing`; gemtext bodies parse through the shared gemtext parser.
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
use nex_protocol::{ClientError, FetchOptions, fetch, parse_listing};
use url::Url;

use crate::adapters::gemini::gemtext_to_blocks;
use crate::adapters::tcp_helper::{TcpProtocolHelper, first_heading, span};
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Nex's default port.
pub const NEX_PORT: u16 = 1900;

/// The Nex adapter. Stateless; holds no resources between fetches.
#[derive(Debug, Default)]
pub struct NexAdapter {
    helper: TcpProtocolHelper,
}

impl NexAdapter {
    pub fn new() -> Self {
        Self {
            helper: TcpProtocolHelper::new(),
        }
    }
}

#[async_trait]
impl Protocol for NexAdapter {
    fn scheme(&self) -> &'static str {
        "nex"
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
            .ok_or_else(|| HypernextError::InvalidUrl("nex URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(NEX_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        let vetted = self.helper.check_url(policy, &host, port).await?;

        let options = FetchOptions {
            max_body: policy.max_response_size,
            ..Default::default()
        };

        // Cancellation: the crate reads to EOF with no timeout, so select! on
        // the token is the only cooperative-cancel hook.
        let body = self
            .helper
            .select_cancel(&cancel, async {
                fetch(
                    &format!("nex://{}:{}{}", vetted.host, vetted.port, url.path()),
                    &options,
                )
                .await
                .map_err(map_client_error)
            })
            .await?;

        self.helper.enforce_size(policy, body.len())?;

        let blocks = parse_body(&body, url);
        let title = first_heading(&blocks);
        Ok(self.helper.doc(
            url,
            url.clone(),
            blocks,
            title,
            "GET",
            Some("text/plain".to_string()),
            Some(body.len() as u64),
        ))
    }
}

/// Map a nex reply body to `Vec<Block>`. A directory path (empty or ending in
/// `/`) parses as a listing; otherwise the body is treated as gemtext.
fn parse_body(body: &[u8], base: &Url) -> Vec<Block> {
    let text = String::from_utf8_lossy(body);
    if nex_protocol::is_directory_path(base.path()) {
        listing_to_blocks(&text, base)
    } else {
        gemtext_to_blocks(&text, base)
    }
}

/// Convert a nex directory listing into `Vec<Block>`. `=> ` link lines become
/// links; other lines become paragraphs.
fn listing_to_blocks(text: &str, base: &Url) -> Vec<Block> {
    let mut blocks = Vec::new();
    for line in parse_listing(text) {
        match line {
            nex_protocol::ListingLine::Link { url, label } => {
                let target = base.join(&url).unwrap_or_else(|_| base.clone());
                let text = label.unwrap_or_else(|| url.clone());
                blocks.push(Block::Link {
                    url: target,
                    text: span(&text),
                });
            }
            nex_protocol::ListingLine::Text(t) => {
                if !t.trim().is_empty() {
                    blocks.push(Block::Paragraph(span(&t)));
                }
            }
        }
    }
    blocks
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
        ClientError::Timeout(step) => HypernextError::Network(format!("{step} timed out")),
        ClientError::BodyTooLarge { max } => HypernextError::SizeLimitExceeded(max),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn happy_path_directory_parses_to_links() {
        let base = url("nex://example.com/");
        let body = "Welcome!\n=> nex://my-site.net\n=> about.txt About\nplain line\n";
        let blocks = parse_body(body.as_bytes(), &base);
        assert!(matches!(&blocks[0], Block::Paragraph(_)));
        assert!(
            matches!(&blocks[1], Block::Link { url, .. } if url.as_str() == "nex://my-site.net")
        );
        assert!(
            matches!(&blocks[2], Block::Link { url, .. } if url.as_str() == "nex://example.com/about.txt")
        );
        assert!(matches!(&blocks[3], Block::Paragraph(_)));
    }

    #[test]
    fn malformed_arrow_is_text_not_link() {
        let base = url("nex://example.com/");
        // "=> " with nothing after it is text, not a link.
        let blocks = parse_body(b"=> \n", &base);
        assert_eq!(blocks.len(), 1, "bare arrow is a paragraph, not a link");
        assert!(matches!(&blocks[0], Block::Paragraph(_)));
    }

    #[test]
    fn empty_directory_yields_no_blocks() {
        let base = url("nex://example.com/");
        let blocks = parse_body(b"", &base);
        assert!(blocks.is_empty());
    }

    #[test]
    fn oversized_body_is_rejected() {
        let adapter = NexAdapter::new();
        let policy = FetchPolicy {
            max_response_size: 10,
            ..Default::default()
        };
        let err = adapter.helper.enforce_size(&policy, 100).unwrap_err();
        assert_eq!(err.code(), "SIZE_LIMIT_EXCEEDED");
    }

    #[test]
    fn document_path_parses_as_gemtext() {
        let base = url("nex://example.com/page.gmi");
        let body = "# Title\n\nBody.\n";
        let blocks = parse_body(body.as_bytes(), &base);
        assert!(
            blocks
                .iter()
                .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Title"))
        );
        assert!(blocks.iter().any(|b| matches!(b, Block::Paragraph(_))));
    }

    #[test]
    fn relative_link_resolves_against_base() {
        let base = url("nex://example.com/dir/");
        let blocks = parse_body(b"=> ../other/ Up\n", &base);
        assert!(
            matches!(&blocks[0], Block::Link { url, .. } if url.as_str() == "nex://example.com/other/")
        );
    }

    #[test]
    fn scheme_and_capabilities_are_exported() {
        let adapter = NexAdapter::new();
        assert_eq!(adapter.scheme(), "nex");
        assert!(adapter.capabilities().supports_fetch);
        assert!(!adapter.capabilities().needs_tls);
    }

    #[tokio::test]
    async fn missing_host_is_invalid_url() {
        let adapter = NexAdapter::new();
        let policy = FetchPolicy {
            block_private_network: false,
            ..Default::default()
        };
        let c = ctx(&policy);
        let err = adapter.fetch(&url("nex:///"), &c).await.unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
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
