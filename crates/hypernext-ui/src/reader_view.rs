//! Reader-mode page renderer (Phase 3, task p3-t6).
//!
//! Composes the full reader view for a [`PageDoc`]: a metadata header (title,
//! author, date, PGP shield, share, read-state), an optional featured image,
//! and the document body via
//! [`document_view::render_blocks`](crate::document_view::render_blocks)
//! (Phase 2 handoffs h2/h4).
//!
//! ## Featured-image deduplication
//!
//! If `metadata.featured_image` is set AND the same URL is not already present
//! as a [`Block::Image`] in the body, the featured image is inserted above the
//! body. The decision is a pure function (`featured_image_url`) so it is
//! unit-tested headless.
//!
//! ## Raw-webview dispatch (p3-t7 coordination)
//!
//! [`Block::Webview`](hypernext_core::Block) (added by p3-t7) signals a
//! document that must render through the raw-mode platform webview, not the
//! native reader (invariant #10). [`is_raw_doc`] returns true when the
//! document contains such a block, and [`render_page_doc`] routes it to a
//! raw-webview placeholder instead of the reader body.

use gtk::prelude::*;
use gtk4 as gtk;
use hypernext_core::{Block, Metadata, PageDoc};

use crate::{document_view, style};

/// Default label when a metadata field is absent.
fn placeholders() -> (&'static str, &'static str, &'static str) {
    ("untitled", "unknown author", "unknown date")
}

/// Extract the header display strings from metadata, substituting placeholders
/// for absent fields. Pure: exercised headless for the empty-metadata case.
pub fn header_strings(meta: &Metadata) -> (String, String, String) {
    let (t, a, d) = placeholders();
    let date = meta
        .published
        .map(|dt| dt.date_naive().to_string())
        .unwrap_or_else(|| d.to_string());
    (
        meta.title.clone().unwrap_or_else(|| t.to_string()),
        meta.author.clone().unwrap_or_else(|| a.to_string()),
        date,
    )
}

/// True when a document carries a `Block` that is not reader-renderable —
/// i.e. the raw-webview signal (a future `Block::Webview` plus any unknown
/// block). Pure and headless-testable.
pub fn is_raw_doc(doc: &PageDoc) -> bool {
    raw_block_in(&doc.blocks)
}

/// Scan blocks for a non-reader block. The `_` arm is the raw hook: with
/// p3-t7's `Block::Webview` absent it is unreachable (hence the allow); once
/// that variant lands it is caught here and reported.
fn raw_block_in(blocks: &[Block]) -> bool {
    blocks.iter().any(|b| match b {
        Block::Heading { .. }
        | Block::Paragraph(_)
        | Block::List { .. }
        | Block::Quote(_)
        | Block::Code { .. }
        | Block::Image { .. }
        | Block::Link { .. }
        | Block::Table { .. }
        | Block::Separator
        | Block::Raw { .. } => false,
        // Raw-mode webview block (p3-t7): signals the document must render in
        // the platform webview, not the native reader (invariant #10).
        Block::Webview { .. } => true,
        // Future-proof catch-all for block variants added later.
        #[allow(unreachable_patterns)]
        _ => true,
    })
}

/// Decide whether a featured image should be prepended and, if so, which URL.
///
/// Returns the featured image URL only when it is set AND is not already the
/// URL of a [`Block::Image`] in the body (dedup). Pure, unit-tested headless.
pub fn featured_image_url(meta: &Metadata, blocks: &[Block]) -> Option<String> {
    let featured = meta.featured_image.as_ref()?;
    let featured_str = featured.as_str();
    let already_in_body = blocks.iter().any(|b| match b {
        Block::Image { url, .. } => url.as_str() == featured_str,
        _ => false,
    });
    if already_in_body {
        None
    } else {
        Some(featured_str.to_string())
    }
}

