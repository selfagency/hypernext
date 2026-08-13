//! Pure, GTK-free mapping logic for the document renderer.
//!
//! Kept free of any GTK types so it can be unit-tested without initializing a
//! GTK runtime (which on macOS must happen on the main thread).

use hypernext_core::Block;
use hypernext_core::Span;

/// CSS class applied to the top-level container of a rendered document.
pub const DOC_CLASS: &str = "hypernext-document";

/// CSS class applied to a rendered link (Lightning / gopher / gemini links).
pub const LINK_CLASS: &str = "hypernext-link";

/// The CSS class used for a rendered `Block::Raw` placeholder ("unsupported
/// content").
pub const RAW_UNSUPPORTED_CLASS: &str = "hypernext-raw-unsupported";

/// Map a block kind to its themeable CSS class.
///
/// This is a pure function so the block-kind -> CSS-class mapping can be
/// unit-tested without a GTK runtime (per task p2-t9 / ADR 0005).
pub fn block_css_class(block: &Block) -> &'static str {
    match block {
        Block::Heading { level, .. } => match level {
            1 => "hypernext-heading-1",
            2 => "hypernext-heading-2",
            _ => "hypernext-heading-3",
        },
        Block::Paragraph(_) => "hypernext-paragraph",
        Block::List { .. } => "hypernext-list",
        Block::Quote(_) => "hypernext-quote",
        Block::Code { .. } => "hypernext-code",
        Block::Image { .. } => "hypernext-image",
        Block::Link { .. } => LINK_CLASS,
        Block::Table { .. } => "hypernext-table",
        Block::Separator => "hypernext-separator",
        Block::Raw { mime, .. } => {
            if is_image_mime(mime) {
                "hypernext-image"
            } else {
                RAW_UNSUPPORTED_CLASS
            }
        }
        Block::Webview { .. } => "hypernext-webview",
    }
}

/// True if `mime` is a safe-to-display image type.
///
/// Only image payloads are rendered from `Block::Raw` v1. Everything else —
/// notably HTML and JavaScript — is shown as an "unsupported content"
/// placeholder. This is the guard that upholds invariant #10 (raw-mode webview
/// is the ONLY place HTML/script is ever rendered; the native shell never
/// executes web content).
pub fn is_image_mime(mime: &str) -> bool {
    mime.starts_with("image/") && mime != "image/svg+xml"
}

