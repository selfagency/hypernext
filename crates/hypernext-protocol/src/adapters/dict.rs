//! DICT adapter — RFC 2229, a command-loop protocol (not one-shot fetch).
//!
//! DICT is stateful: the server greets you, you issue commands, and the
//! connection stays open until `QUIT`. Unlike Gemini/Gopher (one request, one
//! response, close), a DICT fetch is a **session**: connect → `DEFINE` (and
//! optionally `MATCH`) → `QUIT`. The adapter holds an open
//! [`dict_protocol::Session`] across those commands rather than reconnecting
//! per word.
//!
//! The crate's `Session::over(stream)` is transport-independent (accepts any
//! `AsyncRead + AsyncWrite + Unpin`), so this adapter:
//!
//! - **SSRF-checks** the host (invariant #8) before dialing,
//! - **wraps the TCP stream in TLS** with leaf-certificate TOFU pinning
//!   (DICT rides an encrypted carrier; the crate adds no TLS itself),
//! - then hands the TLS stream to `Session::over`.
//!
//! **No-match (552) is an empty `PageDoc`, not an error** — the crate returns
//! an empty `Vec<Definition>` for it, which the adapter maps to a doc with no
//! blocks.
//!
//! **Cancellation** (ADR 0008): each session command is wrapped in
//! `tokio::select!` against `FetchContext::cancel`.

use std::collections::HashMap;

use async_trait::async_trait;
use dict_protocol::{ClientError, Definition, Match, Session, DEFAULT_PORT};
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HypernextError, Metadata, PageDoc, Span, SpanRun, SpanStyle,
};
use url::Url;

use crate::adapters::tofu::tls_connect;
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// The DICT adapter. Stateless: TOFU pins live in the store, so a single unit
/// serves every fetch.
#[derive(Debug, Default)]
pub struct DictAdapter;

impl DictAdapter {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Protocol for DictAdapter {
    fn scheme(&self) -> &'static str {
        "dict"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            needs_tls: true,
            needs_tofu: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it
        // across `.await` would make the async-trait future `!Send`.
        let policy = ctx.policy;
        let cancel = ctx.cancel.clone();

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("dict URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(DEFAULT_PORT);

        // SSRF gate before dialing (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        // Open a TOFU-pinned TLS connection (the crate's `Session::over` is
        // transport-independent, so DICT rides the encrypted carrier).
        let mut tls = tls_connect(&vetted.host, vetted.port, ctx).await?;

        // Open the DICT session over the TLS stream (transport-independent).
        let cancel = cancel.clone();
        let mut session = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = Session::over(&mut tls) => r.map_err(map_client_error)?,
        };

        // The word to look up: the URL path (e.g. dict://host/word).
        let word = url.path().trim_start_matches('/').to_string();
        if word.is_empty() {
            return Err(HypernextError::InvalidUrl(
                "dict URL has no word in its path".to_string(),
            ));
        }

        // DEFINE across all databases. No-match (552) → empty vector → empty doc.
        let cancel = cancel.clone();
        let definitions = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = session.define("*", &word) => r.map_err(map_client_error)?,
        };

        // MATCH for a link list of near-matches (best-effort; a failure here
        // is not fatal — the definitions still stand).
        let cancel = cancel.clone();
        let matches = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = session.matches("*", "prefix", &word) => r.map_err(map_client_error).ok(),
        }
        .unwrap_or_default();

        // QUIT, consuming the session.
        let cancel = cancel.clone();
        tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = session.quit() => { let _ = r.map_err(map_client_error); }
        }

        let blocks = self.to_blocks(&definitions, &matches, url);
        let title = first_heading(&blocks).or_else(|| {
            if definitions.is_empty() {
                None
            } else {
                Some(word.clone())
            }
        });

        Ok(self.doc(url, url.clone(), blocks, title, &definitions))
    }
}

impl DictAdapter {
    /// Convert DICT definitions + matches into `Vec<Block>`.
    fn to_blocks(&self, definitions: &[Definition], matches: &[Match], base: &Url) -> Vec<Block> {
        let mut blocks = Vec::new();
        for def in definitions {
            blocks.push(Block::Heading {
                level: 2,
                text: format!("{} ({})", def.word, def.database),
                id: None,
            });
            for line in &def.text {
                blocks.push(Block::Paragraph(span(line)));
            }
        }
        if !matches.is_empty() {
            blocks.push(Block::Heading {
                level: 2,
                text: "Matches".to_string(),
                id: None,
            });
            for m in matches {
                let target = base.join(&m.word).unwrap_or_else(|_| base.clone());
                blocks.push(Block::Link {
                    url: target,
                    text: span(&format!("{} — {}", m.database, m.word)),
                });
            }
        }
        blocks
    }

