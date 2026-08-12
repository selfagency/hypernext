//! WebFinger adapter (RFC 7033).
//!
//! WebFinger is the discovery step that resolves `@user@host` accounts on the
//! fediverse, OpenID Connect issuer discovery, and Solid Pod discovery. It is
//! a **reusable building block**, not a UI-facing protocol: other adapters
//! (Solid, Mastodon, ATProto) and the dispatcher call it to turn an account
//! into a JSON Resource Descriptor (JRD) with typed links.
//!
//! The `finger-protocol` crate is deliberately HTTP-free: it only builds the
//! well-known request URL ([`finger_protocol::webfinger::request_url`]) and
//! parses the JRD ([`finger_protocol::webfinger::parse`]). This adapter owns
//! the HTTPS GET via the injected `reqwest::Client`, so the request flows
//! through `FetchPolicy` (SSRF, redirects, size, timeout — invariant #8).
//!
//! A `404`/`410` maps to [`HypernextError::NotFound`]; a document that
//! parses but is missing its `subject` maps to [`HypernextError::InvalidResponse`]
//! (per RFC 7033 §4.4 the subject is required).

use async_trait::async_trait;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HypernextError, Metadata, PageDoc, Span, SpanRun, SpanStyle,
};
use std::collections::HashMap;
use url::Url;

use crate::dispatcher::{Capabilities, FetchContext, Protocol};

const WELL_KNOWN_PATH: &str = "/.well-known/webfinger";

/// A WebFinger adapter. Stateless; holds no resources between fetches.
pub struct WebFingerAdapter;

impl WebFingerAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WebFingerAdapter {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a WebFinger request URL (`https://host/.well-known/webfinger?resource=...`)
/// for an arbitrary resource URI (an `acct:` URI, a profile URL, etc.).
///
/// `rels` optionally filters the response; an empty slice requests all links.
/// The host is taken from `base`'s authority; the HTTPS GET itself is done by
/// [`WebFingerAdapter::fetch`].
pub fn request_url(base: &Url, resource: &str, rels: &[&str]) -> Url {
    let mut url = Url::parse(&finger_protocol::webfinger::request_url(
        base.host_str().unwrap_or_default(),
        resource,
        rels,
    ))
    .expect("finger-protocol request_url always yields a valid URL");
    if let Some(port) = base.port() {
        let _ = url.set_port(Some(port));
    }
    url
}

#[async_trait]
impl Protocol for WebFingerAdapter {
    fn scheme(&self) -> &'static str {
        "https"
    }

