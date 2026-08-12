//! Native GTK4 document renderer (task p2-t9).
//!
//! Converts a protocol-agnostic [`Vec<Block>`](hypernext_core::Block) into a
//! tree of native GTK4 widgets for display in the Hypernext app shell.
//!
//! The pure, GTK-free mapping logic (CSS classes, Pango markup, raw-MIME
//! safety) lives in [`mapping`] and is unit-tested there. This module only
//! assembles the actual widget tree.
//!
//! Design notes:
//! - Selection is per-label in v1 (cross-block selection is open question Q2
//!   in the phase doc); body text labels are `selectable`.
//! - No web content is ever executed here: `Block::Raw` renders only safe
//!   image payloads, and everything else is an "unsupported content"
//!   placeholder (invariant #10).

pub mod mapping;

use gtk::prelude::*;
use hypernext_core::{Block, Span};
use relm4::prelude::*;

use crate::render::mapping::{block_css_class, is_image_mime, span_to_pango};

/// Render a document (a sequence of blocks) into a single `gtk::Widget`
/// suitable for embedding in the app shell.
///
/// Returns a `gtk::Box` (vertical) styled with the `hypernext-document` CSS
/// class. An empty block slice yields an empty box.
pub fn render_doc(blocks: &[Block]) -> gtk::Widget {
    let container = gtk::Box::new(gtk::Orientation::Vertical, 8);
    container.add_css_class(mapping::DOC_CLASS);
    container.set_hexpand(true);
    container.set_vexpand(true);
    for block in blocks {
        let child = render_block(block);
        container.append(&child);
    }
    container.upcast()
}

/// Render a single block to its widget.
fn render_block(block: &Block) -> gtk::Widget {
    let css = block_css_class(block);
    match block {
        Block::Heading { level, text, id } => heading_widget(*level, text, id).upcast(),
        Block::Paragraph(span) => paragraph_widget(span, css).upcast(),
        Block::List { ordered, items } => list_widget(*ordered, items, css).upcast(),
        Block::Quote(span) => {
            let box_ = gtk::Box::new(gtk::Orientation::Vertical, 4);
            box_.add_css_class(css);
            box_.append(&paragraph_label(span));
            box_.upcast()
        }
        Block::Code { text, .. } => code_widget(text).upcast(),
        Block::Image { alt, url, .. } => {
            // Remote image loading (async fetch to display the bytes) is
            // deferred until the shell wires up HTTP; v1 shows a labelled
            // placeholder so the Image variant is still represented.
            // ponytail: async image fetch is a follow-up; placeholder today.
            let label = gtk::Label::new(Some(alt.as_deref().unwrap_or("image")));
            label.set_tooltip_text(Some(url.as_str()));
            label.set_selectable(true);
            label.set_xalign(0.0);
            label.add_css_class(css);
            label.upcast()
        }
        Block::Link { url, text } => link_widget(url.as_str(), text, css).upcast(),
        Block::Table { headers, rows } => table_widget(headers, rows, css).upcast(),
        Block::Separator => {
            let sep = gtk::Separator::new(gtk::Orientation::Horizontal);
            sep.add_css_class(css);
            sep.upcast()
        }
        Block::Raw { mime, bytes } => match is_image_mime(mime) {
            true => raw_image_widget(bytes, css).upcast(),
            false => unsupported_widget().upcast(),
        },
    }
}

fn heading_widget(level: u8, text: &str, _id: &Option<String>) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_selectable(true);
    label.set_xalign(0.0);
    label.set_wrap(true);
    label.add_css_class(block_css_class(&Block::Heading {
        level,
        text: String::new(),
        id: None,
    }));
    // WCAG 2.2 AA: expose heading semantics to AT.
    label.set_accessible_role(gtk::AccessibleRole::Heading);
    label
}

/// A selectable, wrapping body-text label.
fn paragraph_label(span: &Span) -> gtk::Label {
    let label = gtk::Label::new(None);
    label.set_markup(&span_to_pango(span));
    label.set_wrap(true);
    label.set_xalign(0.0);
    label.set_selectable(true);
    label
}

fn paragraph_widget(span: &Span, css: &str) -> gtk::Label {
    let label = paragraph_label(span);
    label.add_css_class(css);
    label
}

fn list_widget(ordered: bool, items: &[Span], css: &str) -> gtk::Box {
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, 2);
    box_.add_css_class(css);
    for (i, item) in items.iter().enumerate() {
        let label = paragraph_label(item);
        let prefix = if ordered {
            format!("{}. ", i + 1)
        } else {
            "• ".to_string()
        };
        label.set_markup(&format!("{prefix}{}", span_to_pango(item)));
        box_.append(&label);
    }
    box_
}

fn code_widget(text: &str) -> gtk::Box {
    let window = gtk::ScrolledWindow::new();
    window.set_policy(gtk::PolicyType::Automatic, gtk::PolicyType::Automatic);
    let label = gtk::Label::new(Some(text));
    label.set_wrap(false);
    label.set_xalign(0.0);
    label.set_yalign(0.0);
    label.add_css_class(mapping::block_css_class(&Block::Code {
        language: None,
        text: String::new(),
    }));
    label.set_selectable(true);
    window.set_child(Some(&label));
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, 0);
    box_.append(&window);
    box_
}

fn link_widget(uri: &str, _text: &Span, css: &str) -> gtk::LinkButton {
    // LinkButton is an accessible, keyboard-navigable link by default. v1
    // behaviour: activating opens the link in the OS-default handler. In-app
    // navigation is a follow-up once the shell wires a navigator (gemini and
    // gopher links cannot open in a browser).
    // ponytail: emit an in-app navigate signal when the shell grows one.
    let button = gtk::LinkButton::new(uri);
    button.add_css_class(css);
    button.add_css_class("link");
    button.set_accessible_role(gtk::AccessibleRole::Link);
    button
}

fn table_widget(headers: &[Span], rows: &[Vec<Span>], css: &str) -> gtk::Box {
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, 2);
    box_.add_css_class(css);
    if !headers.is_empty() {
        let header_row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        for h in headers {
            let label = paragraph_label(h);
            label.set_markup(&format!("<b>{}</b>", span_to_pango(h)));
            header_row.append(&label);
        }
        box_.append(&header_row);
    }
    for row in rows {
        let row_box = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        for cell in row {
            row_box.append(&paragraph_label(cell));
        }
        box_.append(&row_box);
    }
    box_
}

/// Render raw image bytes into a `GtkPicture`, writing them to a temp file
/// first. Returns an unsupported-content label (upcast) if the bytes cannot be
/// materialized.
fn raw_image_widget(bytes: &[u8], css: &str) -> gtk::Widget {
    // ponytail: temp file per image; memory-backed decode (GdkPixbuf ->
    // GdkTexture -> set_paintable) is a follow-up that avoids disk churn.
    // The OS temp dir reaps orphaned files on reboot.
    let path = std::env::temp_dir().join(format!(
        "hypernext-{}-{}.img",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    ));
    match std::fs::write(&path, bytes) {
        Ok(()) => {
            let pic = gtk::Picture::new();
            pic.set_filename(Some(path));
            pic.add_css_class(css);
            pic.upcast()
        }
        Err(_) => unsupported_widget().upcast(),
    }
}

fn unsupported_widget() -> gtk::Label {
    let label = gtk::Label::new(Some("unsupported content"));
    label.add_css_class(mapping::RAW_UNSUPPORTED_CLASS);
    label.set_xalign(0.0);
    label
}
