//! Reader-mode document body renderer (Phase 2 handoff h2, task p3-t6).
//!
//! Promotes the Phase 2 text-selection SPIKE
//! (`crates/hypernext-app/src/render/spike_textview.rs`) to production: all
//! selectable document text is rendered into ONE `GtkTextBuffer` backed by a
//! single read-only `GtkTextView`, with styled `GtkTextTag`s per block/inline
//! style. Non-text blocks (images, raw payloads, separators) are embedded
//! where they fall as child widgets via `GtkTextChildAnchor`, so GTK's native
//! cross-block selection works by default (ADR
//! `docs/references/text-selection-strategy.md`).
//!
//! ## Raw-webview dispatch (p3-t7 landing)
//!
//! `Block::Webview { url }` was added to `hypernext-core` by p3-t7. It has an
//! explicit arm here (a safe unsupported placeholder if a direct `render_blocks`
//! call reaches it) and in [`reader_view::is_raw_doc`](crate::reader_view::is_raw_doc)
//! (the raw signal). A `_ =>` catch-all remains as a future-proof fallback.
//!
//! ## Link activation -> navigator (h2)
//!
//! Runs carrying a [`SpanRun::link`](hypernext_core::SpanRun::link) get a
//! dedicated `GtkTextTag` with their URI set, and the `GtkTextView`'
//! `activate-link` signal is wired to the `navigator` callback passed to
//! [`render_blocks`]. No navigator component exists in this crate yet; the
//! callback is the wiring point the shell fills with a closure that routes the
//! URL through `Dispatcher::fetch` + `FetchPolicy::check_url` (invariants
//! #8/#12) once those land.

use std::borrow::Cow;
use std::collections::HashMap;
use std::rc::Rc;

use gtk::prelude::*;
use gtk4 as gtk;
use hypernext_core::{Block, Span};

use crate::style;

/// CSS class on the reader `GtkTextView`.
pub const DOC_CLASS: &str = "hypernext-document";

/// The set of `GtkTextTag` kinds the renderer registers, mapping a block or
/// inline style to a styled, themeable tag.
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
    /// Selectable text to insert (empty for pure child-widget anchors).
    pub text: Cow<'static, str>,
    /// Styling kinds applied when inserting into the buffer.
    pub tags: Vec<TextTag>,
    /// If set, a child widget (non-text block) is embedded after this text.
    pub anchor: Option<ChildAnchor>,
    /// If set, this run is a link whose target is carried here.
    pub link: Option<Cow<'static, str>>,
}

/// Rendering navigator callback type (see module docs, link activation).
pub type Navigator = Rc<dyn Fn(&str)>;

/// Convert a document into a flat, ordered list of tagged text entries.
///
/// Pure and deterministic: unit-tested without a GTK runtime (ADR 0005).
pub fn doc_to_entries(blocks: &[Block]) -> Vec<TextEntry> {
    let mut out = Vec::new();
    for block in blocks {
        push_block(block, &mut out);
    }
    out
}

fn push_block(block: &Block, out: &mut Vec<TextEntry>) {
    let anchor_only = |anchor: ChildAnchor| TextEntry {
        text: Cow::Borrowed(""),
        tags: vec![],
        anchor: Some(anchor),
        link: None,
    };
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
                    Cow::Borrowed("\u{2022} ")
                };
                out.push(TextEntry {
                    text: prefix,
                    tags: vec![TextTag::ListItem],
                    anchor: None,
                    link: None,
                });
                push_span(out, item, TextTag::ListItem);
            }
        }
        Block::Code { text, .. } => push_line(out, text, TextTag::Code),
        Block::Link { text, .. } => push_span(out, text, TextTag::Link),
        Block::Image { .. } => out.push(anchor_only(ChildAnchor::Image)),
        Block::Table { headers, rows } => {
            for h in headers {
                push_span(out, h, TextTag::Paragraph);
            }
            for row in rows {
                for cell in row {
                    push_span(out, cell, TextTag::Paragraph);
                }
            }
        }
        Block::Separator => out.push(anchor_only(ChildAnchor::Separator)),
        Block::Raw { mime, .. } => {
            // Only images get an image anchor; anything else (including HTML)
            // is an unsupported placeholder — never rendered as web content
            // (invariant #10).
            let anchor = if style::is_image_mime(mime) {
                ChildAnchor::Image
            } else {
                ChildAnchor::Unsupported
            };
            out.push(anchor_only(anchor));
        }
        // Raw-mode webview block (added by p3-t7). This is the raw-render
        // signal: `reader_view` routes the document to the platform webview
        // before this code runs, so a direct `render_blocks` call degrades to
        // an unsupported placeholder rather than executing web content
        // (invariant #10).
        Block::Webview { .. } => out.push(anchor_only(ChildAnchor::Unsupported)),
        // Future-proof catch-all for any block variants added later.
        #[allow(unreachable_patterns)]
        _ => out.push(anchor_only(ChildAnchor::Unsupported)),
    }
}

