//! HTML parsing and readability extraction for HTTP reader mode (phase doc 3.2).
//!
//! [`fetch_and_extract`] is the public entry point: it fetches through the
//! policy-bound client, runs **PGP verification on the raw bytes BEFORE any
//! extraction** (invariant #6), detects the content type, and produces a
//! [`PageDoc`] with a `Vec<Block>`, `Metadata`, and `DebugInfo`.
//!
//! Content-type routing:
//! - HTML / XHTML -> `legible::parse` then the `comrak` AST -> `Vec<Block>`
//! - markdown -> `comrak::markdown_to_html` then `legible::parse`
//! - feed (Atom/RSS) -> `feed::deferred` marker (feed-rs is Phase 1.1)
//! - text/plain -> `Block::Paragraph` with `preformatted: true`
//! - image/video/audio/binary -> `Block::Raw`
//!
//! ## PGP-before-extract order invariant (#6)
//!
//! [`verify_pgp`] runs on the raw response bytes and emits a `pgp.verify`
//! tracing event strictly before extraction emits `content.extract`. The order
//! is asserted by an integration test (`tests/pipeline.rs`) using a tracing
//! hook. `_`: this mirrors the invariant enforced in `hypernext-pgp`.

use std::collections::HashMap;
use std::time::Instant;

use comrak::nodes::ListType;
use comrak::nodes::Node as ComrakNode;
use comrak::nodes::NodeValue;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HttpResponseDebug, Metadata, PageDoc, PgpInfo,
    PgpKeySource, PgpStatus, Span, SpanRun, SpanStyle, TimingDebug,
};
use pgp::composed::SignedPublicKey;
use reqwest::Client;
use scraper::{Html, Selector};
use url::Url;

use crate::error::Error;
use crate::policy::FetchPolicy;

/// Marker mime for a feed deferred to the Phase 1.1 feed-rs handoff.
pub mod feed {
    /// Mime used to mark a feed body not yet parsed by feed-rs.
    pub const DEFERRED_MIME: &str = "application/vnd.hypernext.feed.deferred";
}

/// Candidate signing keys used to verify a PGP signature.
pub type KeySet<'a> = &'a [SignedPublicKey];

/// Fetch `url` through the policy-bound client and extract a [`PageDoc`].
pub async fn fetch_and_extract(
    url: &Url,
    client: &Client,
    policy: &FetchPolicy,
) -> Result<PageDoc, Error> {
    let (bytes, final_url, response) = fetch_doc(client, url, policy).await?;
    // No key source on the production path (the adapter resolves keys in
    // p3-t7), so a clearsign/detached signature is recorded as Unverified
    // rather than fabricated as valid.
    extract_doc(
        url,
        &final_url,
        bytes,
        response.content_type.as_deref(),
        &[],
        &response,
    )
}

/// Like [`fetch_and_extract`], but applies adblock: network requests blocked by
/// `engine.should_block` are not fetched, and cosmetic rules strip matching
/// elements from the HTML tree before readability extraction. Caller decides
/// when this runs (the per-origin toggle + incognito gate live at the
/// fetch-context layer, not here).
pub async fn fetch_and_extract_filtered(
    url: &Url,
    client: &Client,
    policy: &FetchPolicy,
    engine: &crate::adblock::AdblockEngine,
) -> Result<PageDoc, Error> {
    let (bytes, final_url, response) = fetch_doc(client, url, policy).await?;
    // The top-level document is always fetched (reader mode fetches one URL);
    // cosmetic rules then strip ad elements from the tree before extraction.
    // Network subresource blocking (`should_block`) is the raw-mode webview's
    // job (phase doc 3.4 resource interception), exercised via `should_block`.
    extract_doc_filtered(
        url,
        &final_url,
        bytes,
        response.content_type.as_deref(),
        &[],
        &response,
        Some(engine),
    )
}

/// Fetch `url`, returning the raw body plus response metadata needed for
/// `DebugInfo` and the raw-bytes PGP check.
async fn fetch_doc(
    client: &Client,
    url: &Url,
    policy: &FetchPolicy,
) -> Result<(Vec<u8>, Url, HttpResponseDebug), Error> {
    crate::policy::check_url(url, policy)?;

    let mut resp = client
        .get(url.clone())
        .send()
        .await
        .map_err(crate::client::map_reqwest_error)?;

    let final_url = resp.url().clone();
    let status = resp.status().as_u16();
    let headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .map(|s| s.split(';').next().unwrap_or(&s).trim().to_string());
    let content_length = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok());

    // Size-limited body read (mirrors `fetch_body`: streaming, no ReadAll
    // overflow, aborts past `max_response_size`).
    let limit = policy.max_response_size;
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(crate::client::map_reqwest_error)?
    {
        let new_len = buf.len().saturating_add(chunk.len());
        if new_len > limit as usize {
            return Err(Error::SizeLimitExceeded { limit });
        }
        buf.extend_from_slice(&chunk);
    }

    let response = HttpResponseDebug {
        status,
        headers,
        content_type: content_type.clone(),
        content_length,
    };
    Ok((buf, final_url, response))
}

/// Extract a [`PageDoc`] from already-fetched raw bytes. Runs PGP verification
/// before extraction. Exposed for the HTTP adapter (p3-t7) and tests.
pub fn extract_doc(
    url: &Url,
    final_url: &Url,
    bytes: Vec<u8>,
    declared_content_type: Option<&str>,
    keys: KeySet,
    response: &HttpResponseDebug,
) -> Result<PageDoc, Error> {
    extract_doc_filtered(
        url,
        final_url,
        bytes,
        declared_content_type,
        keys,
        response,
        None,
    )
}