    fn path_prefix(&self) -> Option<&'static str> {
        // WebFinger only owns the well-known endpoint; the Dispatcher
        // sub-routes `https` so an HTTP adapter owns the rest of the scheme.
        Some("/.well-known/webfinger")
    }

    fn capabilities(&self) -> Capabilities {
        // Not UI-facing: this adapter exists for other adapters (Solid,
        // Mastodon, ATProto) and is deliberately never surfaced as a tab.
        Capabilities {
            supports_fetch: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        // Hoist Send+Sync fields out of `ctx` before awaiting: `ctx` borrows a
        // non-`Sync` `rusqlite::Connection`, so holding it across `.await` would
        // make the async-trait future `!Send`.
        let policy = ctx.policy;

        // The dispatcher routes every https:// URL here; if the path is not
        // the WebFinger well-known path, another https adapter owns it. We
        // only serve the well-known endpoint and bail otherwise.
        if url.path() != WELL_KNOWN_PATH {
            return Err(HypernextError::NotFound(format!(
                "webfinger: unexpected path {}",
                url.path()
            )));
        }

        // SSRF gate (invariant #8): pre-verify the target host before the GET.
        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("webfinger URL has no host".to_string()))?;
        let port = url
            .port()
            .unwrap_or(if url.scheme() == "http" { 80 } else { 443 });
        policy.check_url(host, port).await?;

        // Do not let reqwest auto-follow redirects: each hop must be
        // re-vetted by the Dispatcher (SSRF, invariant #8). We surface the
        // 3xx Location as `final_url` and let the Dispatcher loop re-route +
        // re-check_url each step. Redirect policy is a Client-level setting,
        // so a dedicated no-redirect client is built per call (WebFinger is a
        // lightweight discovery sub-step, not a hot path).
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| HypernextError::Network(e.to_string()))?;

        let response = client
            .get(url.clone())
            .header(
                reqwest::header::ACCEPT,
                finger_protocol::webfinger::MEDIA_TYPE,
            )
            .send()
            .await
            .map_err(|e| HypernextError::Network(e.to_string()))?;

        let status = response.status();
        if status.is_redirection() {
            // Hand back the redirect target for the Dispatcher to re-vet.
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| {
                    HypernextError::Network("webfinger: redirect without Location".to_string())
                })?;
            let next = url
                .join(location)
                .map_err(|e| HypernextError::InvalidUrl(format!("webfinger redirect: {e}")))?;
            return Ok(PageDoc {
                url: url.clone(),
                final_url: next,
                title: None,
                metadata: Default::default(),
                blocks: vec![],
                signature: None,
                debug: DebugInfo {
                    request: HttpRequestDebug {
                        method: "GET".to_string(),
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
            });
        }

        if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::GONE {
            return Err(HypernextError::NotFound(format!(
                "webfinger: HTTP {}",
                status.as_u16()
            )));
        }
        if !status.is_success() {
            return Err(HypernextError::Network(format!(
                "webfinger: HTTP {}",
                status.as_u16()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| HypernextError::Network(e.to_string()))?;
        if bytes.len() > policy.max_response_size {
            return Err(HypernextError::SizeLimitExceeded(bytes.len()));
        }

        let jrd = parse_webfinger(&bytes)?;
        let subject = jrd.subject.unwrap_or_default();

        let blocks = jrd
            .links
            .into_iter()
            .filter_map(link_block)
            .collect::<Vec<_>>();

        let metadata = Metadata {
            canonical_url: Some(url.clone()),
            ..Default::default()
        };

        Ok(PageDoc {
            url: url.clone(),
            final_url: url.clone(),
            title: Some(subject.clone()),
            metadata,
            blocks,
            signature: None,
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: "GET".to_string(),
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

/// Parse JRD bytes. Invalid JSON, a JSON document that is not a JRD, or a JRD
/// missing its required `subject` (RFC 7033 §4.4) maps to
/// [`HypernextError::InvalidResponse`].
fn parse_webfinger(bytes: &[u8]) -> Result<finger_protocol::Jrd, HypernextError> {
    let text = String::from_utf8_lossy(bytes);
    let jrd = finger_protocol::webfinger::parse(&text)
        .map_err(|e| HypernextError::InvalidResponse(format!("webfinger: {e}")))?;
    if jrd.subject.is_none() {
        return Err(HypernextError::InvalidResponse(
            "webfinger: missing subject field".to_string(),
        ));
    }
    Ok(jrd)
}

/// Convert a JRD `Link` into a `Block::Link`, skipping links with no usable
/// `href` or `template` (a link without a target has nothing to navigate to).
fn link_block(link: finger_protocol::Link) -> Option<Block> {
    let target = link.href.or(link.template)?;
    let parsed = Url::parse(&target).ok()?;
    let label = link
        .titles
        .get("und")
        .cloned()
        .unwrap_or_else(|| link.rel.clone());
    Some(Block::Link {
        url: parsed.clone(),
        text: Span {
            runs: vec![SpanRun {
                text: label,
                style: SpanStyle {
                    preformatted: true,
                    ..Default::default()
                },
                link: Some(parsed),
            }],
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MULTI_REL_JSON: &str = r#"{
      "subject": "acct:carol@example.com",
      "aliases": ["https://www.example.com/~carol/"],
      "links": [
        { "rel": "http://webfinger.example/rel/profile-page",
          "href": "https://www.example.com/~carol/" },
        { "rel": "self", "type": "application/activity+json",
          "href": "https://example.com/users/carol",
          "titles": { "und": "Carol's profile" } },
        { "rel": "http://example.com/rel/blog", "href": "https://blog.example.com/carol" }
      ]
    }"#;

    #[test]
    fn parse_json_with_multiple_rel_links() {
        let jrd = parse_webfinger(MULTI_REL_JSON.as_bytes()).unwrap();
        assert_eq!(jrd.subject.as_deref(), Some("acct:carol@example.com"));
        assert_eq!(jrd.links.len(), 3);
        let self_link = jrd.link("self").unwrap();
        assert_eq!(
            self_link.href.as_deref(),
            Some("https://example.com/users/carol")
        );
    }

    #[test]
    fn jrd_converts_to_link_blocks() {
        let jrd = parse_webfinger(MULTI_REL_JSON.as_bytes()).unwrap();
        let blocks: Vec<Block> = jrd.links.into_iter().filter_map(link_block).collect();
        assert_eq!(blocks.len(), 3, "all three links have hrefs");
        for b in &blocks {
            assert!(matches!(b, Block::Link { .. }), "expected a link block");
        }
        if let Block::Link { url, text } = &blocks[1] {
            assert_eq!(url.as_str(), "https://example.com/users/carol");
            assert!(text.runs[0].text.contains("Carol's profile"));
        }
    }

    #[test]
    fn link_without_href_or_template_is_skipped() {
        let jrd = parse_webfinger(
            r#"{"subject":"acct:a@b","links":[{"rel":"self"},{"rel":"x","href":"https://x/"}]}"#
                .as_bytes(),
        )
        .unwrap();
        let blocks: Vec<Block> = jrd.links.into_iter().filter_map(link_block).collect();
        assert_eq!(blocks.len(), 1);
    }

    #[test]
    fn invalid_json_is_invalid_response() {
        let err = parse_webfinger(b"{ not json").unwrap_err();
        assert_eq!(err.code(), "INVALID_RESPONSE");
    }

    #[test]
    fn valid_json_missing_subject_is_invalid_response() {
        let err =
            parse_webfinger(br#"{"links":[{"rel":"self","href":"https://x/"}]}"#).unwrap_err();
        assert_eq!(err.code(), "INVALID_RESPONSE");
    }

    #[test]
    fn request_url_builds_well_known_endpoint() {
        let base = Url::parse("https://example.social").unwrap();
        let url = request_url(&base, "acct:alice@example.social", &[]);
        assert_eq!(
            url.as_str(),
            "https://example.social/.well-known/webfinger?resource=acct%3Aalice%40example.social"
        );
    }

    #[test]
    fn request_url_keeps_alternate_port() {
        let base = Url::parse("https://127.0.0.1:8443").unwrap();
        let url = request_url(&base, "acct:a@127.0.0.1", &[]);
        assert_eq!(url.port(), Some(8443));
        assert_eq!(url.path(), WELL_KNOWN_PATH);
    }

    #[test]
    fn default_and_protocol_trait_methods() {
        // Exercises Default::default(), scheme(), path_prefix() and capabilities().
        let adapter = WebFingerAdapter::default();
        assert_eq!(adapter.scheme(), "https");
        assert_eq!(adapter.path_prefix(), Some(WELL_KNOWN_PATH));
        let caps = adapter.capabilities();
        assert!(caps.supports_fetch);
    }

    #[test]
    fn link_with_unparsable_href_is_skipped() {
        // A link whose href/template is not a valid URL yields no block.
        let jrd =
            parse_webfinger(br#"{"subject":"acct:a@b","links":[{"rel":"x","href":"not a url"}]}"#)
                .unwrap();
        let blocks: Vec<Block> = jrd.links.into_iter().filter_map(link_block).collect();
        assert!(blocks.is_empty());
    }
}
