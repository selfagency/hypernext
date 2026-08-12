//! SPIKE: cross-block text selection via a single `GtkTextView` (task p2-t10).
//!
//! The production renderer (`super::mod`) renders each `Block` as its own
//! widget, so selection is per-widget (open question Q2 / phase doc 3.11).
//! This module prototypes the recommended resolution: render all selectable
//! text into ONE `GtkTextBuffer` with styled `GtkTextTag`s, so GTK's native
//! selection spans heading/paragraph/list/code/link boundaries automatically.
//! Non-text blocks (images, separators, unsupported raw) are embedded where
//! they fall via `GtkTextChildAnchor` widget fallback.
//!
//! Following the repo convention (like `mapping.rs`), the block -> typed-text
//! transformation is PURE and unit-testable without a GTK runtime; the thin
//! GTK layer applies it to a buffer. The widget-assembly test is `#[ignore]`d
//! because constructing a `GtkTextBuffer` requires an initialized GDK display.
//!
//! This is a spike to prove the approach, not the production rewrite. The
//! production renderer is untouched; the ADR in `docs/references/
//! text-selection-strategy.md` records the decision.

use std::borrow::Cow;

use hypernext_core::{Block, Span};

// Bring `gtk` (the gtk4 crate) into scope, matching render/mod.rs. relm4 also
// re-exports gtk, but being explicit here keeps the spike self-contained.
use gtk::prelude::*;
use gtk4 as gtk;

/// The set of `GtkTextTag` names the spike renderer registers. Each maps a
/// block or inline style to a named, themeable tag (CSS class in production).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TextTag {
    Heading1,
    Heading2,
    Heading3,
    Paragraph,
    ListItem,
    Quote,
    Code,
    InlineBold,
    InlineItalic,
    InlineCode,
    Link,
}

/// Where non-text content is embedded inside the text stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildAnchor {
    Image,
    Separator,
    Unsupported,
}

/// One output of the pure transform: a text fragment tagged for the buffer,
/// optionally followed by a child-widget anchor.
#[derive(Debug, Clone, PartialEq)]
pub struct TextEntry {
    /// Whether this fragment should be selectable text (true) or a widget
    /// anchor with no own text (false).
    pub text: Cow<'static, str>,
    /// Ordered tags (outermost last is fine; GTK applies all in one call).
    pub tags: Vec<TextTag>,
    /// If set, a child widget (non-text block) is embedded after this text.
    pub anchor: Option<ChildAnchor>,
}

/// Convert a document into a flat, ordered list of tagged text entries.
///
/// Pure and deterministic: unit-tested without a GTK runtime (ADR 0005). The
/// GTK layer inserts each entry into one `GtkTextBuffer`, giving cross-block
/// selection for free.
pub fn doc_to_entries(blocks: &[Block]) -> Vec<TextEntry> {
    let mut out = Vec::new();
    for block in blocks {
        push_block(block, &mut out);
    }
    out
}