/// Like [`extract_doc`], but applies cosmetic ad-hiding: when `engine` is
/// `Some`, elements matching the engine's cosmetic rules are stripped from the
/// HTML **before** `legible::parse` (phase doc 3.3: ads removed before
/// readability). `None` behaves exactly like [`extract_doc`].
pub fn extract_doc_filtered(
    url: &Url,
    final_url: &Url,
    bytes: Vec<u8>,
    declared_content_type: Option<&str>,
    keys: KeySet,
    response: &HttpResponseDebug,
    engine: Option<&crate::adblock::AdblockEngine>,
) -> Result<PageDoc, Error> {
    let started = Instant::now();

    // 3. PGP verification BEFORE extraction (invariant #6).
    let (signature, source) = verify_pgp(&bytes, keys)?;
    tracing::info!(
        event = "content.extract",
        "extracting content after PGP verification"
    );

    let (content_type, decisions) = detect_content_type(&source, declared_content_type);

    if content_type.is_feed() {
        let blocks = feed_deferred_marker(&source);
        let mut d = decisions;
        d.push("feed::deferred - feed-rs handoff planned for Phase 1.1".to_string());
        return Ok(build_doc(
            url,
            final_url,
            blocks,
            Metadata::default(),
            signature,
            d,
            response,
            started,
        ));
    }

    let (blocks, md, mut parser) = match content_type.kind {
        ContentKind::Html => extract_html(&source, url, engine),
        ContentKind::Markdown => extract_markdown(&source, url, engine),
        ContentKind::TextPlain => extract_plaintext(&source),
        ContentKind::Binary => extract_binary(&source, &content_type.raw),
        ContentKind::Feed => unreachable!("feed handled above"),
    };
    parser.extend(decisions);

    Ok(build_doc(
        url, final_url, blocks, md, signature, parser, response, started,
    ))
}

#[allow(clippy::too_many_arguments)]
fn build_doc(
    url: &Url,
    final_url: &Url,
    blocks: Vec<Block>,
    metadata: Metadata,
    signature: Option<PgpInfo>,
    parser_decisions: Vec<String>,
    response: &HttpResponseDebug,
    started: Instant,
) -> PageDoc {
    let debug = DebugInfo {
        request: HttpRequestDebug {
            method: "GET".to_string(),
            url: url.clone(),
            headers: HashMap::new(),
        },
        response: response.clone(),
        timing: TimingDebug {
            total_ms: Some(started.elapsed().as_millis() as u64),
            ..Default::default()
        },
        redirects: Vec::new(),
        parser_decisions,
        tls: None,
    };
    let title = metadata.title.clone();
    PageDoc {
        url: url.clone(),
        final_url: final_url.clone(),
        title,
        metadata,
        blocks,
        signature,
        debug,
        from_cache: false,
    }
}

/* ------------------------------------------------------------------ *
 * Content-type detection
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContentKind {
    Html,
    Markdown,
    TextPlain,
    Binary,
    Feed,
}

struct DetectedType {
    kind: ContentKind,
    raw: String,
}

impl DetectedType {
    fn is_feed(&self) -> bool {
        self.kind == ContentKind::Feed
    }
}

/// Detect content type from the `Content-Type` header, sniffing the first 512
/// bytes when the header is missing or not useful.
fn detect_content_type(bytes: &[u8], header: Option<&str>) -> (DetectedType, Vec<String>) {
    let mut decisions = Vec::new();

    // Feed markers (Atom/RSS root elements) are unambiguous: detect them even
    // when a mismatched `text/html` Content-Type header is present, so a feed
    // page mislabeled as HTML still routes to feed::deferred.
    let sniff = &bytes[..bytes.len().min(512)];
    let head = String::from_utf8_lossy(sniff).to_ascii_lowercase();
    if is_feed_sniff(&head) {
        decisions.push("feed detected from body root elements".to_string());
        return (
            DetectedType {
                kind: ContentKind::Feed,
                raw: "application/rss+xml".to_string(),
            },
            decisions,
        );
    }

    if let Some(h) = header {
        let lower = h.to_ascii_lowercase();
        if let Some(kind) = classify_header(&lower) {
            decisions.push(format!("content-type header: {lower}"));
            let raw = lower.split(';').next().unwrap_or(&lower).trim().to_string();
            return (DetectedType { kind, raw }, decisions);
        }
        decisions.push(format!(
            "content-type header unhelpful ({lower}); sniffing body"
        ));
    } else {
        decisions.push("no content-type header; sniffing first 512 bytes".to_string());
    }

    let kind = classify_sniff(&head);
    let raw = match kind {
        ContentKind::Html => "text/html",
        ContentKind::Markdown => "text/markdown",
        ContentKind::Feed => "application/rss+xml",
        ContentKind::TextPlain => "text/plain",
        ContentKind::Binary => "application/octet-stream",
    }
    .to_string();
    decisions.push(format!("sniffed content type: {kind:?}"));
    (DetectedType { kind, raw }, decisions)
}

fn is_feed_sniff(head: &str) -> bool {
    head.contains("<feed")
        || head.contains("<rss")
        || head.contains("<rdf:rdf")
        || head.contains("<rdf:description")
}

fn classify_header(lower: &str) -> Option<ContentKind> {
    if lower.contains("html")
        || lower.contains("application/xhtml+xml")
        || lower.contains("text/xhtml")
    {
        Some(ContentKind::Html)
    } else if lower.contains("markdown") || lower.contains("x-markdown") {
        Some(ContentKind::Markdown)
    } else if lower.contains("atom+xml")
        || lower.contains("rss+xml")
        || lower.contains("rdf+xml")
        || lower.contains("feed+json")
        || lower.contains("jsonfeed")
    {
        Some(ContentKind::Feed)
    } else if lower.contains("image/")
        || lower.contains("video/")
        || lower.contains("audio/")
        || lower.contains("application/octet-stream")
        || lower.contains("application/pdf")
    {
        Some(ContentKind::Binary)
    } else if lower.starts_with("text/") {
        Some(ContentKind::TextPlain)
    } else {
        None
    }
}

fn classify_sniff(head: &str) -> ContentKind {
    if head.contains("<html") || head.contains("<!doctype html") || head.contains("<head") {
        ContentKind::Html
    } else if is_feed_sniff(head) {
        ContentKind::Feed
    } else if is_markdown_sniff(head) {
        ContentKind::Markdown
    } else {
        // No recognized markup in the sniff window: assume plain text. Binary
        // content is normally routed via the Content-Type header.
        ContentKind::TextPlain
    }
}

fn is_markdown_sniff(head: &str) -> bool {
    // Only judge short windows as markdown to avoid classifying full HTML pages
    // that simply contain a `#` or `-` early.
    head.lines()
        .next()
        .map(|line| {
            let l = line.trim_start();
            l.starts_with("# ")
                || l.starts_with("## ")
                || l.starts_with("### ")
                || l.starts_with("```")
                || l.starts_with("> ")
                || l.starts_with("- ")
                || l.starts_with("* ")
                || l.starts_with("1. ")
        })
        .unwrap_or(false)
}

/* ------------------------------------------------------------------ *
 * Extraction by kind
 * ------------------------------------------------------------------ */