fn push_line(out: &mut Vec<TextEntry>, text: &str, tag: TextTag) {
    out.push(TextEntry {
        text: Cow::Owned(text.to_string()),
        tags: vec![tag],
        anchor: None,
        link: None,
    });
}

fn push_span(out: &mut Vec<TextEntry>, span: &Span, base: TextTag) {
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
        let link = run
            .link
            .as_ref()
            .map(|u| Cow::Owned(u.as_str().to_string()));
        if link.is_some() {
            tags.push(TextTag::Link);
        }
        out.push(TextEntry {
            text: Cow::Owned(run.text.clone()),
            tags,
            anchor: None,
            link,
        });
    }
    out.push(TextEntry {
        text: Cow::Borrowed("\n"),
        tags: vec![base],
        anchor: None,
        link: None,
    });
}

/// Registered name for each [`TextTag`].
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

/// Permanently render a document body into a single selectable `gtk::Widget`.
///
/// Renders all selectable text into one `GtkTextView` (cross-block selection),
/// embedding non-text blocks as child widgets. When `navigator` is set,
/// clicking a link run invokes it with the link's URL.
pub fn render_blocks(blocks: &[Block], navigator: Option<Navigator>) -> gtk::Widget {
    let buffer = gtk::TextBuffer::new(None);
    let view = gtk::TextView::new();
    view.set_buffer(Some(&buffer));

    apply_entries(&buffer, &view, &doc_to_entries(blocks), navigator);

    view.set_editable(false);
    view.set_cursor_visible(false);
    view.set_wrap_mode(gtk::WrapMode::WordChar);
    view.set_left_margin(8);
    view.set_right_margin(8);
    style::add_document_css(&view);
    view.upcast()
}

/// Render [`TextEntry`]s into a live buffer, styling tags and wiring
/// per-URI activate-link signals. Where `navigator` is provided, a link click
/// routes its URI to the callback.
pub fn apply_entries(
    buffer: &gtk::TextBuffer,
    view: &gtk::TextView,
    entries: &[TextEntry],
    navigator: Option<Navigator>,
) {
    // Named styling tags registered once (h4) and per-URI link activation tags.
    let table = buffer.tag_table();
    let styled: HashMap<TextTag, gtk::TextTag> = style::register_tags(&table);
    // Maps each per-link activation tag name to its target URL, so a click can
    // resolve which link was activated (gtk4 0.11 has no `TextTag::link`).
    let mut link_urls: HashMap<String, String> = HashMap::new();

    for entry in entries {
        if let Some(anchor) = entry.anchor {
            let label = gtk::Label::new(Some(match anchor {
                ChildAnchor::Image => "image",
                ChildAnchor::Separator => "\u{2014}",
                ChildAnchor::Unsupported => "unsupported",
            }));
            style::class_child_anchor(&label, anchor);
            let mut anchor_iter = buffer.end_iter();
            let buffer_anchor = buffer.create_child_anchor(&mut anchor_iter);
            view.add_child_at_anchor(&label, &buffer_anchor);
            continue;
        }
        if entry.text.is_empty() {
            continue;
        }

        let mut iter = buffer.end_iter();
        if let Some(link) = &entry.link {
            // Per-URI activation tag, named link-<n>; its URL recorded so a
            // click gesture at this position can resolve the target.
            let link_name = format!("link-{}", link_urls.len());
            let link_tag = gtk::TextTag::new(Some(&link_name));
            link_urls.insert(link_name.clone(), link.to_string());
            table.add(&link_tag);
            let tag_objs: Vec<&gtk::TextTag> = entry
                .tags
                .iter()
                .map(|t| styled.get(t).expect("registered styling tag"))
                .chain(std::iter::once(&link_tag))
                .collect();
            buffer.insert_with_tags(&mut iter, &entry.text, tag_objs.as_slice());
        } else {
            let tag_objs: Vec<&gtk::TextTag> = entry
                .tags
                .iter()
                .map(|t| styled.get(t).expect("registered styling tag"))
                .collect();
            buffer.insert_with_tags(&mut iter, &entry.text, tag_objs.as_slice());
        }
    }

    if let Some(nav) = navigator {
        wire_link_activation(view, link_urls, nav);
    }
}