/// Escape a plain-text fragment for safe embedding in Pango markup.
///
/// Pango interprets the same five entities as XML; text that contains a literal
/// `<`, `>`, `&`, or `"` must be escaped before it is placed inside markup.
fn escape_pango(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Convert a [`Span`] into Pango markup for display in a `gtk::Label`.
///
/// Each [`SpanRun`](hypernext_core::SpanRun) is escaped and wrapped in the
/// markup tags its [`SpanStyle`](hypernext_core::SpanStyle) requests: `<b>` bold,
/// `<i>` italic, `<u>` underline,
/// `<s>` strikethrough, `<tt>` inline code / monospace.
///
/// Public and pure: exercised by the unit tests below and reused by the GTK
/// renderer, so markup and class-mapping stay consistent and testable together.
pub fn span_to_pango(span: &Span) -> String {
    let mut out = String::new();
    for run in &span.runs {
        let mut s = escape_pango(&run.text);
        // Wrap outward so nested tags are LIFO: <tt> then <i> then <b> yields
        // <b><i><tt>body</tt></i></b>, which Pango closes in the right order.
        if run.style.preformatted || run.style.code {
            s = format!("<tt>{s}</tt>");
        }
        if run.style.strikethrough {
            s = format!("<s>{s}</s>");
        }
        if run.style.underline {
            s = format!("<u>{s}</u>");
        }
        if run.style.italic {
            s = format!("<i>{s}</i>");
        }
        if run.style.bold {
            s = format!("<b>{s}</b>");
        }
        out.push_str(&s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::{Span, SpanStyle};

    fn heading(level: u8) -> Block {
        Block::Heading {
            level,
            text: "Hi".into(),
            id: None,
        }
    }

    #[test]
    fn heading_level_selects_css_class() {
        assert_eq!(block_css_class(&heading(1)), "hypernext-heading-1");
        assert_eq!(block_css_class(&heading(2)), "hypernext-heading-2");
        assert_eq!(block_css_class(&heading(3)), "hypernext-heading-3");
        // Levels above 3 fall back to heading-3 (there are only three sizes).
        assert_eq!(block_css_class(&heading(4)), "hypernext-heading-3");
        assert_eq!(block_css_class(&heading(0)), "hypernext-heading-3");
    }

    #[test]
    fn inline_blocks_map_to_their_classes() {
        assert_eq!(
            block_css_class(&Block::Paragraph(Span::default())),
            "hypernext-paragraph"
        );
        assert_eq!(
            block_css_class(&Block::List {
                ordered: false,
                items: vec![]
            }),
            "hypernext-list"
        );
        assert_eq!(
            block_css_class(&Block::Quote(Span::default())),
            "hypernext-quote"
        );
        assert_eq!(
            block_css_class(&Block::Code {
                language: None,
                text: "x".into()
            }),
            "hypernext-code"
        );
        assert_eq!(block_css_class(&Block::Separator), "hypernext-separator");
    }

    #[test]
    fn empty_span_renders_to_empty_markup() {
        assert_eq!(span_to_pango(&Span::default()), "");
    }

    #[test]
    fn plain_run_is_escaped() {
        let span = Span {
            runs: vec![hypernext_core::SpanRun {
                text: "a < b & c > \"d\"".into(),
                style: SpanStyle::default(),
                link: None,
            }],
        };
        assert_eq!(span_to_pango(&span), "a &lt; b &amp; c &gt; &quot;d&quot;");
    }

    #[test]
    fn bold_and_code_apply_markup_tags() {
        let span = Span {
            runs: vec![
                hypernext_core::SpanRun {
                    text: "bold".into(),
                    style: SpanStyle {
                        bold: true,
                        ..Default::default()
                    },
                    link: None,
                },
                hypernext_core::SpanRun {
                    text: "x<y".into(),
                    style: SpanStyle {
                        code: true,
                        ..Default::default()
                    },
                    link: None,
                },
            ],
        };
        assert_eq!(span_to_pango(&span), "<b>bold</b><tt>x&lt;y</tt>");
    }

    #[test]
    fn multi_style_flags_compose() {
        let span = Span {
            runs: vec![hypernext_core::SpanRun {
                text: "both".into(),
                style: SpanStyle {
                    bold: true,
                    italic: true,
                    ..Default::default()
                },
                link: None,
            }],
        };
        assert_eq!(span_to_pango(&span), "<b><i>both</i></b>");
    }

    #[test]
    fn image_mimes_are_safe() {
        assert!(is_image_mime("image/png"));
        assert!(is_image_mime("image/jpeg"));
        assert!(is_image_mime("image/gif"));
        assert!(is_image_mime("image/webp"));
    }

    #[test]
    fn non_image_mimes_are_unsafe() {
        assert!(!is_image_mime("text/html"));
        assert!(!is_image_mime("text/javascript"));
        assert!(!is_image_mime("application/x-sh"));
        assert!(!is_image_mime(""));
        // SVG can embed scripts; never render it from Raw bytes.
        assert!(!is_image_mime("image/svg+xml"));
    }

    #[test]
    fn raw_image_maps_to_image_class_and_others_to_unsupported() {
        assert_eq!(
            block_css_class(&Block::Raw {
                mime: "image/png".into(),
                bytes: vec![]
            }),
            "hypernext-image"
        );
        let html = Block::Raw {
            mime: "text/html".into(),
            bytes: vec![],
        };
        assert_eq!(block_css_class(&html), RAW_UNSUPPORTED_CLASS);
    }

    #[test]
    fn webview_block_maps_to_webview_class() {
        assert_eq!(
            block_css_class(&Block::Webview {
                url: "https://example.com/".parse().unwrap()
            }),
            "hypernext-webview"
        );
    }
}