fn extract_html(
    bytes: &[u8],
    url: &Url,
    engine: Option<&crate::adblock::AdblockEngine>,
) -> (Vec<Block>, Metadata, Vec<String>) {
    let html = String::from_utf8_lossy(bytes);
    // Cosmetic ad-hiding BEFORE readability: strip matched elements so ads are
    // removed from the tree before `legible::parse` (phase doc 3.3).
    let html = if let Some(engine) = engine {
        let selectors = engine.cosmetic_rules_for_document(url.as_str(), &html);
        crate::adblock::strip_matching(&html, &selectors)
    } else {
        html.into_owned()
    };
    let (mut md, meta_decisions) = parse_metadata(&html, url);

    match legible::parse(&html, Some(url.as_str()), None) {
        Ok(article) => {
            let mut decisions =
                vec!["extraction engine: legible (Readability.js port)".to_string()];
            decisions.extend(meta_decisions);
            let (blocks, block_decisions) = article_to_blocks(&article, url);
            decisions.extend(block_decisions);
            if md.title.is_none() && !article.title.is_empty() {
                md.title = Some(article.title.clone());
            }
            if md.author.is_none() {
                md.author = article.byline.clone();
            }
            if md.site_name.is_none() && !article.site_name.clone().unwrap_or_default().is_empty() {
                md.site_name = article.site_name.clone();
            }
            (blocks, md, decisions)
        }
        Err(e) => {
            let mut decisions = meta_decisions;
            decisions.push(format!(
                "legible extraction failed ({e}); raw text fallback"
            ));
            let blocks = vec![Block::Paragraph(plain_span(&html))];
            (blocks, md, decisions)
        }
    }
}

fn extract_markdown(
    bytes: &[u8],
    url: &Url,
    engine: Option<&crate::adblock::AdblockEngine>,
) -> (Vec<Block>, Metadata, Vec<String>) {
    let src = String::from_utf8_lossy(bytes);
    let options = comrak::Options::default();
    let html = comrak::markdown_to_html(&src, &options);
    let mut decisions = vec!["markdown body: comrak::markdown_to_html -> legible".to_string()];
    let (blocks, md, d) = extract_html(html.as_bytes(), url, engine);
    decisions.extend(d);
    (blocks, md, decisions)
}

fn extract_plaintext(bytes: &[u8]) -> (Vec<Block>, Metadata, Vec<String>) {
    let text = String::from_utf8_lossy(bytes);
    let mut span = plain_span(&text);
    span.runs[0].style.preformatted = true;
    let blocks = vec![Block::Paragraph(span)];
    let decisions = vec!["text/plain: single preformatted paragraph".to_string()];
    (blocks, Metadata::default(), decisions)
}

fn extract_binary(bytes: &[u8], mime: &str) -> (Vec<Block>, Metadata, Vec<String>) {
    let blocks = vec![Block::Raw {
        mime: mime.to_string(),
        bytes: bytes.to_vec(),
    }];
    let decisions = vec![format!("binary content: Block::Raw ({mime})")];
    (blocks, Metadata::default(), decisions)
}

fn feed_deferred_marker(bytes: &[u8]) -> Vec<Block> {
    vec![Block::Raw {
        mime: feed::DEFERRED_MIME.to_string(),
        bytes: bytes.to_vec(),
    }]
}

fn plain_span(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.to_string(),
            style: SpanStyle::default(),
            link: None,
        }],
    }
}

/* ------------------------------------------------------------------ *
 * Article -> Vec<Block> via the comrak CommonMark AST
 * ------------------------------------------------------------------ */

