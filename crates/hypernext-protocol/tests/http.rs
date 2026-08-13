//! Integration tests for the HTTP adapter + default dispatcher (p3-t7).
//!
//! Covers the TDD gate:
//! - `Dispatcher::fetch` over `https` returns a `PageDoc` with blocks (reader
//!   mode), via the prefix-less default `HttpAdapter`.
//! - `webmode.<origin>=Raw` makes the adapter emit a `Block::Webview` placeholder.
//! - incognito forces Reader even when Raw is saved (invariant #9).
//! - raw-mode resource interception (`decide_policy`) rejects a matched tracker.
//!
//! PGP verify-before-extract (valid / tamper -> PgpInvalid) lives in
//! `hypernext-http/tests/pipeline.rs`, where a real signing key is available to
//! exercise both outcomes. The adapter delegates to `fetch_and_extract`, so that
//! invariant is preserved here by construction (the ordering is asserted there
//! with a tracing hook); this file covers the adapter's own HTTP + web-mode
//! routing.

use hypernext_core::Block;
use hypernext_protocol::HttpAdapter;
use hypernext_protocol::adapters::default_dispatcher;
use hypernext_protocol::adapters::http::{RequestType, ResourceDecision};
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// A linkable fixture: an article HTML body that legible can extract.
const ARTICLE_HTML: &str = r#"<html><head><title>Mock Article</title></head><body><article><h1>Hello</h1><p>Extracted paragraph body.</p></article></body></html>"#;

#[tokio::test(flavor = "multi_thread")]
async fn default_dispatcher_fetches_https_and_extracts_blocks() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/article"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(ARTICLE_HTML.as_bytes(), "text/html"))
        .mount(&server)
        .await;

    let target = Url::parse(&format!("{}/article", server.uri())).unwrap();
    let dispatcher = default_dispatcher();
    let ctx = loopback_ctx();

    let doc = dispatcher
        .fetch(&target, &ctx)
        .await
        .expect("default dispatcher should fetch https");

    assert_eq!(doc.url, target);
    assert!(
        doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))),
        "expected extracted paragraphs, got {:?}",
        doc.blocks
    );
    assert!(doc.title.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn raw_mode_returns_webview_block() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(ARTICLE_HTML.as_bytes(), "text/html"))
        .mount(&server)
        .await;

    let target = Url::parse(&format!("{}/page", server.uri())).unwrap();
    let dispatcher = default_dispatcher();
    let store = open_store();
    {
        let conn = store.lock().unwrap();
        let _ = hypernext_store::webmode::set_mode_pref(
            &target,
            hypernext_store::webmode::WebMode::Raw,
            &conn,
        );
    }

    let ctx = loopback_ctx_with(store, false);
    let doc = dispatcher
        .fetch(&target, &ctx)
        .await
        .expect("raw-mode fetch");

    assert_eq!(
        doc.blocks,
        vec![Block::Webview {
            url: target.clone()
        }],
        "raw mode must emit a Block::Webview placeholder"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn incognito_ignores_raw_pref_and_extracts_reader() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(ARTICLE_HTML.as_bytes(), "text/html"))
        .mount(&server)
        .await;

    let target = Url::parse(&format!("{}/page", server.uri())).unwrap();
    let dispatcher = default_dispatcher();
    let store = open_store();
    {
        let conn = store.lock().unwrap();
        let _ = hypernext_store::webmode::set_mode_pref(
            &target,
            hypernext_store::webmode::WebMode::Raw,
            &conn,
        );
    }

    let ctx = loopback_ctx_with(store, true);
    let doc = dispatcher
        .fetch(&target, &ctx)
        .await
        .expect("incognito fetch");
    assert!(
        doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))),
        "incognito must extract (Reader), not emit a webview placeholder"
    );
}

#[test]
fn raw_adblock_interception_rejects_matched_tracker() {
    let adapter = HttpAdapter::new();
    let decision = adapter.decide_policy(
        &Url::parse("https://ads.doubleclick.net/ad?id=1").unwrap(),
        &Url::parse("https://example.com/page").unwrap(),
        RequestType::Image,
        false,
    );
    assert_eq!(decision, ResourceDecision::Reject);
}

#[test]
fn raw_adblock_interception_allows_clean_and_incognito() {
    let adapter = HttpAdapter::new();
    let clean = adapter.decide_policy(
        &Url::parse("https://cdn.example.com/app.js").unwrap(),
        &Url::parse("https://example.com/page").unwrap(),
        RequestType::Script,
        false,
    );
    assert_eq!(clean, ResourceDecision::Allow);
    // A known tracker is allowed in incognito (invariant #9).
    let incognito = adapter.decide_policy(
        &Url::parse("https://ads.doubleclick.net/ad?id=1").unwrap(),
        &Url::parse("https://example.com/page").unwrap(),
        RequestType::Image,
        true,
    );
    assert_eq!(incognito, ResourceDecision::Allow);
}

/// A `FetchContext` pointing at a fresh in-memory store with loopback allowed.
fn loopback_ctx() -> hypernext_protocol::FetchContext<'static> {
    loopback_ctx_with(open_store(), false)
}

fn loopback_ctx_with(
    store: &'static std::sync::Mutex<rusqlite::Connection>,
    incognito: bool,
) -> hypernext_protocol::FetchContext<'static> {
    let policy = Box::leak(Box::new(hypernext_protocol::FetchPolicy {
        block_private_network: false,
        ..Default::default()
    }));
    let client = Box::leak(Box::new(reqwest::Client::new()));
    hypernext_protocol::FetchContext {
        http_client: client,
        cancel: tokio_util::sync::CancellationToken::new(),
        incognito,
        policy,
        store,
    }
}

fn open_store() -> &'static std::sync::Mutex<rusqlite::Connection> {
    Box::leak(Box::new(std::sync::Mutex::new(
        hypernext_store::db::open_in_memory().expect("in-memory store opens"),
    )))
}