    /// Build a normalized `PageDoc` with debug metadata.
    fn doc(
        &self,
        url: &Url,
        final_url: Url,
        blocks: Vec<Block>,
        title: Option<String>,
        definitions: &[Definition],
    ) -> PageDoc {
        PageDoc {
            url: url.clone(),
            final_url,
            title,
            metadata: Metadata::default(),
            blocks,
            signature: None,
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: "DEFINE".to_string(),
                    url: url.clone(),
                    headers: HashMap::new(),
                },
                response: hypernext_core::HttpResponseDebug {
                    status: 0,
                    headers: HashMap::new(),
                    content_type: Some("text/plain".to_string()),
                    content_length: Some(definitions.len() as u64),
                },
                timing: Default::default(),
                redirects: Vec::new(),
                parser_decisions: Vec::new(),
                tls: None,
            },
            from_cache: false,
        }
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: ClientError) -> HypernextError {
    match e {
        ClientError::Connect(m) => HypernextError::Network(m),
        ClientError::Io(m) => HypernextError::Network(m),
        ClientError::Protocol(m) => HypernextError::Protocol(m),
        ClientError::Refused { code, text } => {
            if code == 552 {
                // No match is an answer, not an error — but this path is only
                // reached if the crate surfaces it as Refused (it does not;
                // it returns an empty vector). Kept for completeness.
                HypernextError::NotFound(text)
            } else {
                HypernextError::Protocol(format!("server refused {code}: {text}"))
            }
        }
    }
}

/// A single unstyled text run.
fn span(text: &str) -> Span {
    Span {
        runs: vec![SpanRun {
            text: text.to_string(),
            style: SpanStyle::default(),
            link: None,
        }],
    }
}

/// The first level-1 heading's text, used as the page title.
fn first_heading(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|b| match b {
        Block::Heading { level: 1, text, .. } => Some(text.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn def(word: &str, db: &str, text: &[&str]) -> Definition {
        Definition {
            word: word.to_string(),
            database: db.to_string(),
            database_description: "desc".to_string(),
            text: text.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn m(db: &str, word: &str) -> Match {
        Match {
            database: db.to_string(),
            word: word.to_string(),
        }
    }

    #[test]
    fn definitions_map_to_heading_and_paragraphs() {
        let adapter = DictAdapter::new();
        let u = url("dict://example.com/smolweb");
        let blocks = adapter.to_blocks(&[def("smolweb", "wn", &["the small web"])], &[], &u);
        assert_eq!(
            blocks,
            vec![
                Block::Heading {
                    level: 2,
                    text: "smolweb (wn)".to_string(),
                    id: None,
                },
                Block::Paragraph(span("the small web")),
            ]
        );
    }

    #[test]
    fn matches_map_to_links() {
        let adapter = DictAdapter::new();
        let u = url("dict://example.com/smolweb");
        let blocks = adapter.to_blocks(&[], &[m("wn", "smolweb")], &u);
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::Link { url, .. } if url.as_str() == "dict://example.com/smolweb"
        )));
    }

    #[test]
    fn empty_definitions_and_matches_yield_no_blocks() {
        let adapter = DictAdapter::new();
        let u = url("dict://example.com/zzzz");
        let blocks = adapter.to_blocks(&[], &[], &u);
        assert!(blocks.is_empty());
    }

    #[test]
    fn no_match_is_an_empty_doc_not_an_error() {
        // The crate returns an empty Vec for 552; the adapter maps that to a
        // doc with no blocks and no title.
        let adapter = DictAdapter::new();
        let u = url("dict://example.com/zzzz");
        let blocks = adapter.to_blocks(&[], &[], &u);
        assert!(blocks.is_empty());
        let title = first_heading(&blocks);
        assert!(title.is_none());
    }

    #[test]
    fn map_client_error_covers_all_variants() {
        assert_eq!(
            map_client_error(ClientError::Connect("x".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Io("x".into())).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Protocol("x".into())).code(),
            "PROTOCOL_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Refused {
                code: 550,
                text: "invalid db".into()
            })
            .code(),
            "PROTOCOL_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Refused {
                code: 552,
                text: "no match".into()
            })
            .code(),
            "NOT_FOUND"
        );
    }
}
