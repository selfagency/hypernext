//! Integration tests for the Spartan adapter: an in-process spartan server
//! (raw TCP) responding to request lines with fixture replies.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, Protocol, SpartanAdapter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process spartan server. Reads a request line, replies with the
/// fixture whose bytes we were given, then closes.
async fn spawn_spartan_server(reply: &'static [u8]) -> (String, u16) {
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
        rusqlite::Connection::open_in_memory().unwrap(),
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
async fn spartan_gemtext_parses_to_blocks() {
    let fixture = include_bytes!("fixtures/spartan/index.spartan");
    let (host, port) = spawn_spartan_server(fixture).await;
    let adapter = SpartanAdapter::new();
    let url = Url::parse(&format!("spartan://{host}:{port}/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url, url);
    assert_eq!(doc.title.as_deref(), Some("Welcome to the Spartan capsule"));
    assert!(doc
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Welcome to the Spartan capsule")));
    assert!(doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))));
    assert!(doc.blocks.iter().any(|b| matches!(b, Block::Link { .. })));
}

#[tokio::test]
async fn spartan_plain_text_becomes_paragraph() {
    let fixture = include_bytes!("fixtures/spartan/plain.spartan");
    let (host, port) = spawn_spartan_server(fixture).await;
    let adapter = SpartanAdapter::new();
    let url = Url::parse(&format!("spartan://{host}:{port}/plain.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert!(matches!(&doc.blocks[0], Block::Paragraph(_)));
}

#[tokio::test]
async fn spartan_redirect_sets_final_url() {
    let fixture = include_bytes!("fixtures/spartan/redirect.spartan");
    let (host, port) = spawn_spartan_server(fixture).await;
    let adapter = SpartanAdapter::new();
    let url = Url::parse(&format!("spartan://{host}:{port}/old")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(
        doc.final_url.as_str(),
        format!("spartan://{host}:{port}/new/path/")
    );
}

#[tokio::test]
async fn spartan_client_error_is_not_found() {
    let fixture = include_bytes!("fixtures/spartan/notfound.spartan");
    let (host, port) = spawn_spartan_server(fixture).await;
    let adapter = SpartanAdapter::new();
    let url = Url::parse(&format!("spartan://{host}:{port}/missing")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

#[tokio::test]
async fn spartan_ssrf_blocks_loopback_by_default() {
    let fixture = include_bytes!("fixtures/spartan/index.spartan");
    let (host, port) = spawn_spartan_server(fixture).await;
    let adapter = SpartanAdapter::new();
    let url = Url::parse(&format!("spartan://{host}:{port}/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
