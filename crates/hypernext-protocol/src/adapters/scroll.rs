//! Scroll adapter — wraps `scroll-protocol`, the TLS-only smolweb protocol
//! with language negotiation, document metadata, and UDC classification.
//!
//! `scroll://` documents are **scrolltext** (`text/scroll`), a richer cousin
//! of gemtext: five heading levels, nested quotes and lists, tagged code
//! blocks, input links, link relations, and inline strong/emphasis/code. This
//! adapter renders scrolltext into normalized [`Block`]s (Phase 2,
//! `docs/phases/02-smolnet-protocols.md` §3.5).
//!
//! **SSRF (invariant #8):** the crate's `fetch` dials `TcpStream::connect`
//! itself, so the adapter runs `FetchPolicy::check_url` BEFORE calling it —
//! the SSRF gate is the pre-connect check.
//!
//! **Cancellation:** the crate reads to EOF with no timeout, so the adapter
//! wraps the call in `tokio::select!` with the `FetchContext::cancel` token.
//!
//! **Size limits:** the response body is checked against
//! `FetchPolicy::max_response_size` after the read.
//!
//! **TOFU:** the crate's `fetch` rides `gemini_protocol::tofu_connect`, which
//! uses the process-wide `TofuStore` (shared with the Gemini adapter). The
//! adapter does not re-implement pinning; it relies on the crate's seam.

use async_trait::async_trait;
use hypernext_core::{Block, HypernextError, PageDoc, Span, SpanRun, SpanStyle};
use url::Url;

use crate::adapters::tcp_helper::{first_heading, span, TcpProtocolHelper};
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Scroll's well-known port.
pub const SCROLL_PORT: u16 = 5699;

/// The BCP47 language tags this client advertises, most preferred first.
const LANGUAGES: &[&str] = &["en"];

/// A scroll adapter. Stateless; holds no resources between fetches.
pub struct ScrollAdapter;

impl ScrollAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ScrollAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Protocol for ScrollAdapter {
    fn scheme(&self) -> &'static str {
        "scroll"
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
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it
        // across `.await` would make the async-trait future `!Send`.
        let helper = TcpProtocolHelper::new();
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("scroll URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(SCROLL_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        helper.check_url(policy, &host, port).await?;

        let iri = url.as_str().to_string();
        let response = helper
            .select_cancel(&cancel, async {
                scroll_protocol::fetch(&iri, LANGUAGES, false)
                    .await
                    .map_err(map_client_error)
            })
            .await?;

        helper.enforce_size(policy, response.body.len())?;

        self.handle_response(url, &response)
    }
}

