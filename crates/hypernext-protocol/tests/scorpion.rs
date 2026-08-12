//! Integration tests for the Scorpion adapter (p2-t5c).
//!
//! Spins up an in-process plaintext TCP server on loopback that answers a
//! receive (`R`) request with a fixture wire response, and drives the
//! `ScorpionAdapter` end-to-end. Verifies the happy path (a binary-block
//! document maps to `Vec<Block>`), a redirect, a not-found, and the SSRF gate.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, Protocol, ScorpionAdapter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process Scorpion server. Reads the request line, replies with
/// the fixture bytes, then closes.
async fn spawn_scorpion_server(reply: &'static [u8]) -> (String, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let host = addr.ip().to_string();
    let port = addr.port();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => break,
            };
            let reply = reply.to_vec();
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                let _n = sock.read(&mut buf).await.unwrap_or(0);
                sock.write_all(&reply).await.ok();
                sock.shutdown().await.ok();
            });
        }
    });
    (host, port)
}

fn ctx(policy: &FetchPolicy) -> FetchContext<'static> {
    let policy = Box::leak(Box::new(policy.clone()));
    let client = Box::leak(Box::new(reqwest::Client::new()));
    let store = Box::leak(Box::new(std::sync::Mutex::new(
        hypernext_store::db::open_in_memory().unwrap(),
    )));
    FetchContext {
        http_client: client,
        cancel: tokio_util::sync::CancellationToken::new(),
        incognito: false,
        policy,
        store,
    }
}

fn local_policy() -> FetchPolicy {
    FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    }
}

#[tokio::test]
async fn scorpion_server_answers_document_fixture() {
    let fixture = include_bytes!("fixtures/scorpion/document.scorpion");
    let (host, port) = spawn_scorpion_server(fixture).await;
    let adapter = ScorpionAdapter::new();
    let url = Url::parse(&format!("scorpion://{host}:{port}/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url, url);
    assert_eq!(doc.title.as_deref(), Some("Title"));
    assert_eq!(doc.blocks.len(), 3);
    assert!(matches!(&doc.blocks[0], Block::Heading { level: 1, text, .. } if text == "Title"));
    assert!(matches!(&doc.blocks[1], Block::Paragraph(_)));
    assert!(matches!(&doc.blocks[2], Block::Link { .. }));
}

#[tokio::test]
async fn scorpion_server_answers_plain_fixture() {
    let fixture = include_bytes!("fixtures/scorpion/plain.scorpion");
    let (host, port) = spawn_scorpion_server(fixture).await;
    let adapter = ScorpionAdapter::new();
    let url = Url::parse(&format!("scorpion://{host}:{port}/plain")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert!(matches!(&doc.blocks[0], Block::Paragraph(_)));
}

#[tokio::test]
async fn scorpion_server_answers_redirect_fixture() {
    let fixture = include_bytes!("fixtures/scorpion/redirect.scorpion");
    let (host, port) = spawn_scorpion_server(fixture).await;
    let adapter = ScorpionAdapter::new();
    let url = Url::parse(&format!("scorpion://{host}:{port}/old")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url.as_str(), "scorpion://example.com/moved");
}

#[tokio::test]
async fn scorpion_server_answers_not_found_fixture() {
    let fixture = include_bytes!("fixtures/scorpion/notfound.scorpion");
    let (host, port) = spawn_scorpion_server(fixture).await;
    let adapter = ScorpionAdapter::new();
    let url = Url::parse(&format!("scorpion://{host}:{port}/missing")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

#[tokio::test]
async fn scorpion_ssrf_blocks_loopback_by_default() {
    let fixture = include_bytes!("fixtures/scorpion/document.scorpion");
    let (host, port) = spawn_scorpion_server(fixture).await;
    let adapter = ScorpionAdapter::new();
    let url = Url::parse(&format!("scorpion://{host}:{port}/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
