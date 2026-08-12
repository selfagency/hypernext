//! Domain model for Hypernext.
//!
//! These types are the contract between every crate. Every protocol adapter
//! returns a [`PageDoc`]; the UI and storage layers consume it. Getting these
//! right early prevents cascading changes later.

use std::collections::HashMap;
use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use url::Url;

/// A fetched document, normalized across all protocols.
/// Every protocol adapter returns one of these.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PageDoc {
    pub url: Url,
    /// Final URL after redirects.
    pub final_url: Url,
    pub title: Option<String>,
    pub metadata: Metadata,
    pub blocks: Vec<Block>,
    pub signature: Option<PgpInfo>,
    pub debug: DebugInfo,
    pub from_cache: bool,
}

/// Page-level metadata extracted from the document.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Metadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub published: Option<DateTime<Utc>>,
    pub updated: Option<DateTime<Utc>>,
    pub site_name: Option<String>,
    pub canonical_url: Option<Url>,
    pub favicon_url: Option<Url>,
    pub featured_image: Option<Url>,
    pub og: HashMap<String, String>,
    pub twitter: HashMap<String, String>,
    pub json_ld: Vec<serde_json::Value>,
}

/// A single content block in a normalized document.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Block {
    Heading {
        level: u8,
        text: String,
        id: Option<String>,
    },
    Paragraph(Span),
    List {
        ordered: bool,
        items: Vec<Span>,
    },
    Quote(Span),
    Code {
        language: Option<String>,
        text: String,
    },
    Image {
        url: Url,
        alt: Option<String>,
        caption: Option<Span>,
    },
    /// Gopher menu line, Gemini link line, etc.
    Link {
        url: Url,
        text: Span,
    },
    Table {
        headers: Vec<Span>,
        rows: Vec<Vec<Span>>,
    },
    Separator,
    /// For protocols that emit binary.
    Raw {
        mime: String,
        bytes: Vec<u8>,
    },
}

/// A run of styled text.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Span {
    pub runs: Vec<SpanRun>,
}

/// A single styled text run.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SpanRun {
    pub text: String,
    pub style: SpanStyle,
    pub link: Option<Url>,
}

/// Inline text styling flags.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpanStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub code: bool,
    pub preformatted: bool,
}

/// PGP signature verification result for a document.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PgpInfo {
    pub status: PgpStatus,
    pub signer_fingerprint: Option<String>,
    pub key_source: PgpKeySource,
    /// URL or "inline".
    pub signature_source: Option<String>,
}

/// Verification status of a PGP signature.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PgpStatus {
    Valid,
    ValidUntrusted,
    Invalid,
    Missing,
    Unsupported,
    Unverified,
    KeyChanged,
}

/// Where the signing key was obtained.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PgpKeySource {
    Embedded,
    FingerLookup,
    KeysOpenpgpOrg,
}

/// Debug/timing information for a fetch, for diagnostics and the inspector.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DebugInfo {
    pub request: HttpRequestDebug,
    pub response: HttpResponseDebug,
    pub timing: TimingDebug,
    pub redirects: Vec<RedirectHop>,
    pub parser_decisions: Vec<String>,
    pub tls: Option<TlsDebug>,
}

/// Outbound HTTP request details.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct HttpRequestDebug {
    pub method: String,
    pub url: Url,
    pub headers: HashMap<String, String>,
}

/// Inbound HTTP response details.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct HttpResponseDebug {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
}

/// Timing breakdown of a fetch.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct TimingDebug {
    pub dns_ms: Option<u64>,
    pub connect_ms: Option<u64>,
    pub tls_ms: Option<u64>,
    pub ttfb_ms: Option<u64>,
    pub total_ms: Option<u64>,
}

/// A single redirect hop.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RedirectHop {
    pub from: Url,
    pub to: Url,
    pub status: u16,
}

/// TLS connection details.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct TlsDebug {
    pub version: Option<String>,
    pub cipher: Option<String>,
    pub peer_certificate: Option<String>,
}

impl fmt::Display for PgpStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PgpStatus::Valid => "valid",
            PgpStatus::ValidUntrusted => "valid-untrusted",
            PgpStatus::Invalid => "invalid",
            PgpStatus::Missing => "missing",
            PgpStatus::Unsupported => "unsupported",
            PgpStatus::Unverified => "unverified",
            PgpStatus::KeyChanged => "key-changed",
        };
        f.write_str(s)
    }
}