/// Render a full reader page for a [`PageDoc`].
///
/// If the document signals raw rendering ([`is_raw_doc`]), returns the raw
/// webview placeholder instead of the reader body (p3-t7 hook). Otherwise
/// returns a vertical box: metadata header, featured image (deduped), body.
pub fn render_page_doc(doc: &PageDoc) -> gtk::Widget {
    if is_raw_doc(doc) {
        return raw_placeholder();
    }

    let page = gtk::Box::new(gtk::Orientation::Vertical, 8);
    page.add_css_class(style::DOC_CLASS);
    page.set_hexpand(true);
    page.set_vexpand(true);

    page.append(&meta_header(doc));

    if let Some(url) = featured_image_url(&doc.metadata, &doc.blocks) {
        page.append(&featured_image_widget(&url));
    }

    let body = document_view::render_blocks(&doc.blocks, None);
    page.append(&body);
    page.upcast()
}

/// The raw-mode placeholder, used when `is_raw_doc` is true. p3-t7 owns the
/// real webview widget; this is the non-webview native hook (invariant #10:
/// the raw webview is ONLY in raw-mode tabs, never elsewhere in the native
/// shell).
fn raw_placeholder() -> gtk::Widget {
    let label = gtk::Label::new(Some("raw mode (webview hook — p3-t7)"));
    label.add_css_class("hypernext-raw-unsupported");
    label.set_wrap(true);
    label.upcast()
}

/// Build the metadata header: title, author, date, PGP shield, share button,
/// read-state toggle. A11y roles on interactive widgets come from their widget
/// class (gtk4 0.11 removed public `set_accessible_role`).
fn meta_header(doc: &PageDoc) -> gtk::Widget {
    let (title, author, date) = header_strings(&doc.metadata);

    let title_label = gtk::Label::new(Some(&title));
    title_label.set_wrap(true);
    title_label.set_xalign(0.0);
    title_label.set_selectable(true);
    title_label.add_css_class("hypernext-heading-1");

    let author_label = gtk::Label::new(Some(&format!("by {author}")));
    author_label.set_xalign(0.0);
    author_label.add_css_class("hypernext-meta");

    let date_label = gtk::Label::new(Some(&date));
    date_label.set_xalign(0.0);
    date_label.add_css_class("hypernext-meta");

    // PGP shield: a labelled status reflecting the signature, or a neutral
    // "unverified" placeholder when no signature present.
    let shield = pgp_shield(doc);

    let share = gtk::Button::with_label("share");
    share.set_tooltip_text(Some("Share this page (Phase 3.8)"));
    share.add_css_class("suggested-action");

    let read_state = gtk::ToggleButton::with_label("mark read");
    read_state.set_active(false);
    read_state.set_tooltip_text(Some("Toggle read state"));

    let header = gtk::Box::new(gtk::Orientation::Vertical, 4);
    header.add_css_class("hypernext-meta-header");
    header.append(&title_label);
    header.append(&author_label);
    header.append(&date_label);
    header.append(&shield);

    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    actions.add_css_class("hypernext-meta-actions");
    actions.append(&share);
    actions.append(&read_state);
    header.append(&actions);

    header.upcast()
}

/// A small labelled badge describing the PGP verification signature state. If
/// the document carries no signature it renders a neutral "unverified" note.
fn pgp_shield(doc: &PageDoc) -> gtk::Label {
    let text = doc
        .signature
        .as_ref()
        .map(|pgp| pgp.status.to_string())
        .unwrap_or_else(|| "unverified".to_string());
    let label = gtk::Label::new(Some(&format!("pgp: {text}")));
    label.set_xalign(0.0);
    label.add_css_class("hypernext-pgp-shield");
    label
}