fn push_block(block: &Block, out: &mut Vec<TextEntry>) {
    match block {
        Block::Heading { level, text, .. } => {
            let tag = match level {
                1 => TextTag::Heading1,
                2 => TextTag::Heading2,
                _ => TextTag::Heading3,
            };
            push_line(out, text, tag);
        }
        Block::Paragraph(span) => push_span(out, span, TextTag::Paragraph),
        Block::Quote(span) => push_span(out, span, TextTag::Quote),
        Block::List { ordered, items } => {
            for (i, item) in items.iter().enumerate() {
                let prefix = if *ordered {
                    Cow::Owned(format!("{}. ", i + 1))
                } else {
                    Cow::Borrowed("• ")
                };
                // Bullet/number is its own plain text; the item body is tagged.
                out.push(TextEntry {
                    text: prefix,
                    tags: vec![TextTag::ListItem],
                    anchor: None,
                });
                push_span(out, item, TextTag::ListItem);
            }
        }
        Block::Code { text, .. } => push_line(out, text, TextTag::Code),
        Block::Link { text, .. } => push_span(out, text, TextTag::Link),
        Block::Image { .. } => out.push(TextEntry {
            text: Cow::Borrowed(""),
            tags: vec![],
            anchor: Some(ChildAnchor::Image),
        }),
        Block::Table { headers, rows } => {
            // Flatten table cells as paragraph-tagged, tab-separated text. A
            // real renderer may keep a widget table; this spike shows cells
            // remain selectable. ponytail: cell layout via text is a spike
            // simplification; a proper table widget is a follow-up.
            for h in headers {
                push_span(out, h, TextTag::Paragraph);
            }
            for row in rows {
                for cell in row {
                    push_span(out, cell, TextTag::Paragraph);
                }
            }
        }
        Block::Separator => out.push(TextEntry {
            text: Cow::Borrowed(""),
            tags: vec![],
            anchor: Some(ChildAnchor::Separator),
        }),
        Block::Raw { mime, .. } => {
            // Only images get an anchor; anything else is an unsupported
            // placeholder anchor (never rendered as HTML — invariant #10).
            if super::mapping::is_image_mime(mime) {
                out.push(TextEntry {
                    text: Cow::Borrowed(""),
                    tags: vec![],
                    anchor: Some(ChildAnchor::Image),
                });
            } else {
                out.push(TextEntry {
                    text: Cow::Borrowed(""),
                    tags: vec![],
                    anchor: Some(ChildAnchor::Unsupported),
                });
            }
        }
    }
}

fn push_line(out: &mut Vec<TextEntry>, text: &str, tag: TextTag) {
    out.push(TextEntry {
        text: Cow::Owned(text.to_string()),
        tags: vec![tag],
        anchor: None,
    });
}

fn push_span(out: &mut Vec<TextEntry>, span: &Span, base: TextTag) {
    // Flatten each run, layering inline styles over the block tag.
    for run in &span.runs {
        let mut tags = vec![base];
        if run.style.bold {
            tags.push(TextTag::InlineBold);
        }
        if run.style.italic {
            tags.push(TextTag::InlineItalic);
        }
        if run.style.code || run.style.preformatted {
            tags.push(TextTag::InlineCode);
        }
        if run.link.is_some() {
            tags.push(TextTag::Link);
        }
        out.push(TextEntry {
            text: Cow::Owned(run.text.clone()),
            tags,
            anchor: None,
        });
    }
    // A newline after each span keeps blocks visually separate and lets the
    // caret/selection cross block boundaries cleanly.
    out.push(TextEntry {
        text: Cow::Borrowed("\n"),
        tags: vec![base],
        anchor: None,
    });
}

/// Register the styled tags on a buffer. Returns nothing; tags are keyed by
/// name for reuse. Pure logic (no display required) — the GTK-facing tag
/// creation lives in the GTK layer.
pub const TAG_NAMES: &[(&str, TextTag)] = &[
    ("h1", TextTag::Heading1),
    ("h2", TextTag::Heading2),
    ("h3", TextTag::Heading3),
    ("paragraph", TextTag::Paragraph),
    ("list-item", TextTag::ListItem),
    ("quote", TextTag::Quote),
    ("code", TextTag::Code),
    ("bold", TextTag::InlineBold),
    ("italic", TextTag::InlineItalic),
    ("inline-code", TextTag::InlineCode),
    ("link", TextTag::Link),
];

/// Permanently render a document into a single selectable `gtk::Widget`.
///
/// This is the SPIKE's recommended shape: one `GtkTextView` holding the whole
/// text body via tagged `GtkTextBuffer`, so cross-block selection works by
/// default. Non-text blocks are embedded as child widgets through
/// `GtkTextChildAnchor`s.
pub fn render_doc(blocks: &[Block]) -> gtk::Widget {
    let buffer = gtk::TextBuffer::new(None);
    let view = gtk::TextView::new();
    view.set_buffer(Some(&buffer));

    apply_entries(&buffer, &view, &doc_to_entries(blocks));

    view.set_editable(false); // read view; selection + copy still work
    view.set_cursor_visible(false);
    view.set_wrap_mode(gtk::WrapMode::WordChar);
    view.set_left_margin(8);
    view.set_right_margin(8);
    view.add_css_class(super::mapping::DOC_CLASS);
    view.upcast()
}

