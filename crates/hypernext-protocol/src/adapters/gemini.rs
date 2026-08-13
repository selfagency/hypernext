//! Gemini adapter — the reference implementation every other protocol follows.
//!
//! Wraps `gemini-protocol`'s public API (the `client` module) behind the
//! [`Protocol`] trait. This adapter owns:
//!
//! - **TOFU**: the leaf certificate's SHA-256 is pinned in the `tofu_certs`
//!   table on first contact; a later visit presenting a different certificate
//!   fails with [`HypernextError::TofuCertChanged`] before any request byte is
//!   sent (Phase 2, `docs/phases/02-smolnet-protocols.md` §3.4).
//! - **Status handling**: all six Gemini status classes map to a `PageDoc` or
//!   a `HypernextError`.
//! - **Body parsing**: `text/gemini` → gemtext → `Vec<Block>`, `text/plain` →
//!   a single paragraph, `text/markdown` → comrak → `Vec<Block>`, anything else
//!   → `Block::Raw`.
//! - **SSRF defense** (invariant #8): `FetchPolicy::check_url` runs before the
//!   TCP dial and blocks private / loopback networks when configured.
//! - **Cancellation** (ADR 0008): the connect and exchange are wrapped in
//!   `tokio::select!` against `FetchContext::cancel`.
//!
//! The `gemini-protocol` crate's own `tofu_connect` uses a process-wide
//! `TofuStore`; this adapter instead drives the pinning handshake directly so
//! pins live in the per-call `FetchContext::store` connection (the `tofu_certs`
//! table), matching the single-process architecture (ADR 0003).

use std::collections::HashMap;

use async_trait::async_trait;
use gemini_protocol::client::{ClientError, Response, Status, parse_response};
use gemini_protocol::gemtext::GemLine;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HttpResponseDebug, HypernextError, Metadata, PageDoc, Span,
    SpanRun, SpanStyle,
};
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::dispatcher::{Capabilities, FetchContext, Protocol, VettedTarget};

use super::tofu;

/// Gemini's well-known port.
const DEFAULT_PORT: u16 = 1965;

/// The Gemini adapter. Stateless: TOFU pins and client-cert state live in the
/// store / keychain, so a single unit serves every fetch.
#[derive(Debug, Default)]
pub struct GeminiAdapter;