/// Wire a click gesture on the text view: map the click position to a buffer
/// iter, then if a per-link activation tag is present there, route its URL to
/// the navigator. This is the gtk4-0.11-native link-activation mechanism
/// (TextTag has no `link`/`activate` signal in this version).
fn wire_link_activation(
    view: &gtk::TextView,
    link_urls: HashMap<String, String>,
    navigator: Navigator,
) {
    let gesture = gtk::GestureClick::new();
    gesture.set_button(gtk::gdk::BUTTON_PRIMARY);
    // Owned clones so the 'static gesture closure holds no borrowed data.
    let view_clone = view.clone();
    let navigator = navigator.clone();
    gesture.connect_pressed(move |_g, _n, x, y| {
        // TextView gesture coordinates are already in view space.
        if let Some((iter, _trailing)) = view_clone.iter_at_position(x as i32, y as i32) {
            for tag in iter.tags() {
                if let Some(name) = tag.name().map(|n| n.to_string())
                    && let Some(url) = link_urls.get(&name)
                {
                    navigator(url);
                    return;
                }
            }
        }
    });
    view.add_controller(gesture);
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

    fn url(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn empty_doc_yields_no_entries() {
        assert!(doc_to_entries(&[]).is_empty());
    }

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
        assert!(
            entries
                .iter()
                .any(|e| e.anchor == Some(ChildAnchor::Separator))
        );
        assert!(entries.contains(&TextEntry {
            text: Cow::Owned("Title".into()),
            tags: vec![TextTag::Heading1],
            anchor: None,
            link: None,
        }));
        assert!(entries.iter().any(|e| e.text == "Hello world"));
        assert!(entries.iter().any(|e| e.text == "\u{2022} "));
        assert!(entries.iter().any(|e| e.tags.contains(&TextTag::Code)));
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
        let run = entries.iter().find(|e| e.text == "x").unwrap();
        assert_eq!(run.tags[0], TextTag::Paragraph);
        assert!(run.tags.contains(&TextTag::InlineBold));
        assert!(run.tags.contains(&TextTag::InlineItalic));
    }

    #[test]
    fn link_runs_carry_the_link_tag_and_target() {
        let linked = Span {
            runs: vec![SpanRun {
                text: "jump".into(),
                style: SpanStyle::default(),
                link: Some(url("gemini://example.com")),
            }],
        };
        let entries = doc_to_entries(&[Block::Paragraph(linked)]);
        let run = entries.iter().find(|e| e.text == "jump").unwrap();
        assert!(run.tags.contains(&TextTag::Link));
        assert_eq!(run.link.as_deref(), Some("gemini://example.com"));
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
            assert!(TAG_NAMES.iter().any(|(_, t)| *t == tag), "missing {tag:?}");
        }
    }

    #[test]
    fn unordered_vs_ordered_list_markers() {
        let unordered = doc_to_entries(&[Block::List {
            ordered: false,
            items: vec![span("a")],
        }]);
        assert!(unordered.iter().any(|e| e.text == "\u{2022} "));
        let ordered = doc_to_entries(&[Block::List {
            ordered: true,
            items: vec![span("a")],
        }]);
        assert!(ordered.iter().any(|e| e.text == "1. "));
    }

    #[test]
    fn table_cells_flatten_into_paragraph_text() {
        let blocks = vec![Block::Table {
            headers: vec![span("h1")],
            rows: vec![vec![span("c1")]],
        }];
        let entries = doc_to_entries(&blocks);
        assert!(entries.iter().any(|e| e.text == "h1"));
        assert!(entries.iter().any(|e| e.text == "c1"));
    }

    /// Full pipeline into a live buffer requires a GDK display (cross-block
    /// selection + tag application). Display-gated on CI (AGENTS.md 13.3).
    #[test]
    #[ignore = "needs a GDK display to construct a GtkTextBuffer"]
    fn buffer_holds_all_blocks_with_tags() {
        if gtk::init().is_err() {
            eprintln!("skipping: no display");
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
                url: url("https://example.com/a.png"),
                alt: None,
                caption: None,
            },
        ];
        let buffer = gtk::TextBuffer::new(None);
        let view = gtk::TextView::new();
        view.set_buffer(Some(&buffer));
        apply_entries(&buffer, &view, &doc_to_entries(&blocks), None);
        let text = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world"));
        assert!(text.contains("first"));
        assert!(text.contains("let x = 1;"));
    }
}
