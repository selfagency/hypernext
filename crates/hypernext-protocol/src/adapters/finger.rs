//! Finger adapter (RFC 1288).
//!
//! `finger://host/user[?verbose=true]` dials TCP port 79, sends a finger
//! query line, and reads the reply back. RFC 1288 fixes no structure: the
//! server prints whatever text it wants, so this adapter parses the reply
//! into whitespace-preserving preformatted sections, keeps any PGP armor tail
//! intact (for the PGP key lookup flow), and treats an empty reply (user not
//! found) as [`HypernextError::NotFound`].
//!
//! **SSRF (invariant #8):** the underlying `finger-protocol` crate dials
//! `TcpStream::connect` itself, so the adapter runs `FetchPolicy::check_url`
//! BEFORE calling it — the SSRF gate is the pre-connect check.
//!
//! **Cancellation:** the crate reads to EOF with no timeout, so the adapter
//! wraps the call in `tokio::select!` with the `FetchContext::cancel` token.

use async_trait::async_trait;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HypernextError, Metadata, PageDoc, Span, SpanRun, SpanStyle,
};
use std::collections::HashMap;
use url::Url;

use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Finger's well-known port (RFC 1288).
pub const FINGER_PORT: u16 = 79;

/// A finger adapter. Stateless; holds no resources between fetches.
pub struct FingerAdapter;

impl FingerAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FingerAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Protocol for FingerAdapter {
    fn scheme(&self) -> &'static str {
        "finger"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it across
        // `.await` would make the async-trait future `!Send`.
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("finger URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(FINGER_PORT);

        // SSRF gate before dialing (the crate does its own TcpStream::connect).
        let vetted = policy.check_url(&host, port).await?;

        let user = user_from_url(url);
        let verbose = verbose_from_url(url);
        let query = finger_protocol::Query { user, verbose };

        // Cancellation: the crate reads to EOF with no timeout, so select! on
        // the token is the only cooperative-cancel hook.
        let response = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = finger_protocol::query(&vetted.host, vetted.port, &query) => {
                r.map_err(map_client_error)?
            }
        };

        if response.body.len() > policy.max_response_size {
            return Err(HypernextError::SizeLimitExceeded(response.body.len()));
        }

        let text = String::from_utf8_lossy(&response.body);
        let blocks = parse_finger(&text)?;

        Ok(PageDoc {
            url: url.clone(),
            final_url: url.clone(),
            title: None,
            metadata: Metadata::default(),
            blocks,
            signature: None,
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: "FINGER".to_string(),
                    url: url.clone(),
                    headers: HashMap::new(),
                },
                response: Default::default(),
                timing: Default::default(),
                redirects: vec![],
                parser_decisions: vec![],
                tls: None,
            },
            from_cache: false,
        })
    }
}

/// The user a finger URL names: the path if present, else the userinfo, else
/// none for a host listing. Mirrors the crate's own `query_from_url`.
fn user_from_url(url: &Url) -> Option<String> {
    let from_path = url.path().trim_start_matches('/');
    if !from_path.is_empty() {
        Some(from_path.to_string())
    } else if !url.username().is_empty() {
        Some(url.username().to_string())
    } else {
        None
    }
}

/// The RFC 1288 `/W` verbose switch, driven by `?verbose=true`.
fn verbose_from_url(url: &Url) -> bool {
    url.query_pairs()
        .any(|(k, v)| k == "verbose" && v == "true")
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: finger_protocol::ClientError) -> HypernextError {
    match e {
        finger_protocol::ClientError::BadUrl(m) => HypernextError::InvalidUrl(m),
        finger_protocol::ClientError::Connect(m) => {
            HypernextError::Network(format!("connect: {m}"))
        }
        finger_protocol::ClientError::Io(m) => HypernextError::Network(format!("io: {m}")),
    }
}

/// Parse a finger reply body into preformatted [`Block::Paragraph`] sections.
///
/// - Sections are separated by one-or-more blank lines; each keeps its
///   internal line breaks and leading whitespace (raw/unknown sections are
///   preserved verbatim).
/// - A `-----BEGIN PGP ...` armor block is kept whole as a single section,
///   including its internal blank lines, so the PGP key lookup can recover
///   the exact armor.
/// - A `Plan:` header and its following text form one section (the RFC 1288
///   Plan convention).
/// - An empty (or all-whitespace) body is a "user not found" reply and maps
///   to [`HypernextError::NotFound`].
pub fn parse_finger(body: &str) -> Result<Vec<Block>, HypernextError> {
    let lines: Vec<&str> = body.lines().collect();
    if lines.iter().all(|l| l.trim().is_empty()) {
        return Err(HypernextError::NotFound(
            "finger: empty response (user not found)".to_string(),
        ));
    }

    let mut blocks: Vec<Block> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        // Skip inter-section blank lines.
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        if i >= lines.len() {
            break;
        }

        let start = i;
        // A PGP armor block consumes through its END marker, blank lines
        // included, so the armor survives intact.
        if is_pgp_begin(lines[i]) {
            let mut j = i + 1;
            while j < lines.len() && !is_pgp_end(lines[j]) {
                j += 1;
            }
            if j < lines.len() {
                j += 1; // include the END PGP line
            }
            blocks.push(section_block(lines[start..j].join("\n")));
            i = j;
            continue;
        }

        // A normal section runs to the next blank line.
        let mut j = i + 1;
        while j < lines.len() && !lines[j].trim().is_empty() {
            j += 1;
        }
        blocks.push(section_block(lines[start..j].join("\n")));
        i = j;
    }

    if blocks.is_empty() {
        return Err(HypernextError::NotFound(
            "finger: empty response (user not found)".to_string(),
        ));
    }
    Ok(blocks)
}

