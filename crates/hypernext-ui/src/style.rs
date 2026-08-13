//! GtkTextTag styling for the promoted reader render path (Phase 2 handoff
//! h4, task p3-t6).
//!
//! GTK4 `GtkTextTag`s are styled through their *properties* (size, weight,
//! style, underline, font, margins) — there is no per-tag CSS class mechanism
//! in GTK4. This module is the single owner of tag styling: it instantiates
//! each named styling tag with the reader look, and applies a `GtkCssProvider`
//! for the surrounding text-view chrome, giving the promoted `document_view`
//! render path the same themeable identity as the widget-per-block renderer
//! (`crates/hypernext-app/src/render/mapping.rs`).

use std::collections::HashMap;

use gtk::pango;
use gtk::prelude::*;
use gtk4 as gtk;

use crate::document_view::{ChildAnchor, TAG_NAMES, TextTag};

/// CSS class on the reader text view (matches `document_view::DOC_CLASS`).
pub const DOC_CLASS: &str = "hypernext-document";

/// True if `mime` is a safe-to-display image type (mirrors the Phase 2
/// mapping guard, invariant #10: HTML/JS is never rendered natively).
pub fn is_image_mime(mime: &str) -> bool {
    mime.starts_with("image/") && mime != "image/svg+xml"
}

/// The registered tag name for a [`TextTag`].
pub fn tag_name(tag: TextTag) -> &'static str {
    TAG_NAMES
        .iter()
        .find(|(_, t)| *t == tag)
        .map(|(n, _)| *n)
        .unwrap_or("paragraph")
}

/// Register one named, styled `GtkTextTag` per [`TextTag`] kind on the buffer
/// table, returning them keyed by kind. Applies the reader text styling (h4).
/// Inline link runs reuse the shared `link` styling tag; per-URI activation
/// is handled separately by `document_view`.
pub fn register_tags(table: &gtk::TextTagTable) -> HashMap<TextTag, gtk::TextTag> {
    use TextTag::*;
    // Pango bold weight (700). `pango::Weight::Bold` carries no public scalar
    // accessor in the pinned pango, so use the canonical CSS weight literal.
    let bold: i32 = 700;
    let mut map = HashMap::new();
    for (name, tag) in TAG_NAMES {
        let t = gtk::TextTag::new(Some(*name));
        match tag {
            Heading1 => {
                t.set_scale(1.6);
                t.set_weight(bold);
            }
            Heading2 => {
                t.set_scale(1.4);
                t.set_weight(bold);
            }
            Heading3 => {
                t.set_scale(1.2);
                t.set_weight(bold);
            }
            Paragraph => {}
            ListItem => {
                t.set_left_margin(20);
            }
            Quote => {
                t.set_style(pango::Style::Italic);
                t.set_indent(16);
            }
            Code | InlineCode => {
                t.set_family(Some("monospace"));
            }
            InlineBold => {
                t.set_weight(bold);
            }
            InlineItalic => {
                t.set_style(pango::Style::Italic);
            }
            Link => {
                // Visual link affordance. Activating the link is handled by
                // `document_view` (gtk4 0.11 has no TextTag `link`/`activate`;
                // see that module).
                t.set_foreground(Some("#1a73e8"));
                t.set_underline(pango::Underline::Single);
            }
        }
        table.add(&t);
        map.insert(*tag, t);
    }
    map
}

/// Apply the reader CSS chrome to a text view (container padding; tag-level
/// visuals are handled by tag properties above).
pub fn add_document_css(view: &gtk::TextView) {
    view.add_css_class(DOC_CLASS);
    let provider = gtk::CssProvider::new();
    provider.load_from_data(
        ".hypernext-document { \
             padding: 4px 12px 12px 12px; \
         }",
    );
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
    let _ = view;
}

/// Apply the widget CSS class for a non-text child anchor (image / separator
/// / unsupported placeholder).
pub fn class_child_anchor(label: &gtk::Label, anchor: ChildAnchor) {
    let class = match anchor {
        ChildAnchor::Image => "hypernext-image-child",
        ChildAnchor::Separator => "hypernext-separator-child",
        ChildAnchor::Unsupported => "hypernext-raw-unsupported",
    };
    label.add_css_class(class);
    label.set_xalign(0.0);
}