impl fmt::Display for PgpKeySource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PgpKeySource::Embedded => "embedded",
            PgpKeySource::FingerLookup => "finger-lookup",
            PgpKeySource::KeysOpenpgpOrg => "keys.openpgp.org",
        };
        f.write_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_url() -> Url {
        Url::parse("https://example.com/").unwrap()
    }

    fn sample_span() -> Span {
        Span {
            runs: vec![
                SpanRun {
                    text: "bold ".to_string(),
                    style: SpanStyle {
                        bold: true,
                        ..Default::default()
                    },
                    link: None,
                },
                SpanRun {
                    text: "italic".to_string(),
                    style: SpanStyle {
                        italic: true,
                        ..Default::default()
                    },
                    link: None,
                },
            ],
        }
    }

    #[test]
    fn page_doc_round_trips_via_serde() {
        let doc = PageDoc {
            url: sample_url(),
            final_url: sample_url(),
            title: Some("Example".to_string()),
            metadata: Metadata {
                title: Some("Example".to_string()),
                description: Some("A page".to_string()),
                author: Some("Alice".to_string()),
                published: Some(
                    DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
                        .unwrap()
                        .with_timezone(&Utc),
                ),
                updated: None,
                site_name: Some("Example Site".to_string()),
                canonical_url: Some(sample_url()),
                favicon_url: None,
                featured_image: None,
                og: HashMap::from([("og:title".to_string(), "Example".to_string())]),
                twitter: HashMap::new(),
                json_ld: vec![serde_json::json!({"@type": "WebPage"})],
            },
            blocks: vec![Block::Paragraph(sample_span())],
            signature: Some(PgpInfo {
                status: PgpStatus::Valid,
                signer_fingerprint: Some("ABCD".to_string()),
                key_source: PgpKeySource::Embedded,
                signature_source: Some("inline".to_string()),
            }),
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: "GET".to_string(),
                    url: sample_url(),
                    headers: HashMap::new(),
                },
                response: HttpResponseDebug::default(),
                timing: TimingDebug::default(),
                redirects: Vec::new(),
                parser_decisions: Vec::new(),
                tls: None,
            },
            from_cache: false,
        };

        let json = serde_json::to_string(&doc).unwrap();
        let back: PageDoc = serde_json::from_str(&json).unwrap();
        assert_eq!(doc, back);
    }

    #[test]
    fn block_image_with_caption_round_trips() {
        let block = Block::Image {
            url: sample_url(),
            alt: Some("alt text".to_string()),
            caption: Some(sample_span()),
        };

        let json = serde_json::to_string(&block).unwrap();
        let back: Block = serde_json::from_str(&json).unwrap();
        assert_eq!(block, back);
    }

    #[test]
    fn span_with_mixed_styles_serializes_correctly() {
        let span = sample_span();
        let json = serde_json::to_string(&span).unwrap();
        let back: Span = serde_json::from_str(&json).unwrap();
        assert_eq!(span, back);
        // Verify the style flags survive serialization.
        assert!(json.contains("\"bold\":true"));
        assert!(json.contains("\"italic\":true"));
    }

    #[test]
    fn all_enums_have_display() {
        // PgpStatus
        assert_eq!(PgpStatus::Valid.to_string(), "valid");
        assert_eq!(PgpStatus::ValidUntrusted.to_string(), "valid-untrusted");
        assert_eq!(PgpStatus::Invalid.to_string(), "invalid");
        assert_eq!(PgpStatus::Missing.to_string(), "missing");
        assert_eq!(PgpStatus::Unsupported.to_string(), "unsupported");
        assert_eq!(PgpStatus::Unverified.to_string(), "unverified");
        assert_eq!(PgpStatus::KeyChanged.to_string(), "key-changed");

        // PgpKeySource
        assert_eq!(PgpKeySource::Embedded.to_string(), "embedded");
        assert_eq!(PgpKeySource::FingerLookup.to_string(), "finger-lookup");
        assert_eq!(PgpKeySource::KeysOpenpgpOrg.to_string(), "keys.openpgp.org");
    }

    #[test]
    fn pgp_status_display_matches_bean_shield_ui() {
        let expected = [
            (PgpStatus::Valid, "valid"),
            (PgpStatus::ValidUntrusted, "valid-untrusted"),
            (PgpStatus::Invalid, "invalid"),
            (PgpStatus::Missing, "missing"),
            (PgpStatus::Unsupported, "unsupported"),
            (PgpStatus::Unverified, "unverified"),
            (PgpStatus::KeyChanged, "key-changed"),
        ];
        for (status, want) in expected {
            assert_eq!(status.to_string(), want);
        }
    }
}