impl GeminiAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Connect with TOFU pinning, then run the exchange, honoring the cancel
    /// token around both phases.
    async fn request(&self, url: &Url, ctx: &FetchContext<'_>) -> Result<Response, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it across
        // `.await` would make the async-trait future `!Send`. `ctx` is used
        // only in the synchronous TOFU lookup / pin sections below.
        let policy = ctx.policy;

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("gemini URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(DEFAULT_PORT);

        // SSRF gate before dialing (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        // Synchronous TOFU lookup (no await while holding `ctx`).
        let pinned = tofu::lookup_pin(&vetted.host, ctx)?;
        let (connector, seen) = tofu::pinning_connector(pinned);

        let cancel = ctx.cancel.clone();
        let mut stream = tofu_connect(&vetted, &connector, &seen, pinned, cancel).await?;

        // Clean first contact: pin the fingerprint and store the leaf DER
        // (synchronous, after the awaits complete).
        if pinned.is_none()
            && let Some(seen) = seen.lock().unwrap().take()
        {
            tofu::store_pin(&vetted.host, seen.fingerprint, &seen.der, ctx)?;
        }

        let exchange = exchange_capped(url, &mut stream, policy.max_response_size);
        let cancel = ctx.cancel.clone();
        let response = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = exchange => r?,
        };
        Ok(response)
    }

    /// Map a Gemini response to a `PageDoc` or error by status class.
    fn handle_response(&self, url: &Url, response: &Response) -> Result<PageDoc, HypernextError> {
        match response.status {
            Status::Input => {
                // 1x: the server wants input; `meta` is the prompt.
                let prompt = response.meta.clone();
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
                // 3x: `meta` is the target. The Dispatcher follows the chain.
                let target = Url::parse(&response.meta)
                    .map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                Ok(self.doc(url, target, Vec::new(), None, response))
            }
            Status::TemporaryFailure => Err(HypernextError::Protocol(format!(
                "temporary failure {}: {}",
                response.code, response.meta
            ))),
            Status::PermanentFailure => Err(HypernextError::Protocol(format!(
                "permanent failure {}: {}",
                response.code, response.meta
            ))),
            Status::CertificateRequired => Err(HypernextError::Unauthorized(format!(
                "client certificate required for {}",
                url.host_str().unwrap_or("")
            ))),
        }
    }

    /// Parse a successful body by MIME type into `Vec<Block>`.
    fn parse_body(&self, response: &Response, url: &Url) -> Result<Vec<Block>, HypernextError> {
        let mime = response.mime().unwrap_or("").to_string();
        let body = String::from_utf8_lossy(&response.body);
        match mime.as_str() {
            "text/gemini" => Ok(gemtext_to_blocks(&body, url)),
            "text/plain" => Ok(vec![Block::Paragraph(span(&body))]),
            "text/markdown" => Ok(markdown_to_blocks(&body, url)),
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
        response: &Response,
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
                    status: response.code as u16,
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
impl Protocol for GeminiAdapter {
    fn scheme(&self) -> &'static str {
        "gemini"
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
        let response = self.request(url, ctx).await?;
        self.handle_response(url, &response)
    }
}

// ── TOFU TLS connect ─────────────────────────────────────────────────────────

/// Dial the peer and run the TOFU-pinned TLS handshake, honoring the cancel
/// token. This is split out of `GeminiAdapter::request` so that method's
/// cyclomatic complexity stays under the gate; behaviour is unchanged (the
/// certificate-change check precedes the generic TLS error, matching `request`).
///
/// `seen` records what the handshake observed, for the caller to pin on first
/// contact or to cross-check against the pinned fingerprint here.
async fn tofu_connect(
    vetted: &VettedTarget,
    connector: &TlsConnector,
    seen: &tofu::SeenCell,
    pinned: Option<[u8; 32]>,
    cancel: CancellationToken,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, HypernextError> {
    let tcp = TcpStream::connect((vetted.host.as_str(), vetted.port))
        .await
        .map_err(|e| {
            HypernextError::Network(format!("tcp {}:{}: {e}", vetted.host, vetted.port))
        })?;
    let server_name = ServerName::try_from(vetted.host.clone())
        .map_err(|e| HypernextError::Network(format!("server name {}: {e}", vetted.host)))?;

    let connect = connector.connect(server_name, tcp);
    tokio::select! {
        _ = cancel.cancelled() => Err(HypernextError::Cancelled),
        r = connect => match r {
            Ok(tls) => Ok(tls),
            Err(e) => {
                let observed = seen.lock().unwrap().clone();
                if let (Some(pinned), Some(observed)) = (pinned, observed)
                    && pinned != observed.fingerprint
                {
                    return Err(HypernextError::TofuCertChanged(format!(
                        "certificate for {} changed: pinned {}, saw {}",
                        vetted.host,
                        tofu::hex(&pinned),
                        tofu::hex(&observed.fingerprint)
                    )));
                }
                Err(HypernextError::Network(format!("tls handshake: {e}")))
            }
        },
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        ClientError::Connect(m) => HypernextError::Network(m),
        ClientError::Io(m) => HypernextError::Network(m),
        ClientError::Protocol(m) => HypernextError::Protocol(m),
        ClientError::CertificateChanged { host, .. } => HypernextError::TofuCertChanged(host),
    }
}

// ── Exchange with a size cap ───────────────────────────────────────────────

/// Run a Gemini request/response over a connected stream, capping the body at
/// `max` bytes. The crate's `exchange` reads to EOF unbounded; this variant
/// enforces `FetchPolicy::max_response_size` during the read.
async fn exchange_capped<S>(
    url: &Url,
    stream: &mut S,
    max: usize,
) -> Result<Response, HypernextError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = format!("{url}\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| HypernextError::Network(format!("write request: {e}")))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| HypernextError::Network(format!("read response: {e}")))?;
        if n == 0 {
            break;
        }
        if raw.len() + n > max {
            return Err(HypernextError::SizeLimitExceeded(max));
        }
        raw.extend_from_slice(&buf[..n]);
    }

    parse_response(&raw).map_err(map_client_error)
}

// ── Body parsing ─────────────────────────────────────────────────────────────

/// Convert gemtext lines into normalized `Block`s, grouping consecutive text /
/// list / quote lines into single blocks.
///
/// `pub(crate)` so the Spartan and Nex adapters (which also speak gemtext)
/// reuse the same parser (Phase 2, `docs/phases/02-smolnet-protocols.md` §3.5).
pub(crate) fn gemtext_to_blocks(body: &str, base: &Url) -> Vec<Block> {
    let lines = gemini_protocol::parse_gemtext(body);
    let mut blocks = Vec::new();
    let mut para: Vec<String> = Vec::new();
    let mut list: Vec<Span> = Vec::new();
    let mut quote: Vec<String> = Vec::new();

    for line in lines {
        match line {
            GemLine::Text(t) => {
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                para.push(t);
            }
            GemLine::Item(t) => {
                flush_para(&mut para, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                list.push(span(&t));
            }
            GemLine::Quote(t) => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                quote.push(t);
            }
            GemLine::Heading { level, text } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Heading {
                    level,
                    text,
                    id: None,
                });
            }
            GemLine::Link { url, label } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Link {
                    url: resolve_link(&url, base),
                    text: span(&label),
                });
            }
            GemLine::Pre { alt, text } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Code {
                    language: alt,
                    text,
                });
            }
            GemLine::Blank => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
            }
        }
    }
    flush_para(&mut para, &mut blocks);
    flush_list(&mut list, &mut blocks);
    flush_quote(&mut quote, &mut blocks);
    blocks
}