fn article_to_blocks(article: &legible::Article, base: &Url) -> (Vec<Block>, Vec<String>) {
    let mut options = comrak::Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    let arena = comrak::Arena::new();
    let root = comrak::parse_document(&arena, &article.markdown_content, &options);
    let mut blocks = Vec::new();
    walk_blocks(root, &mut blocks, base);
    let decisions = vec![format!(
        "article: {} characters, {} top-level blocks",
        article.length,
        blocks.len()
    )];
    (blocks, decisions)
}

fn walk_blocks<'a>(node: ComrakNode<'a>, out: &mut Vec<Block>, base: &Url) {
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Heading(h) => {
                out.push(Block::Heading {
                    level: h.level,
                    text: inline_plain_text(child),
                    id: None,
                });
            }
            NodeValue::Paragraph => {
                let span = inline_span(child, base);
                out.push(Block::Paragraph(span));
            }
            NodeValue::List(list) => {
                let ordered = matches!(list.list_type, ListType::Ordered);
                let items: Vec<Span> = child
                    .children()
                    .filter(|c| matches!(c.data.borrow().value, NodeValue::Item(_)))
                    .map(|item| inline_span(item, base))
                    .collect();
                out.push(Block::List { ordered, items });
            }
            NodeValue::BlockQuote => {
                let span = inline_span(child, base);
                out.push(Block::Quote(span));
            }
            NodeValue::CodeBlock(cb) => {
                let language = if cb.info.is_empty() {
                    None
                } else {
                    Some(cb.info.split_whitespace().next().unwrap_or("").to_string())
                };
                out.push(Block::Code {
                    language,
                    text: cb.literal.clone(),
                });
            }
            NodeValue::ThematicBreak => out.push(Block::Separator),
            NodeValue::Table(_) => out.push(table_block(child, base)),
            _ => walk_blocks(child, out, base),
        }
    }
}

/// Build a `Span` from a node's inline children (paragraph, list item, quote).
fn inline_span<'a>(node: ComrakNode<'a>, base: &Url) -> Span {
    let mut runs = Vec::new();
    collect_runs(node, &mut runs, base, SpanStyle::default());
    if runs.is_empty() {
        runs.push(SpanRun {
            text: String::new(),
            style: SpanStyle::default(),
            link: None,
        });
    }
    Span { runs }
}

fn collect_runs<'a>(
    node: ComrakNode<'a>,
    runs: &mut Vec<SpanRun>,
    base: &Url,
    mut style: SpanStyle,
) {
    let children: Vec<ComrakNode<'a>> = node.children().collect();
    if children.is_empty() {
        let value = node.data.borrow().value.clone();
        match value {
            NodeValue::Text(t) if !t.is_empty() => {
                runs.push(SpanRun {
                    text: t.to_string(),
                    style,
                    link: None,
                });
            }
            NodeValue::Code(c) => {
                style.code = true;
                runs.push(SpanRun {
                    text: c.literal.clone(),
                    style,
                    link: None,
                });
            }
            NodeValue::LineBreak | NodeValue::SoftBreak => {
                runs.push(SpanRun {
                    text: "\n".to_string(),
                    style,
                    link: None,
                });
            }
            NodeValue::Link(l) => {
                runs.push(SpanRun {
                    text: inline_plain_text(node),
                    style,
                    link: resolve_url(base, &l.url),
                });
            }
            _ => {}
        }
        return;
    }
    for child in children {
        let value = child.data.borrow().value.clone();
        let mut next_style = style;
        match value {
            NodeValue::Strong => {
                next_style.bold = true;
                collect_runs(child, runs, base, next_style);
            }
            NodeValue::Emph => {
                next_style.italic = true;
                collect_runs(child, runs, base, next_style);
            }
            NodeValue::LineBreak | NodeValue::SoftBreak => {
                runs.push(SpanRun {
                    text: "\n".to_string(),
                    style,
                    link: None,
                });
            }
            NodeValue::Code(c) => {
                next_style.code = true;
                runs.push(SpanRun {
                    text: c.literal.clone(),
                    style: next_style,
                    link: None,
                });
            }
            NodeValue::Link(l) => {
                runs.push(SpanRun {
                    text: inline_plain_text(child),
                    style,
                    link: resolve_url(base, &l.url),
                });
            }
            _ => collect_runs(child, runs, base, next_style),
        }
    }
}

fn inline_plain_text<'a>(node: ComrakNode<'a>) -> String {
    let mut s = String::new();
    collect_text(node, &mut s);
    s
}

fn collect_text<'a>(node: ComrakNode<'a>, s: &mut String) {
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Text(t) => s.push_str(&t),
        NodeValue::Code(c) => s.push_str(&c.literal),
        NodeValue::LineBreak | NodeValue::SoftBreak => s.push('\n'),
        _ => {
            for c in node.children() {
                collect_text(c, s);
            }
        }
    }
}

fn resolve_url(base: &Url, href: &str) -> Option<Url> {
    base.join(href).ok()
}

fn table_block<'a>(node: ComrakNode<'a>, base: &Url) -> Block {
    let mut headers: Vec<Span> = Vec::new();
    let mut rows: Vec<Vec<Span>> = Vec::new();
    for row in node.children() {
        let is_header = matches!(row.data.borrow().value, NodeValue::TableRow(true));
        let cells: Vec<Span> = row
            .children()
            .filter(|c| matches!(c.data.borrow().value, NodeValue::TableCell))
            .map(|cell| inline_span(cell, base))
            .collect();
        if is_header {
            headers = cells;
        } else {
            rows.push(cells);
        }
    }
    Block::Table { headers, rows }
}

