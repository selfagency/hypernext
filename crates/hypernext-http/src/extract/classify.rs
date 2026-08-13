//! Content-type detection/sniffing and per-kind extraction into `Block`s.

use comrak::nodes::ListType;
use comrak::nodes::Node as ComrakNode;
use comrak::nodes::NodeValue;
use hypernext_core::{Block, Metadata, Span, SpanRun, SpanStyle};
use url::Url;

use super::feed::DEFERRED_MIME;
use super::metadata::parse_metadata;

/* ------------------------------------------------------------------ *
 * Content-type detection
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContentKind {
    Html,
    Markdown,
    TextPlain,
    Binary,
    Feed,
}

pub(crate) struct DetectedType {
    pub(crate) kind: ContentKind,
    pub(crate) raw: String,
}

impl DetectedType {
    pub(crate) fn is_feed(&self) -> bool {
        self.kind == ContentKind::Feed
    }
}

/// Detect content type from the `Content-Type` header, sniffing the first 512
/// bytes when the header is missing or not useful.
pub(crate) fn detect_content_type(
    bytes: &[u8],
    header: Option<&str>,
) -> (DetectedType, Vec<String>) {
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

pub(crate) fn is_feed_sniff(head: &str) -> bool {
    head.contains("<feed")
        || head.contains("<rss")
        || head.contains("<rdf:rdf")
        || head.contains("<rdf:description")
}

/// `true` if `s` contains any of `needles`. Keeps per-classifier cyclomatic
/// complexity low by folding the OR chains into one predicate.
fn contains_any(s: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| s.contains(n))
}

pub(crate) fn classify_header(lower: &str) -> Option<ContentKind> {
    if contains_any(lower, &["html", "application/xhtml+xml", "text/xhtml"]) {
        Some(ContentKind::Html)
    } else if contains_any(lower, &["markdown", "x-markdown"]) {
        Some(ContentKind::Markdown)
    } else if contains_any(
        lower,
        &["atom+xml", "rss+xml", "rdf+xml", "feed+json", "jsonfeed"],
    ) {
        Some(ContentKind::Feed)
    } else if contains_any(
        lower,
        &[
            "image/",
            "video/",
            "audio/",
            "application/octet-stream",
            "application/pdf",
        ],
    ) {
        Some(ContentKind::Binary)
    } else if lower.starts_with("text/") {
        Some(ContentKind::TextPlain)
    } else {
        None
    }
}

pub(crate) fn classify_sniff(head: &str) -> ContentKind {
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

pub(crate) fn extract_html(
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

pub(crate) fn extract_markdown(
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

pub(crate) fn extract_plaintext(bytes: &[u8]) -> (Vec<Block>, Metadata, Vec<String>) {
    let text = String::from_utf8_lossy(bytes);
    let mut span = plain_span(&text);
    span.runs[0].style.preformatted = true;
    let blocks = vec![Block::Paragraph(span)];
    let decisions = vec!["text/plain: single preformatted paragraph".to_string()];
    (blocks, Metadata::default(), decisions)
}

pub(crate) fn extract_binary(bytes: &[u8], mime: &str) -> (Vec<Block>, Metadata, Vec<String>) {
    let blocks = vec![Block::Raw {
        mime: mime.to_string(),
        bytes: bytes.to_vec(),
    }];
    let decisions = vec![format!("binary content: Block::Raw ({mime})")];
    (blocks, Metadata::default(), decisions)
}

pub(crate) fn feed_deferred_marker(bytes: &[u8]) -> Vec<Block> {
    vec![Block::Raw {
        mime: DEFERRED_MIME.to_string(),
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

pub(crate) fn article_to_blocks(
    article: &legible::Article,
    base: &Url,
) -> (Vec<Block>, Vec<String>) {
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

pub(crate) fn resolve_url(base: &Url, href: &str) -> Option<Url> {
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