fn flush_para(para: &mut Vec<String>, blocks: &mut Vec<Block>) {
    if !para.is_empty() {
        blocks.push(Block::Paragraph(span(&para.join("\n"))));
        para.clear();
    }
}

fn flush_list(list: &mut Vec<Span>, blocks: &mut Vec<Block>) {
    if !list.is_empty() {
        blocks.push(Block::List {
            ordered: false,
            items: std::mem::take(list),
        });
    }
}

fn flush_quote(quote: &mut Vec<String>, blocks: &mut Vec<Block>) {
    if !quote.is_empty() {
        blocks.push(Block::Quote(span(&quote.join("\n"))));
        quote.clear();
    }
}

/// Resolve a gemini link (possibly relative) against the base URL.
fn resolve_link(url: &str, base: &Url) -> Url {
    base.join(url).unwrap_or_else(|_| base.clone())
}

/// Convert a markdown body into normalized `Block`s via comrak.
///
/// `pub(crate)` so the Kepler adapter (whose body may be `text/markdown`)
/// reuses the same parser (Phase 2 §3.5).
pub(crate) fn markdown_to_blocks(body: &str, base: &Url) -> Vec<Block> {
    let arena = comrak::Arena::new();
    let root = comrak::parse_document(&arena, body, &comrak::Options::default());
    let mut blocks = Vec::new();
    walk_md(root, base, &mut blocks);
    blocks
}

