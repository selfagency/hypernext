//! Per-protocol fixture render tests (Phase 2 handoff h3, task p3-t6).
//!
//! Builds a representative [`PageDoc`] for each smolnet protocol and asserts
//! it renders through the `hypernext-ui` reader pipeline:
//!
//! - headless: the pure [`document_view::doc_to_entries`] transform produces
//!   the expected tagged text entries (no GTK display required, ADR 0005).
//! - display-gated ([`gtk_init_guard`]): the full [`reader_view::render_page_doc`]
//!   produces the expected widget tree shape.
//!
//! The display-gated variant is `#[ignore]`d and run under `xvfb-run` on CI
//! (see `docs/references/gtk-testing.md`).

use hypernext_core::{Block, Metadata, PageDoc, Span, SpanRun, SpanStyle};
use hypernext_ui::{document_view, reader_view};
use url::Url;

fn span(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.into(),
            style: SpanStyle::default(),
            link: None,
        }],
    }
}

fn link(text: &str, target: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.into(),
            style: SpanStyle::default(),
            link: Some(Url::parse(target).expect("valid url")),
        }],
    }
}

fn doc(url: &str, meta: Metadata, blocks: Vec<Block>) -> PageDoc {
    let url = Url::parse(url).expect("valid url");
    PageDoc {
        url: url.clone(),
        final_url: url.clone(),
        title: meta.title.clone(),
        metadata: meta,
        blocks,
        signature: None,
        debug: hypernext_core::DebugInfo {
            request: hypernext_core::HttpRequestDebug {
                method: "GET".into(),
                url,
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

fn meta(title: &str) -> Metadata {
    let mut m = Metadata::default();
    m.title = Some(title.into());
    m
}

/// Gopher: menu lines map to `Block::Link` + paragraph info lines.
fn gopher_doc() -> PageDoc {
    doc(
        "gopher://gopher.example/1",
        meta("Gopher hole"),
        vec![
            Block::Link {
                url: Url::parse("gopher://gopher.example/0/about.txt").unwrap(),
                text: link("About", "gopher://gopher.example/0/about.txt"),
            },
            Block::Paragraph(span("Welcome to the gopher hole.")),
        ],
    )
}

/// Gemini: heading + link line + paragraph.
fn gemini_doc() -> PageDoc {
    doc(
        "gemini://gemini.example/index.gmi",
        meta("Gemini capsule"),
        vec![
            Block::Heading {
                level: 1,
                text: "My capsule".into(),
                id: None,
            },
            Block::Paragraph(span("Hello, smolnet.")),
            Block::Link {
                url: Url::parse("gemini://gemini.example/about").unwrap(),
                text: link("About me", "gemini://gemini.example/about"),
            },
        ],
    )
}

/// Spartan: heading + quote + link.
fn spartan_doc() -> PageDoc {
    doc(
        "spartan://spartan.example/index",
        meta("Spartan page"),
        vec![
            Block::Heading {
                level: 1,
                text: "Spartan".into(),
                id: None,
            },
            Block::Quote(span("Minimal by design.")),
            Block::Link {
                url: Url::parse("spartan://spartan.example/links").unwrap(),
                text: link("Links", "spartan://spartan.example/links"),
            },
        ],
    )
}

/// Molerat / guppy: menu -> links.
fn molerat_doc() -> PageDoc {
    doc(
        "guppy://molerat.example/pub",
        meta("Molerat pub"),
        vec![
            Block::Link {
                url: Url::parse("guppy://molerat.example/pub/one").unwrap(),
                text: link("One", "guppy://molerat.example/pub/one"),
            },
            Block::Link {
                url: Url::parse("guppy://molerat.example/pub/two").unwrap(),
                text: link("Two", "guppy://molerat.example/pub/two"),
            },
        ],
    )
}

/// Plain text: paragraph with runs.
fn text_doc() -> PageDoc {
    doc(
        "text://text.example/notes",
        meta("Plain notes"),
        vec![Block::Paragraph(span("Just some plain text."))],
    )
}

/// NEX: headings + list + table.
fn nex_doc() -> PageDoc {
    doc(
        "nex://nex.example/readme",
        meta("NEX readme"),
        vec![
            Block::Heading {
                level: 2,
                text: "Features".into(),
                id: None,
            },
            Block::List {
                ordered: false,
                items: vec![span("fast"), span("small")],
            },
            Block::Table {
                headers: vec![span("k"), span("v")],
                rows: vec![vec![span("a"), span("1")]],
            },
        ],
    )
}

/// Every protocol doc is a plain reader document (no raw/webview blocks).
#[test]
fn all_protocol_fixtures_are_reader_renderable() {
    for d in [
        gopher_doc(),
        gemini_doc(),
        spartan_doc(),
        molerat_doc(),
        text_doc(),
        nex_doc(),
    ] {
        assert!(!reader_view::is_raw_doc(&d), "unexpected raw for {}", d.url);
    }
}

/// The pure transform maps every protocol doc's blocks to non-empty text, so
/// body content is present headless.
#[test]
fn all_protocol_fixtures_produce_text_entries() {
    let cases = [
        (gopher_doc(), "Welcome to the gopher hole."),
        (gemini_doc(), "My capsule"),
        (spartan_doc(), "Minimal by design."),
        (molerat_doc(), ""),
        (text_doc(), "Just some plain text."),
        (nex_doc(), "Features"),
    ];
    for (d, expect) in cases {
        let entries = document_view::doc_to_entries(&d.blocks);
        assert!(!entries.is_empty(), "{} produced no entries", d.url);
        if !expect.is_empty() {
            assert!(
                entries.iter().any(|e| e.text == expect),
                "{} missing {expect:?}",
                d.url
            );
        }
    }
}

/// A raw-mode doc (contains a `Block::Webview`) must be detected as raw.
#[test]
fn webview_doc_is_raw() {
    let mut d = gemini_doc();
    d.blocks.push(Block::Webview {
        url: Url::parse("https://example.com/raw").unwrap(),
    });
    assert!(reader_view::is_raw_doc(&d));
}

/// Display-gated: render each protocol doc and assert the widget tree shape.
/// Run with `cargo test -p hypernext-ui -- --ignored` under a display.
#[test]
#[ignore = "needs a GDK display to build the widget tree"]
fn protocol_docs_render_widget_tree() {
    if gtk_init_guard().is_err() {
        eprintln!("skipping: no display");
        return;
    }
    let docs = [
        gopher_doc(),
        gemini_doc(),
        spartan_doc(),
        molerat_doc(),
        text_doc(),
        nex_doc(),
    ];
    for d in docs {
        let widget = reader_view::render_page_doc(&d);
        // Rendered page is a vertical container (reader page), never the raw
        // placeholder for these reader docs.
        assert!(
            widget.is::<gtk::Box>(),
            "{} did not render to a reader page box",
            d.url
        );
    }
}

/// Display-gated: the reader body collapses text into one buffer (cross-block
/// selection), so a GtkTextView exists somewhere in the rendered tree.
#[test]
#[ignore = "needs a GDK display to build the widget tree"]
fn reader_body_contains_a_text_view() {
    if gtk_init_guard().is_err() {
        eprintln!("skipping: no display");
        return;
    }
    let d = gemini_doc();
    let widget = reader_view::render_page_doc(&d);
    let mut found = false;
    walk(&widget, &mut found);
    assert!(found, "a GtkTextView should anchor the reader body");
}

fn walk(widget: &gtk::Widget, found: &mut bool) {
    if widget.is::<gtk::TextView>() {
        *found = true;
        return;
    }
    let mut child = widget.first_child();
    while let Some(c) = child {
        walk(&c, found);
        if *found {
            return;
        }
        child = c.next_sibling();
    }
}

/// Initialize GTK; returns Err when no display is reachable (headless CI).
fn gtk_init_guard() -> Result<(), gtk::glib::BoolError> {
    gtk::init()
}

// Referenced so the `walk` helper has access to the GTK prelude.
use gtk::prelude::*;
use gtk4 as gtk;