fn is_pgp_begin(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("-----BEGIN PGP")
}

fn is_pgp_end(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("-----END PGP")
}

/// Wrap a section as a preformatted paragraph (whitespace preserved).
fn section_block(text: String) -> Block {
    Block::Paragraph(Span {
        runs: vec![SpanRun {
            text,
            style: SpanStyle {
                preformatted: true,
                ..Default::default()
            },
            link: None,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAN_FIXTURE: &str = "\
Login: alice                Name: Alice Example
Directory: /home/alice      Shell: /bin/zsh

Plan:
  - write the smolnet client
  - ship phase two
  - drink tea";

    const PGP_FIXTURE: &str = "\
Login: bob                 Name: Bob Signer
Directory: /home/bob

-----BEGIN PGP PUBLIC KEY BLOCK-----

mQENBFxExampleKeyHere
=ABCD
-----END PGP PUBLIC KEY BLOCK-----";

    fn plan_text(blocks: &[Block]) -> String {
        blocks
            .iter()
            .filter_map(|b| match b {
                Block::Paragraph(span) => Some(
                    span.runs
                        .iter()
                        .map(|r| r.text.as_str())
                        .collect::<Vec<_>>()
                        .join(""),
                ),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn parse_fixture_with_plan_section() {
        let blocks = parse_finger(PLAN_FIXTURE).unwrap();
        let text = plan_text(&blocks);
        assert!(text.contains("Plan:"), "plan header present: {text}");
        assert!(text.contains("ship phase two"), "plan body present: {text}");
        // Two sections: the login header block and the plan block.
        assert_eq!(blocks.len(), 2);
        // Preformatted style is set on every run.
        for b in &blocks {
            if let Block::Paragraph(span) = b {
                assert!(span.runs.iter().all(|r| r.style.preformatted));
            }
        }
    }

    #[test]
    fn parse_fixture_preserves_pgp_armor() {
        let blocks = parse_finger(PGP_FIXTURE).unwrap();
        let text = plan_text(&blocks);
        // The armor must survive intact, including its internal blank line.
        assert!(
            text.contains("-----BEGIN PGP PUBLIC KEY BLOCK-----"),
            "armor begin preserved"
        );
        assert!(
            text.contains("-----END PGP PUBLIC KEY BLOCK-----"),
            "armor end preserved"
        );
        // The armor is one section; the login header is another.
        assert_eq!(blocks.len(), 2);
        // The armor's internal blank line is not treated as a section break.
        let armor_section = text
            .split("-----BEGIN PGP PUBLIC KEY BLOCK-----")
            .nth(1)
            .unwrap();
        assert!(
            armor_section.contains("\n\nmQEN"),
            "armor internal blank line intact"
        );
    }

    #[test]
    fn parse_preserves_whitespace_in_raw_sections() {
        let raw = "  leading spaces\n\tand a tab line\n    indented block";
        let blocks = parse_finger(raw).unwrap();
        assert_eq!(blocks.len(), 1);
        if let Block::Paragraph(span) = &blocks[0] {
            assert_eq!(span.runs[0].text, raw, "whitespace preserved verbatim");
        }
    }

    #[test]
    fn parse_empty_response_returns_not_found() {
        let err = parse_finger("").unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
        let err = parse_finger("   \n  \n").unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn user_from_path_or_userinfo_or_listing() {
        assert_eq!(
            user_from_url(&Url::parse("finger://example.org/alice").unwrap()).as_deref(),
            Some("alice")
        );
        assert_eq!(
            user_from_url(&Url::parse("finger://bob@example.org").unwrap()).as_deref(),
            Some("bob")
        );
        assert_eq!(
            user_from_url(&Url::parse("finger://example.org/").unwrap()),
            None
        );
    }

    #[test]
    fn verbose_only_when_query_true() {
        assert!(!verbose_from_url(&Url::parse("finger://h/user").unwrap()));
        assert!(verbose_from_url(
            &Url::parse("finger://h/user?verbose=true").unwrap()
        ));
        assert!(!verbose_from_url(
            &Url::parse("finger://h/user?verbose=false").unwrap()
        ));
        assert!(!verbose_from_url(
            &Url::parse("finger://h/user?verbose=yes").unwrap()
        ));
    }
}