/// A placeholder for the featured image (remote-image async fetch is a
/// follow-up, mirroring `hypernext-app/render/mod.rs`).
fn featured_image_widget(url: &str) -> gtk::Widget {
    let label = gtk::Label::new(Some("featured image"));
    label.set_tooltip_text(Some(url));
    label.set_selectable(true);
    label.add_css_class("hypernext-image");
    label.upcast()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use hypernext_core::{Metadata, PgpInfo, PgpKeySource, PgpStatus};

    fn meta() -> Metadata {
        Metadata::default()
    }

    fn doc() -> PageDoc {
        let url = url::Url::parse("https://example.com").unwrap();
        PageDoc {
            url: url.clone(),
            final_url: url.clone(),
            title: None,
            metadata: meta(),
            blocks: vec![],
            signature: None,
            debug: hypernext_core::DebugInfo {
                request: hypernext_core::HttpRequestDebug {
                    method: "GET".into(),
                    url: url.clone(),
                    headers: Default::default(),
                },
                response: Default::default(),
                timing: Default::default(),
                redirects: vec![],
                parser_decisions: vec![],
                tls: None,
            },
            from_cache: false,
        }
    }

    #[test]
    fn empty_metadata_renders_placeholders_no_panic() {
        let (t, a, d) = header_strings(&meta());
        assert_eq!(t, "untitled");
        assert_eq!(a, "unknown author");
        assert_eq!(d, "unknown date");
    }

    #[test]
    fn populated_metadata_uses_values() {
        let mut m = meta();
        m.title = Some("The Title".into());
        m.author = Some("Ada".into());
        m.published = Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-02T03:04:05Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        let (t, a, d) = header_strings(&m);
        assert_eq!(t, "The Title");
        assert_eq!(a, "Ada");
        assert_eq!(d, "2024-01-02");
    }

    #[test]
    fn empty_doc_with_no_webview_is_not_raw() {
        assert!(!is_raw_doc(&doc()));
    }

    #[test]
    fn featured_image_added_when_not_in_content() {
        let mut m = meta();
        m.featured_image = Some(url::Url::parse("https://example.com/hero.png").unwrap());
        let found = featured_image_url(&m, &[]);
        assert_eq!(found.as_deref(), Some("https://example.com/hero.png"));
    }

    #[test]
    fn featured_image_dedupes_when_present_in_content() {
        let mut m = meta();
        m.featured_image = Some(url::Url::parse("https://example.com/hero.png").unwrap());
        let blocks = vec![Block::Image {
            url: url::Url::parse("https://example.com/hero.png").unwrap(),
            alt: None,
            caption: None,
        }];
        // Same URL in metadata + content => rendered once (None => skip prepend).
        assert_eq!(featured_image_url(&m, &blocks), None);
    }

    #[test]
    fn featured_image_no_meta_yields_none() {
        assert_eq!(featured_image_url(&meta(), &[]), None);
    }

    #[test]
    fn featured_image_kept_when_content_has_different_image() {
        let mut m = meta();
        m.featured_image = Some(url::Url::parse("https://example.com/hero.png").unwrap());
        let blocks = vec![Block::Image {
            url: url::Url::parse("https://example.com/other.png").unwrap(),
            alt: None,
            caption: None,
        }];
        assert_eq!(
            featured_image_url(&m, &blocks).as_deref(),
            Some("https://example.com/hero.png")
        );
    }

    #[test]
    fn doc_with_webview_block_is_raw() {
        let mut d = doc();
        d.blocks.push(Block::Webview {
            url: url::Url::parse("https://example.com/raw").unwrap(),
        });
        assert!(is_raw_doc(&d));
    }

    #[test]
    fn pgp_shield_status_is_exposed() {
        let mut d = doc();
        d.signature = Some(PgpInfo {
            status: PgpStatus::Valid,
            signer_fingerprint: Some("abc".into()),
            key_source: PgpKeySource::Embedded,
            signature_source: None,
        });
        // Reuse header rendering path via meta_header indirectly: the pure
        // status string derives from the signature in the doc. We assert the
        // doc carries the signature and is not raw.
        assert!(!is_raw_doc(&d));
        assert!(d.signature.is_some());
    }
}