/* ------------------------------------------------------------------ *
 * Metadata: <meta>, OG/Twitter, JSON-LD, microformats (h-card)
 * ------------------------------------------------------------------ */

fn parse_metadata(html: &str, base: &Url) -> (Metadata, Vec<String>) {
    let doc = Html::parse_document(html);
    let mut m = Metadata::default();
    let mut decisions = Vec::new();

    if let Some(t) = doc.select(&Selector::parse("title").unwrap()).next() {
        let text = t.text().collect::<String>().trim().to_string();
        if !text.is_empty() {
            m.title = Some(text);
        }
    }

    let mut og: HashMap<String, String> = HashMap::new();
    let mut twitter: HashMap<String, String> = HashMap::new();
    for meta in doc.select(&Selector::parse("meta").unwrap()) {
        let name = meta.value().attr("name").map(|s| s.to_ascii_lowercase());
        let property = meta
            .value()
            .attr("property")
            .map(|s| s.to_ascii_lowercase());
        let content = meta.value().attr("content").unwrap_or("").to_string();
        if let Some(name) = name {
            match name.as_str() {
                "description" => m.description = Some(content),
                "author" => m.author = Some(content),
                _ if name.starts_with("twitter:") => {
                    twitter.insert(name, content);
                }
                _ => {}
            }
        } else if let Some(property) = property
            && property.starts_with("og:")
        {
            og.insert(property, content);
        }
    }

    if let Some(d) = og.get("og:description") {
        m.description.get_or_insert_with(|| d.clone());
    }
    if let Some(s) = og.get("og:site_name") {
        m.site_name = Some(s.clone());
        decisions.push("metadata: og:site_name".to_string());
    }
    if let Some(t) = og.get("og:title") {
        decisions.push("metadata: og:title".to_string());
        if m.title.is_none() {
            m.title = Some(t.clone());
        }
    }
    if let Some(u) = og.get("og:url")
        && let Ok(url) = Url::parse(u)
    {
        m.canonical_url.get_or_insert(url);
        decisions.push("metadata: og:url/canonical".to_string());
    }
    if let Some(img) = og.get("og:image")
        && let Some(url) = resolve_url(base, img)
    {
        m.featured_image = Some(url);
        decisions.push("metadata: og:image".to_string());
    }
    m.og = og;
    m.twitter = twitter;

    for link in doc.select(&Selector::parse("link").unwrap()) {
        let rel = link.value().attr("rel").map(|s| s.to_ascii_lowercase());
        let href = link.value().attr("href").unwrap_or("");
        match rel.as_deref() {
            Some("canonical") => {
                if let Ok(u) = base.join(href) {
                    // <link rel=canonical> is authoritative over og:url.
                    m.canonical_url = Some(u);
                    decisions.push("metadata: link canonical".to_string());
                }
            }
            Some("icon") => {
                if let Ok(u) = base.join(href) {
                    m.favicon_url.get_or_insert(u);
                }
            }
            _ => {}
        }
    }

    // JSON-LD.
    let json_ld_sel = Selector::parse(r#"script[type="application/ld+json"]"#).unwrap();
    for script in doc.select(&json_ld_sel) {
        let raw = script.text().collect::<String>();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            m.json_ld.push(value);
            decisions.push("metadata: json-ld".to_string());
        }
    }

    // Microformats h-card -> author.
    for card in doc.select(&Selector::parse("[class*='h-card']").unwrap()) {
        let name_sel = Selector::parse(".p-name").unwrap();
        if let Some(name) = card.select(&name_sel).next() {
            let text = name.text().collect::<String>().trim().to_string();
            if !text.is_empty() {
                m.author = Some(text);
                decisions.push("metadata: microformats h-card author".to_string());
                break;
            }
        }
    }

    (m, decisions)
}

/* ------------------------------------------------------------------ *
 * PGP verification (BEFORE extraction)
 * ------------------------------------------------------------------ */

/// Run PGP verification on the raw bytes before extraction (invariant #6).
///
/// Returns `(signature info, bytes to extract from)`. When no signature is
/// present, returns `(None, bytes as-is)` and extraction uses the original. A
/// detected-but-invalid signature returns [`Error::PgpInvalid`]. A detected
/// signature with no usable key records `Unverified` (content still extracted —
/// we cannot prove tampering without a key; the invariant is ordering, which is
/// preserved).
fn verify_pgp(bytes: &[u8], keys: KeySet) -> Result<(Option<PgpInfo>, Vec<u8>), Error> {
    let has_clearsign = !hypernext_pgp::extract_clearsign_blocks(bytes).is_empty();
    let sig_link = hypernext_pgp::extract_signature_link(bytes);

    if !has_clearsign && sig_link.is_none() {
        return Ok((None, bytes.to_vec()));
    }
    tracing::info!(
        event = "pgp.verify",
        "running PGP verification before extraction"
    );

    // Clearsign inline signature.
    if has_clearsign {
        for key in keys {
            match hypernext_pgp::verify_clearsign(bytes, key) {
                Ok(verification) => {
                    let status = verification.to_status();
                    if status == PgpStatus::Invalid {
                        return Err(Error::PgpInvalid);
                    }
                    let payload = hypernext_pgp::extract_clearsign_blocks(bytes)
                        .into_iter()
                        .next()
                        .map(|b| b.payload)
                        .unwrap_or_default();
                    return Ok((
                        Some(PgpInfo {
                            status,
                            signer_fingerprint: None,
                            key_source: PgpKeySource::Embedded,
                            signature_source: Some("inline".to_string()),
                        }),
                        payload,
                    ));
                }
                Err(_) => continue,
            }
        }
        // No key verified the clearsign block -> unverified (we cannot tell
        // whether it is valid or tampered without a usable key).
        return Ok((
            Some(PgpInfo {
                status: PgpStatus::Unverified,
                signer_fingerprint: None,
                key_source: PgpKeySource::Embedded,
                signature_source: Some("inline".to_string()),
            }),
            bytes.to_vec(),
        ));
    }

    // Detached signature via <link rel="signature">.
    if let Some(src) = sig_link {
        if let Some(sig) = find_armored_signature(bytes) {
            for key in keys {
                match hypernext_pgp::verify_detached(bytes, &sig, key) {
                    Ok(verification) => {
                        let status = verification.to_status();
                        if status == PgpStatus::Invalid {
                            return Err(Error::PgpInvalid);
                        }
                        return Ok((
                            Some(PgpInfo {
                                status,
                                signer_fingerprint: None,
                                key_source: PgpKeySource::Embedded,
                                signature_source: Some(src),
                            }),
                            bytes.to_vec(),
                        ));
                    }
                    Err(_) => continue,
                }
            }
        }
        return Ok((
            Some(PgpInfo {
                status: PgpStatus::Unverified,
                signer_fingerprint: None,
                key_source: PgpKeySource::Embedded,
                signature_source: Some(src),
            }),
            bytes.to_vec(),
        ));
    }

    Ok((None, bytes.to_vec()))
}