fn walk_md<'a>(node: &'a comrak::nodes::AstNode<'a>, base: &Url, blocks: &mut Vec<Block>) {
    use comrak::nodes::{ListType, NodeValue};
    match &node.data.borrow().value {
        NodeValue::Heading(h) => {
            blocks.push(Block::Heading {
                level: h.level,
                text: plain_text(node),
                id: None,
            });
        }
        NodeValue::Paragraph => {
            let text = plain_text(node);
            if !text.is_empty() {
                blocks.push(Block::Paragraph(span(&text)));
            }
        }
        NodeValue::List(l) => {
            let items = node
                .children()
                .filter(|c| matches!(c.data.borrow().value, NodeValue::Item(_)))
                .map(|c| span(&plain_text(c)))
                .collect();
            blocks.push(Block::List {
                ordered: matches!(l.list_type, ListType::Ordered),
                items,
            });
        }
        NodeValue::BlockQuote => {
            blocks.push(Block::Quote(span(&plain_text(node))));
        }
        NodeValue::CodeBlock(c) => {
            let language = c.info.split_whitespace().next().map(|s| s.to_string());
            blocks.push(Block::Code {
                language,
                text: c.literal.clone(),
            });
        }
        NodeValue::ThematicBreak => blocks.push(Block::Separator),
        NodeValue::Link(l) => {
            blocks.push(Block::Link {
                url: resolve_link(&l.url, base),
                text: span(&plain_text(node)),
            });
        }
        NodeValue::Image(l) => {
            blocks.push(Block::Image {
                url: resolve_link(&l.url, base),
                alt: None,
                caption: None,
            });
        }
        _ => {
            for child in node.children() {
                walk_md(child, base, blocks);
            }
        }
    }
}

fn plain_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
    use comrak::nodes::NodeValue;
    let mut out = String::new();
    fn collect<'a>(node: &'a comrak::nodes::AstNode<'a>, out: &mut String) {
        match &node.data.borrow().value {
            NodeValue::Text(literal) => out.push_str(literal),
            NodeValue::Code(c) => out.push_str(&c.literal),
            NodeValue::SoftBreak | NodeValue::LineBreak => out.push(' '),
            _ => {
                for child in node.children() {
                    collect(child, out);
                }
            }
        }
    }
    collect(node, &mut out);
    out
}

