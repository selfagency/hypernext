//! Integration tests for the Gopher adapter: an in-process gopher server
//! (raw TCP) responding to selector requests with fixture replies.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, GopherAdapter, Protocol};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process gopher server. Reads a request line, replies with the
/// fixture whose bytes we were given, then closes.
async fn spawn_gopher_server(reply: &'static [u8]) -> (String, u16) {
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
async fn gopher_menu_parses_to_links() {
    let fixture = include_bytes!("fixtures/gopher/menu.gopher");
    let (host, port) = spawn_gopher_server(fixture).await;
    let adapter = GopherAdapter::new();
    let url = Url::parse(&format!("gopher://{host}:{port}/1/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url, url);
    // 5 items: 2 links, 1 info paragraph, 1 search link, 1 url link.
    assert_eq!(doc.blocks.len(), 5);
    assert!(
        matches!(&doc.blocks[0], Block::Link { url, .. } if url.as_str().ends_with("/1/software"))
    );
    assert!(
        matches!(&doc.blocks[1], Block::Link { url, .. } if url.as_str().ends_with("/0/readme.txt"))
    );
    assert!(matches!(&doc.blocks[2], Block::Paragraph(_)));
    assert!(
        matches!(&doc.blocks[3], Block::Link { url, .. } if url.as_str().ends_with("/7/search"))
    );
    assert!(
        matches!(&doc.blocks[4], Block::Link { url, .. } if url.as_str() == "https://example.test/")
    );
}

#[tokio::test]
async fn gopher_plus_menu_keeps_non_default_port() {
    let fixture = include_bytes!("fixtures/gopher/plus-menu.gopher");
    let (host, port) = spawn_gopher_server(fixture).await;
    let adapter = GopherAdapter::new();
    let url = Url::parse(&format!("gopher://{host}:{port}/1/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    // The archive item carries a non-default port (7070) in its URL.
    assert!(
        matches!(&doc.blocks[0], Block::Link { url, .. } if url.as_str().contains(":7070/1/archive"))
    );
}

#[tokio::test]
async fn gopher_text_file_becomes_paragraph() {
    let fixture = include_bytes!("fixtures/gopher/text.gopher");
    let (host, port) = spawn_gopher_server(fixture).await;
    let adapter = GopherAdapter::new();
    let url = Url::parse(&format!("gopher://{host}:{port}/0/readme.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert!(matches!(&doc.blocks[0], Block::Paragraph(_)));
}

#[tokio::test]
async fn gopher_empty_menu_yields_no_blocks() {
    let fixture = include_bytes!("fixtures/gopher/empty.gopher");
    let (host, port) = spawn_gopher_server(fixture).await;
    let adapter = GopherAdapter::new();
    let url = Url::parse(&format!("gopher://{host}:{port}/1/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert!(doc.blocks.is_empty());
}

#[tokio::test]
async fn gopher_ssrf_blocks_loopback_by_default() {
    let fixture = include_bytes!("fixtures/gopher/menu.gopher");
    let (host, port) = spawn_gopher_server(fixture).await;
    let adapter = GopherAdapter::new();
    let url = Url::parse(&format!("gopher://{host}:{port}/1/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