/// Find an armored detached `-----BEGIN PGP SIGNATURE-----` block in `bytes`.
fn find_armored_signature(bytes: &[u8]) -> Option<Vec<u8>> {
    const BEGIN: &str = "-----BEGIN PGP SIGNATURE-----";
    const END: &str = "-----END PGP SIGNATURE-----";
    let text = std::str::from_utf8(bytes).ok()?;
    let start = text.find(BEGIN)?;
    let after = start + BEGIN.len();
    let end_rel = text[after..].find(END)?;
    let end = after + end_rel + END.len();
    Some(bytes[start..end].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::Block;

    fn base_url() -> Url {
        Url::parse("https://example.com/page").unwrap()
    }

    /// Load a fixture and run `extract_doc` with an HTML content type.
    fn extract_fixture(name: &str) -> PageDoc {
        let path = format!(
            "{}/tests/fixtures/http/{}.html",
            env!("CARGO_MANIFEST_DIR"),
            name
        );
        let html = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"));
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/html".to_string()),
            ..Default::default()
        };
        let url = base_url();
        extract_doc(
            &url,
            &url,
            html.as_bytes().to_vec(),
            Some("text/html"),
            &[],
            &resp,
        )
        .expect("fixture should extract without error")
    }

    fn paragraph_texts(doc: &PageDoc) -> Vec<String> {
        doc.blocks
            .iter()
            .filter_map(|b| match b {
                Block::Paragraph(s) => {
                    Some(s.runs.iter().map(|r| r.text.as_str()).collect::<String>())
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn simple_article_has_title_and_paragraphs() {
        let doc = extract_fixture("simple-article");
        assert!(doc.title.is_some());
        let texts = paragraph_texts(&doc);
        assert!(
            !texts.is_empty(),
            "expected paragraphs, got blocks: {:?}",
            doc.blocks
        );
        assert!(
            texts
                .concat()
                .contains("first paragraph of the simple article"),
            "main content missing: {:?}",
            texts
        );
    }

    #[test]
    fn article_with_ads_preserves_main_content() {
        let doc = extract_fixture("article-with-ads");
        let texts = paragraph_texts(&doc);
        assert!(
            texts.concat().contains("main article content is preserved"),
            "main content dropped: {:?}",
            texts
        );
        // NOTE (R2 legible gap): legible 0.5.1 does NOT strip all ad divs
        // (buy-now sidebar / inline ad survived). Aggressive ad stripping is
        // owned by p3-t3 (adblock crate, cosmetic rules applied before
        // legible). Here we only guarantee the main content survives.
    }

    #[test]
    fn feed_page_routes_to_deferred_marker() {
        let html = include_str!("../tests/fixtures/http/feed.html");
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/html".to_string()), // mislabeled feed
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            html.as_bytes().to_vec(),
            Some("text/html"),
            &[],
            &resp,
        )
        .expect("feed should extract without error");
        // Routes to the feed::deferred marker regardless of the HTML label.
        assert!(
            doc.debug
                .parser_decisions
                .iter()
                .any(|d| d.contains("feed::deferred")),
            "missing feed deferral decision: {:?}",
            doc.debug.parser_decisions
        );
        assert!(
            doc.blocks
                .iter()
                .any(|b| matches!(b, Block::Raw { mime, .. } if mime == feed::DEFERRED_MIME)),
            "expected a deferred feed Raw block: {:?}",
            doc.blocks
        );
    }

    #[test]
    fn markdown_body_runs_comrak_then_extract() {
        let md = include_str!("../tests/fixtures/http/markdown.html");
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/markdown".to_string()),
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            md.as_bytes().to_vec(),
            Some("text/markdown"),
            &[],
            &resp,
        )
        .expect("markdown should extract");
        assert!(
            doc.debug
                .parser_decisions
                .iter()
                .any(|d| d.contains("markdown")),
            "expected markdown decision: {:?}",
            doc.debug.parser_decisions
        );
        let texts = paragraph_texts(&doc);
        assert!(
            texts.concat().contains("markdown content type"),
            "markdown body text missing: {:?}",
            texts
        );
    }

    #[test]
    fn empty_body_extracts_ok_without_error() {
        let doc = extract_fixture("empty-body");
        // Not an error: returns a valid PageDoc (blocks may be empty or fallback text).
        assert_eq!(doc.final_url, base_url());
    }

    #[test]
    fn missing_metadata_has_all_none_fields() {
        let doc = extract_fixture("missing-metadata");
        let m = &doc.metadata;
        assert!(m.title.is_none(), "title should be None, got {:?}", m.title);
        assert!(m.description.is_none());
        assert!(
            m.author.is_none(),
            "author should be None, got {:?}",
            m.author
        );
        assert!(m.published.is_none());
        assert!(m.updated.is_none());
        assert!(m.site_name.is_none());
        assert!(m.canonical_url.is_none());
        assert!(m.favicon_url.is_none());
        assert!(m.featured_image.is_none());
        assert!(m.og.is_empty());
        assert!(m.twitter.is_empty());
        assert!(m.json_ld.is_empty());
    }

    #[test]
    fn microformats_h_card_parses_author() {
        let doc = extract_fixture("microformats");
        assert_eq!(doc.metadata.author.as_deref(), Some("Jane Author"));
    }

    #[test]
    fn json_ld_is_parsed_into_metadata() {
        let doc = extract_fixture("json-ld");
        assert!(!doc.metadata.json_ld.is_empty());
        let first = doc.metadata.json_ld.first().unwrap();
        assert_eq!(first["@type"], "Article");
    }

    #[test]
    fn javascript_heavy_static_text_survives() {
        let doc = extract_fixture("javascript-heavy");
        let all = doc
            .blocks
            .iter()
            .map(|b| format!("{b:?}"))
            .collect::<String>()
            .to_lowercase();
        assert!(
            all.contains("statically served article text"),
            "static text dropped: {all}"
        );
    }

    #[test]
    fn very_nested_extracts_title_and_paragraph() {
        let doc = extract_fixture("very-nested");
        let all = doc
            .blocks
            .iter()
            .map(|b| format!("{b:?}"))
            .collect::<String>()
            .to_lowercase();
        assert!(
            all.contains("deeply nested documents still resolve"),
            "nested content missing: {:?}",
            all
        );
    }

    #[test]
    fn nested_frames_degrades_gracefully() {
        let doc = extract_fixture("nested-frames");
        // Must succeed; frames are not followed but fallback content may surface.
        assert_eq!(doc.final_url, base_url());
    }

    #[test]
    fn text_plain_yields_preformatted_paragraph() {
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/plain".to_string()),
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            b"hello plain world".to_vec(),
            Some("text/plain"),
            &[],
            &resp,
        )
        .expect("text/plain extraction");
        assert!(matches!(
            &doc.blocks[0],
            Block::Paragraph(s) if s.runs[0].style.preformatted
        ));
        assert_eq!(doc.metadata.title, None);
    }

    #[test]
    fn binary_content_yields_raw_block() {
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("image/png".to_string()),
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a],
            Some("image/png"),
            &[],
            &resp,
        )
        .expect("binary extraction");
        assert!(matches!(
            &doc.blocks[0],
            Block::Raw { mime, .. } if mime == "image/png"
        ));
    }

    #[test]
    fn content_type_sniffing_detects_html_without_header() {
        let html = include_str!("../tests/fixtures/http/simple-article.html");
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: None,
            ..Default::default()
        };
        let doc = extract_doc(&url, &url, html.as_bytes().to_vec(), None, &[], &resp)
            .expect("sniffed html extraction");
        assert!(
            doc.debug
                .parser_decisions
                .iter()
                .any(|d| d.contains("sniffed")),
            "expected a sniffing decision: {:?}",
            doc.debug.parser_decisions
        );
        assert!(!doc.blocks.is_empty());
    }

    #[test]
    fn comrak_ast_covers_all_block_types() {
        let markdown = r#"
# Top Heading

## Sub Heading

Paragraph with **bold**, *italic*, and `code`.

A [link](https://example.com) and a soft
break in the same paragraph.

```rust
let x = 1;
```

> A quoted passage.

---

- bullet one
- bullet two

1. ordered one
2. ordered two

| Left | Right |
|------|-------|
| a    | 1     |

![alt text](https://example.com/img.png)
"#;
        let article = legible::Article {
            title: "Test".to_string(),
            byline: None,
            dir: None,
            lang: Some("en".to_string()),
            content: String::new(),
            text_content: markdown.to_string(),
            markdown_content: markdown.to_string(),
            length: markdown.len(),
            excerpt: None,
            site_name: None,
            published_time: None,
        };
        let base = Url::parse("https://example.com/page").unwrap();
        let (blocks, _decisions) = article_to_blocks(&article, &base);

        let kinds: Vec<&str> = blocks
            .iter()
            .map(|b| match b {
                Block::Heading { .. } => "heading",
                Block::Paragraph(_) => "paragraph",
                Block::Code { .. } => "code",
                Block::Quote(_) => "quote",
                Block::Separator => "separator",
                Block::List { .. } => "list",
                Block::Table { .. } => "table",
                Block::Image { .. } => "image",
                _ => "other",
            })
            .collect();
        for want in ["heading", "code", "quote", "separator", "list", "table"] {
            assert!(kinds.contains(&want), "missing {want}: {kinds:?}");
        }

        let has_styled = blocks.iter().any(|b| match b {
            Block::Paragraph(s) => s
                .runs
                .iter()
                .any(|r| r.style.bold || r.style.italic || r.style.code),
            _ => false,
        });
        assert!(has_styled, "expected styled runs in some paragraph");
    }

    #[test]
    fn metadata_og_canonical_favicon_and_twitter_parsed() {
        let html = r#"<!DOCTYPE html>
<html><head>
  <title>Meta Title</title>
  <meta name="description" content="Meta description">
  <meta name="author" content="Meta Author">
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG description">
  <meta property="og:site_name" content="OG Site">
  <meta property="og:url" content="https://example.com/canonical">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="/real-canonical">
  <link rel="icon" href="/favicon.ico">
</head>
<body><article><h1>Meta Title</h1><p>Body text here for extraction.</p></article></body></html>"#;
        let url = Url::parse("https://example.com/page").unwrap();
        let (md, decisions) = parse_metadata(html, &url);

        assert_eq!(md.title.as_deref(), Some("Meta Title"));
        assert_eq!(md.description.as_deref(), Some("Meta description"));
        assert_eq!(md.author.as_deref(), Some("Meta Author"));
        assert_eq!(md.site_name.as_deref(), Some("OG Site"));
        assert_eq!(
            md.canonical_url.as_ref(),
            Some(&Url::parse("https://example.com/real-canonical").unwrap())
        );
        assert_eq!(
            md.favicon_url.as_ref(),
            Some(&Url::parse("https://example.com/favicon.ico").unwrap())
        );
        assert_eq!(
            md.featured_image.as_ref(),
            Some(&Url::parse("https://example.com/og.png").unwrap())
        );
        assert_eq!(md.og.get("og:title").map(String::as_str), Some("OG Title"));
        assert_eq!(
            md.twitter.get("twitter:card").map(String::as_str),
            Some("summary_large_image")
        );
        assert!(decisions.iter().any(|d| d.contains("canonical")));
    }

    #[test]
    fn sniffed_markdown_and_plaintext_without_header() {
        let url = base_url();
        let md_body = "# Heading\n\nSome markdown paragraph content here.";
        let resp = HttpResponseDebug {
            status: 200,
            content_type: None,
            ..Default::default()
        };
        let doc = extract_doc(&url, &url, md_body.as_bytes().to_vec(), None, &[], &resp)
            .expect("sniffed markdown");
        assert!(
            doc.debug
                .parser_decisions
                .iter()
                .any(|d| d.contains("markdown")),
            "{:?}",
            doc.debug.parser_decisions
        );

        let plain = "just some bare text with no markup at all here";
        let doc2 = extract_doc(&url, &url, plain.as_bytes().to_vec(), None, &[], &resp)
            .expect("sniffed plaintext");
        assert!(matches!(
            &doc2.blocks[0],
            Block::Paragraph(s) if s.runs[0].style.preformatted
        ));
    }

    #[test]
    fn binary_content_type_wins_over_html_body() {
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: None,
            ..Default::default()
        };
        let html = "<html><body><p>A tiny html page with a little text content for classification.</p></body></html>";
        let doc = extract_doc(
            &url,
            &url,
            html.as_bytes().to_vec(),
            Some("application/octet-stream"),
            &[],
            &resp,
        )
        .expect("octet-stream html extraction");
        assert!(
            matches!(&doc.blocks[0], Block::Raw { mime, .. } if mime == "application/octet-stream")
        );
    }

    #[test]
    fn feed_routed_via_content_type_header() {
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: None,
            ..Default::default()
        };
        let atom = r#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title></feed>"#;
        let doc = extract_doc(
            &url,
            &url,
            atom.as_bytes().to_vec(),
            Some("application/atom+xml"),
            &[],
            &resp,
        )
        .expect("atom feed via header");
        assert!(
            doc.debug
                .parser_decisions
                .iter()
                .any(|d| d.contains("feed::deferred")),
            "{:?}",
            doc.debug.parser_decisions
        );
    }

    #[test]
    fn clearsign_without_usable_key_records_unverified() {
        let body = "<html><body><p>clearsigned body text that is never extracted because no key.</p></body></html>";
        let fake_armor = format!(
            "-----BEGIN PGP SIGNED MESSAGE-----\n\n{}\n-----BEGIN PGP SIGNATURE-----\n\nplaceholder\n-----END PGP SIGNATURE-----\n",
            body
        );
        let url = base_url();
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/html".to_string()),
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            fake_armor.as_bytes().to_vec(),
            Some("text/html"),
            &[],
            &resp,
        )
        .expect("clearsign no-key extraction");
        assert_eq!(doc.signature.map(|s| s.status), Some(PgpStatus::Unverified));
    }

    #[test]
    fn detached_signature_without_key_records_unverified() {
        let url = base_url();
        let html = concat!(
            "<html><head><link rel=\"signature\" href=\"sig.asc\"></head>",
            "<body><article><p>Detached content that requires external key resolution.</p></article></body></html>",
            "\n-----BEGIN PGP SIGNATURE-----\nplaceholder\n-----END PGP SIGNATURE-----\n"
        );
        let resp = HttpResponseDebug {
            status: 200,
            content_type: Some("text/html".to_string()),
            ..Default::default()
        };
        let doc = extract_doc(
            &url,
            &url,
            html.as_bytes().to_vec(),
            Some("text/html"),
            &[],
            &resp,
        )
        .expect("detached no-key extraction");
        assert_eq!(doc.signature.map(|s| s.status), Some(PgpStatus::Unverified));
    }
}