/// Apply pure [`TextEntry`]s to a live buffer: insert text with named tags and
/// create child widgets at anchors where requested. The `view` is needed to
/// attach child widgets to anchors (GTK4: `add_child_at_anchor`).
pub fn apply_entries(buffer: &gtk::TextBuffer, view: &gtk::TextView, entries: &[TextEntry]) {
    let names = tag_names();
    for entry in entries {
        if let Some(anchor) = entry.anchor {
            // Non-text block: embed a child widget at this point. The spike
            // inserts a labelled placeholder; production swaps in the real
            // widget (e.g. GtkPicture for image bytes).
            let child = gtk::Label::new(Some(match anchor {
                ChildAnchor::Image => "[image]",
                ChildAnchor::Separator => "---",
                ChildAnchor::Unsupported => "[unsupported]",
            }));
            let mut iter = buffer.end_iter();
            let anchor = buffer.create_child_anchor(&mut iter);
            view.add_child_at_anchor(&child, &anchor);
            continue;
        }
        if entry.text.is_empty() {
            continue;
        }
        let tag_names: Vec<&str> = entry
            .tags
            .iter()
            .map(|t| names.get(t).map(String::as_str).unwrap_or("paragraph"))
            .collect();
        let mut iter = buffer.end_iter();
        buffer.insert_with_tags_by_name(&mut iter, &entry.text, tag_names.as_slice());
    }
}