// ── Small helpers ──────────────────────────────────────────────────────────

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
    use pretty_assertions::assert_eq;
    use std::sync::Mutex;
    use std::time::Duration;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn ctx(policy: &FetchPolicy) -> FetchContext<'_> {
        let client = Box::leak(Box::new(reqwest::Client::new()));
        let store = Box::leak(Box::new(Mutex::new(
            hypernext_store::db::open_in_memory().unwrap(),
        )));
        FetchContext {
            http_client: client,
            cancel: tokio_util::sync::CancellationToken::new(),
            incognito: false,
            policy,
            store,
        }
    }

    fn resp(status: Status, code: u8, meta: &str, body: &[u8]) -> Response {
        Response {
            status,
            code,
            meta: meta.to_string(),
            body: body.to_vec(),
        }
    }

    #[test]
    fn parses_all_six_status_classes() {
        let adapter = GeminiAdapter::new();
        let u = url("gemini://example.com/");

        let doc = adapter
            .handle_response(&u, &resp(Status::Input, 10, "Enter name", b""))
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("Enter name"))]);

        let doc = adapter
            .handle_response(&u, &resp(Status::Success, 20, "text/plain", b"hi"))
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("hi"))]);

        let doc = adapter
            .handle_response(&u, &resp(Status::Redirect, 31, "gemini://other/", b""))
            .unwrap();
        assert_eq!(doc.final_url, url("gemini://other/"));

        let err = adapter
            .handle_response(&u, &resp(Status::TemporaryFailure, 44, "slow down", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");

        let err = adapter
            .handle_response(&u, &resp(Status::PermanentFailure, 51, "not found", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");

        let err = adapter
            .handle_response(&u, &resp(Status::CertificateRequired, 60, "cert", b""))
            .unwrap_err();
        assert_eq!(err.code(), "UNAUTHORIZED");
    }

    #[test]
    fn gemtext_conversion_matches_fixture() {
        let body = "# Title\n\nSome paragraph text.\n\n=> gemini://example.com/ A link\n\n* one\n* two\n\n> a quote\n\n```rust\nfn main() {}\n```\n";
        let base = url("gemini://example.com/");
        let blocks = gemtext_to_blocks(body, &base);
        let expected = vec![
            Block::Heading {
                level: 1,
                text: "Title".to_string(),
                id: None,
            },
            Block::Paragraph(span("Some paragraph text.")),
            Block::Link {
                url: url("gemini://example.com/"),
                text: span("A link"),
            },
            Block::List {
                ordered: false,
                items: vec![span("one"), span("two")],
            },
            Block::Quote(span("a quote")),
            Block::Code {
                language: Some("rust".to_string()),
                text: "fn main() {}\n".to_string(),
            },
        ];
        assert_eq!(blocks, expected);
    }

    #[test]
    fn relative_link_resolves_against_base() {
        let base = url("gemini://example.com/dir/page");
        let blocks = gemtext_to_blocks("=> /other A", &base);
        assert_eq!(
            blocks,
            vec![Block::Link {
                url: url("gemini://example.com/other"),
                text: span("A"),
            }]
        );
    }

    #[test]
    fn markdown_parses_to_blocks() {
        let base = url("gemini://example.com/");
        let blocks = markdown_to_blocks("# Hi\n\nSome **bold** text.\n\n- a\n- b\n", &base);
        assert!(
            blocks
                .iter()
                .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Hi"))
        );
        assert!(blocks.iter().any(|b| matches!(b, Block::Paragraph(_))));
        assert!(
            blocks.iter().any(
                |b| matches!(b, Block::List { ordered: false, items, .. } if items.len() == 2)
            )
        );
    }

    #[test]
    fn unknown_mime_becomes_raw_block() {
        let adapter = GeminiAdapter::new();
        let u = url("gemini://example.com/");
        let doc = adapter
            .handle_response(&u, &resp(Status::Success, 20, "image/png", b"\x89PNG"))
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
    fn tofu_first_contact_pins_then_matching_succeeds() {
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let host = "example.com";

        assert!(tofu::lookup_pin(host, &c).unwrap().is_none());
        let fp = [7u8; 32];
        tofu::store_pin(host, fp, b"der", &c).unwrap();
        assert_eq!(tofu::lookup_pin(host, &c).unwrap(), Some(fp));
    }

    #[test]
    fn tofu_changed_cert_is_detected() {
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let host = "example.com";
        tofu::store_pin(host, [1u8; 32], b"old", &c).unwrap();
        let pinned = tofu::lookup_pin(host, &c).unwrap().unwrap();
        assert_ne!(pinned, [2u8; 32]);
    }

    #[test]
    fn size_limit_policy_is_wired() {
        let policy = FetchPolicy {
            max_response_size: 10,
            ..Default::default()
        };
        let body = vec![b'x'; 100];
        let raw = format!("20 text/plain\r\n{}", String::from_utf8_lossy(&body));
        let response = parse_response(raw.as_bytes()).unwrap();
        assert!(response.body.len() > policy.max_response_size);
        assert_eq!(policy.max_response_size, 10);
    }

    #[test]
    fn fingerprint_hex_round_trips() {
        let mut fp = [0u8; 32];
        fp[0] = 0xde;
        fp[1] = 0xad;
        fp[2] = 0xbe;
        fp[3] = 0xef;
        let h = tofu::hex(&fp);
        assert_eq!(h.len(), 64);
        assert_eq!(tofu::hex_to_bytes(&h).unwrap(), fp);
        assert!(tofu::hex_to_bytes("short").is_err());
    }

    #[test]
    fn timeout_is_configured() {
        let policy = FetchPolicy::default();
        assert_eq!(policy.timeout, Duration::from_secs(30));
    }
}