impl ScrollAdapter {
    /// Map a scroll response to a `PageDoc` or error by status class.
    fn handle_response(
        &self,
        url: &Url,
        response: &scroll_protocol::Response,
    ) -> Result<PageDoc, HypernextError> {
        let helper = TcpProtocolHelper::new();
        match &response.header {
            scroll_protocol::Header::Success(header) => {
                let body = String::from_utf8_lossy(&response.body);
                let blocks = scrolltext_to_blocks(&body, url);
                let title = first_heading(&blocks);
                Ok(helper.doc(
                    url,
                    url.clone(),
                    blocks,
                    title,
                    "GET",
                    Some(header.mimetype.clone()),
                    Some(response.body.len() as u64),
                ))
            }
            scroll_protocol::Header::Meta { code, status, meta } => match status {
                scroll_protocol::Status::Input => {
                    // 1x: the server wants input; `meta` is the prompt.
                    Ok(helper.doc(
                        url,
                        url.clone(),
                        vec![Block::Paragraph(span(meta))],
                        None,
                        "GET",
                        None,
                        None,
                    ))
                }
                scroll_protocol::Status::Redirect => {
                    // 3x: `meta` is the target. The Dispatcher follows the chain.
                    let target =
                        Url::parse(meta).map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                    Ok(helper.doc(url, target, Vec::new(), None, "GET", None, None))
                }
                scroll_protocol::Status::TemporaryFailure => Err(HypernextError::Protocol(
                    format!("scroll temporary failure {code}: {meta}"),
                )),
                scroll_protocol::Status::PermanentFailure => Err(HypernextError::Protocol(
                    format!("scroll permanent failure {code}: {meta}"),
                )),
                scroll_protocol::Status::CertificateRequired => {
                    Err(HypernextError::Unauthorized(format!(
                        "client certificate required for {}",
                        url.host_str().unwrap_or("")
                    )))
                }
                scroll_protocol::Status::Success => {
                    // Unreachable: a Success header is the other arm.
                    Err(HypernextError::Protocol("unexpected success".to_string()))
                }
            },
        }
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: scroll_protocol::ClientError) -> HypernextError {
    match e {
        scroll_protocol::ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        scroll_protocol::ClientError::Connect(m) => {
            HypernextError::Network(format!("connect: {m}"))
        }
        scroll_protocol::ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
        scroll_protocol::ClientError::Protocol(m) => HypernextError::Protocol(m),
        scroll_protocol::ClientError::CertificateChanged { host, .. } => {
            HypernextError::TofuCertChanged(host)
        }
    }
}

/// Convert a scrolltext body into normalized `Block`s.
///
/// Consecutive text lines group into a single paragraph; list items group into
/// a list; quotes group into a quote; headings, links, input links, code
/// blocks, and thematic breaks map directly. Inline markup is preserved via
/// the crate's `spans` pass.
fn scrolltext_to_blocks(body: &str, base: &Url) -> Vec<Block> {
    use scroll_protocol::scrolltext::ScrollLine;

    let lines = scroll_protocol::scrolltext::parse(body);
    let mut blocks = Vec::new();
    let mut para: Vec<String> = Vec::new();
    let mut list: Vec<Span> = Vec::new();
    let mut quote: Vec<String> = Vec::new();

    for line in lines {
        match line {
            ScrollLine::Text(t) => {
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                para.push(t);
            }
            ScrollLine::ListItem { text, .. } => {
                flush_para(&mut para, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                list.push(inline_span(&text));
            }
            ScrollLine::Quote { text, .. } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                quote.push(text);
            }
            ScrollLine::Heading { level, text } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Heading {
                    level,
                    text,
                    id: None,
                });
            }
            ScrollLine::Link { url, label, .. } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Link {
                    url: resolve_link(&url, base),
                    text: inline_span(&label),
                });
            }
            ScrollLine::InputLink { url, prompt } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Link {
                    url: resolve_link(&url, base),
                    text: inline_span(&prompt),
                });
            }
            ScrollLine::ThematicBreak => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Separator);
            }
            ScrollLine::CodeBlock { tag, lines } => {
                flush_para(&mut para, &mut blocks);
                flush_list(&mut list, &mut blocks);
                flush_quote(&mut quote, &mut blocks);
                blocks.push(Block::Code {
                    language: tag,
                    text: lines.join("\n"),
                });
            }
            ScrollLine::Blank => {
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
        // Inline markup never crosses lines, so style each line and merge.
        let mut runs = Vec::new();
        for (i, line) in para.iter().enumerate() {
            if i > 0 {
                runs.push(SpanRun {
                    text: "\n".to_string(),
                    style: SpanStyle::default(),
                    link: None,
                });
            }
            runs.extend(inline_span(line).runs);
        }
        blocks.push(Block::Paragraph(Span { runs }));
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

/// Resolve a scroll link (possibly relative) against the base URL.
fn resolve_link(url: &str, base: &Url) -> Url {
    base.join(url).unwrap_or_else(|_| base.clone())
}

/// Convert a line's inline markup into a `Span` with styled runs.
fn inline_span(line: &str) -> Span {
    use scroll_protocol::scrolltext::SpanKind;
    let runs = scroll_protocol::scrolltext::spans(line)
        .into_iter()
        .map(|s| SpanRun {
            text: s.text,
            style: match s.kind {
                SpanKind::Plain => SpanStyle::default(),
                SpanKind::Strong => SpanStyle {
                    bold: true,
                    ..Default::default()
                },
                SpanKind::Emphasis => SpanStyle {
                    italic: true,
                    ..Default::default()
                },
                SpanKind::Code => SpanStyle {
                    code: true,
                    ..Default::default()
                },
            },
            link: None,
        })
        .collect();
    Span { runs }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;
    use pretty_assertions::assert_eq;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn success(code: u8, mimetype: &str, body: &[u8]) -> scroll_protocol::Response {
        scroll_protocol::Response {
            header: scroll_protocol::Header::Success(scroll_protocol::SuccessHeader {
                code,
                mimetype: mimetype.to_string(),
                author: None,
                published: None,
                modified: None,
            }),
            body: body.to_vec(),
        }
    }

    fn meta(code: u8, status: scroll_protocol::Status, m: &str) -> scroll_protocol::Response {
        scroll_protocol::Response {
            header: scroll_protocol::Header::Meta {
                code,
                status,
                meta: m.to_string(),
            },
            body: Vec::new(),
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
    fn happy_path_parses_scrolltext() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(&u, &success(20, "text/scroll", b"# Title\n\nSome text.\n"))
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
    fn lists_quotes_and_code_parse() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(
                &u,
                &success(
                    20,
                    "text/scroll",
                    b"* one\n* two\n\n> a quote\n\n```rust\nfn main() {}\n```\n",
                ),
            )
            .unwrap();
        assert!(doc
            .blocks
            .iter()
            .any(|b| matches!(b, Block::List { items, .. } if items.len() == 2)));
        assert!(doc.blocks.iter().any(|b| matches!(b, Block::Quote(_))));
        assert!(doc
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Code { language: Some(l), text } if l == "rust" && text == "fn main() {}")));
    }

    #[test]
    fn inline_markup_becomes_styled_runs() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(
                &u,
                &success(20, "text/scroll", b"a *strong* and _em_ and `code`\n"),
            )
            .unwrap();
        if let Block::Paragraph(s) = &doc.blocks[0] {
            let bold = s.runs.iter().find(|r| r.style.bold);
            assert!(bold.is_some(), "strong run present");
            let italic = s.runs.iter().find(|r| r.style.italic);
            assert!(italic.is_some(), "emphasis run present");
            let code = s.runs.iter().find(|r| r.style.code);
            assert!(code.is_some(), "code run present");
        } else {
            panic!("expected a paragraph");
        }
    }

    #[test]
    fn redirect_sets_final_url() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(
                &u,
                &meta(
                    31,
                    scroll_protocol::Status::Redirect,
                    "scroll://example.net/moved",
                ),
            )
            .unwrap();
        assert_eq!(doc.final_url, url("scroll://example.net/moved"));
        assert!(doc.blocks.is_empty());
    }

    #[test]
    fn input_status_carries_prompt() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(&u, &meta(11, scroll_protocol::Status::Input, "Passphrase?"))
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("Passphrase?"))]);
    }

    #[test]
    fn failure_statuses_are_protocol_errors() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let err = adapter
            .handle_response(
                &u,
                &meta(44, scroll_protocol::Status::TemporaryFailure, "slow down"),
            )
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
        let err = adapter
            .handle_response(
                &u,
                &meta(51, scroll_protocol::Status::PermanentFailure, "gone"),
            )
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn certificate_required_is_unauthorized() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let err = adapter
            .handle_response(
                &u,
                &meta(60, scroll_protocol::Status::CertificateRequired, "cert"),
            )
            .unwrap_err();
        assert_eq!(err.code(), "UNAUTHORIZED");
    }

    #[test]
    fn empty_body_yields_no_blocks() {
        let adapter = ScrollAdapter::new();
        let u = url("scroll://example.net/");
        let doc = adapter
            .handle_response(&u, &success(20, "text/scroll", b""))
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
        let base = url("scroll://example.net/dir/page");
        let blocks = scrolltext_to_blocks("=> /other A", &base);
        assert_eq!(
            blocks,
            vec![Block::Link {
                url: url("scroll://example.net/other"),
                text: inline_span("A"),
            }]
        );
    }

    #[test]
    fn input_links_and_thematic_breaks_parse() {
        let base = url("scroll://example.net/");
        let blocks = scrolltext_to_blocks(
            "=: scroll://example.net/search Search terms\n\n---\n",
            &base,
        );
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Link { url, .. } if url.as_str() == "scroll://example.net/search")));
        assert!(blocks.iter().any(|b| matches!(b, Block::Separator)));
    }

    #[test]
    fn multi_line_paragraph_joins_with_newline_runs() {
        let base = url("scroll://example.net/");
        let blocks = scrolltext_to_blocks("line one\nline two\n", &base);
        if let Block::Paragraph(s) = &blocks[0] {
            let text: String = s.runs.iter().map(|r| r.text.as_str()).collect();
            assert_eq!(text, "line one\nline two");
        } else {
            panic!("expected a paragraph");
        }
    }

    #[test]
    fn client_errors_map_to_hypernext_errors() {
        assert_eq!(
            map_client_error(scroll_protocol::ClientError::BadUrl("bad".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(scroll_protocol::ClientError::Connect("c".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(scroll_protocol::ClientError::Io("io".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(scroll_protocol::ClientError::Protocol("p".into())).code(),
            "PROTOCOL_ERROR"
        );
        assert_eq!(
            map_client_error(scroll_protocol::ClientError::CertificateChanged {
                host: "h".into(),
                pinned: "p".into(),
                seen: "s".into(),
            })
            .code(),
            "TOFU_CERT_CHANGED"
        );
    }

    #[test]
    fn adapter_identity_and_capabilities() {
        let adapter = ScrollAdapter::new();
        assert_eq!(adapter.scheme(), "scroll");
        let caps = adapter.capabilities();
        assert!(caps.supports_fetch);
        assert!(caps.needs_tls);
        assert!(caps.needs_tofu);
        let defaulted = ScrollAdapter::default();
        assert_eq!(defaulted.scheme(), "scroll");
    }

    #[tokio::test]
    async fn url_without_host_is_invalid() {
        let adapter = ScrollAdapter::new();
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let err = adapter.fetch(&url("scroll:///path"), &c).await.unwrap_err();
        assert_eq!(err.code(), "INVALID_URL");
    }
}