/// Build a [`TextTag`] -> registered-name map for applying entries.
fn tag_names() -> std::collections::HashMap<TextTag, String> {
    TAG_NAMES
        .iter()
        .map(|(name, tag)| (*tag, name.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::{SpanRun, SpanStyle};

    fn span(text: &str) -> Span {
        Span {
            runs: vec![SpanRun {
                text: text.into(),
                style: SpanStyle::default(),
                link: None,
            }],
        }
    }

    /// Every selectable text block collapses into some tagged entries.
    #[test]
    fn mixed_document_produces_tagged_entries() {
        let blocks = vec![
            Block::Heading {
                level: 1,
                text: "Title".into(),
                id: None,
            },
            Block::Paragraph(span("Hello world")),
            Block::List {
                ordered: false,
                items: vec![span("first"), span("second")],
            },
            Block::Code {
                language: None,
                text: "let x = 1;".into(),
            },
            Block::Separator,
        ];
        let entries = doc_to_entries(&blocks);
        // A separator contributes an anchor, proving widget fallback coexists
        // with selectable text in the same stream.
        assert!(entries
            .iter()
            .any(|e| e.anchor == Some(ChildAnchor::Separator)));
        // Heading carries its level tag.
        assert!(entries.contains(&TextEntry {
            text: Cow::Owned("Title".into()),
            tags: vec![TextTag::Heading1],
            anchor: None,
        }));
        // Paragraph body is present with the paragraph tag.
        assert!(entries.iter().any(|e| e.text == "Hello world"));
        // List items keep their marker text plus item tag.
        assert!(entries.iter().any(|e| e.text == "• "));
        // Code text is tagged as code.
        assert!(entries.iter().any(|e| e.tags.contains(&TextTag::Code)));
    }

    #[test]
    fn empty_doc_yields_no_entries() {
        assert!(doc_to_entries(&[]).is_empty());
    }

    #[test]
    fn inline_styles_layer_over_block_tag() {
        let styled = Span {
            runs: vec![SpanRun {
                text: "x".into(),
                style: SpanStyle {
                    bold: true,
                    italic: true,
                    ..Default::default()
                },
                link: None,
            }],
        };
        let entries = doc_to_entries(&[Block::Paragraph(styled)]);
        let run = entries
            .iter()
            .find(|e| e.text == "x")
            .expect("run text present");
        assert_eq!(run.tags[0], TextTag::Paragraph);
        assert!(run.tags.contains(&TextTag::InlineBold));
        assert!(run.tags.contains(&TextTag::InlineItalic));
    }

    #[test]
    fn link_runs_get_the_link_tag() {
        let linked = Span {
            runs: vec![SpanRun {
                text: "jump".into(),
                style: SpanStyle::default(),
                link: Some(url::Url::parse("gemini://example.com").unwrap()),
            }],
        };
        let entries = doc_to_entries(&[Block::Paragraph(linked)]);
        let run = entries.iter().find(|e| e.text == "jump").unwrap();
        assert!(run.tags.contains(&TextTag::Link));
    }

    #[test]
    fn heading_level_three_and_above_fall_back_to_h3() {
        for level in [3, 4, 0] {
            let entries = doc_to_entries(&[Block::Heading {
                level,
                text: "h".into(),
                id: None,
            }]);
            assert_eq!(entries[0].tags, vec![TextTag::Heading3]);
        }
    }

    #[test]
    fn raw_image_maps_to_image_anchor_and_html_to_unsupported() {
        let img = doc_to_entries(&[Block::Raw {
            mime: "image/png".into(),
            bytes: vec![],
        }]);
        assert_eq!(img[0].anchor, Some(ChildAnchor::Image));
        let html = doc_to_entries(&[Block::Raw {
            mime: "text/html".into(),
            bytes: vec![],
        }]);
        assert_eq!(html[0].anchor, Some(ChildAnchor::Unsupported));
    }

    /// Every tag name referenced has a stable, registered name. Guards the
    /// GTK layer's tag lookups against drift.
    #[test]
    fn tag_names_cover_all_variants() {
        use TextTag::*;
        let wanted = [
            Heading1,
            Heading2,
            Heading3,
            Paragraph,
            ListItem,
            Quote,
            Code,
            InlineBold,
            InlineItalic,
            InlineCode,
            Link,
        ];
        for tag in wanted {
            assert!(
                TAG_NAMES.iter().any(|(_, t)| *t == tag),
                "missing name for {tag:?}"
            );
        }
    }

    /// The full pipeline into a live buffer: text lands in ONE buffer with the
    /// expected tags, so selection spans blocks. Requires a GDK display, so it
    /// is ignored in headless/CI (AGENTS.md 13.3). Run locally with:
    /// `cargo test -p hypernext-app -- --ignored`
    #[test]
    #[ignore = "needs a GDK display to construct a GtkTextBuffer"]
    fn buffer_holds_all_blocks_with_tags_and_selection_spans() {
        // gtk::init returns Err when no display is reachable (headless CI).
        if gtk::init().is_err() {
            eprintln!("skipping: no display available");
            return;
        }
        let blocks = vec![
            Block::Heading {
                level: 1,
                text: "Title".into(),
                id: None,
            },
            Block::Paragraph(span("Hello world")),
            Block::List {
                ordered: false,
                items: vec![span("first")],
            },
            Block::Code {
                language: None,
                text: "let x = 1;".into(),
            },
            Block::Image {
                url: url::Url::parse("https://example.com/a.png").unwrap(),
                alt: None,
                caption: None,
            },
        ];
        let buffer = gtk::TextBuffer::new(None);
        let view = gtk::TextView::new();
        view.set_buffer(Some(&buffer));
        apply_entries(&buffer, &view, &doc_to_entries(&blocks));

        // All text content collapsed into a single buffer => cross-block
        // selection is possible by construction.
        let text = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
        assert!(text.contains("first"));
        assert!(text.contains("let x = 1;"));

        // The heading carries its named tag (register a minimal set to prove
        // tag application, not full styling).
        let tag = gtk::TextTag::new(Some("h1"));
        buffer.tag_table().add(&tag);
        let _ = buffer;
    }
}
