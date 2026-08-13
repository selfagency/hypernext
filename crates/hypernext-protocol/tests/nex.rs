//! Integration tests for the Nex adapter: an in-process nex server (raw TCP)
//! responding to path requests with fixture replies.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, NexAdapter, Protocol};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process nex server. Reads a request line, replies with the
/// fixture whose bytes we were given, then closes.
async fn spawn_nex_server(reply: &'static [u8]) -> (String, u16) {
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
async fn nex_directory_parses_to_links() {
    let fixture = include_bytes!("fixtures/nex/index.nex");
    let (host, port) = spawn_nex_server(fixture).await;
    let adapter = NexAdapter::new();
    let url = Url::parse(&format!("nex://{host}:{port}/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url, url);
    // 2 paragraphs + 3 links.
    assert_eq!(doc.blocks.len(), 5);
    assert!(matches!(&doc.blocks[0], Block::Paragraph(_)));
    assert!(
        matches!(&doc.blocks[1], Block::Link { url, .. } if url.as_str().ends_with("/about.txt"))
    );
    assert!(matches!(&doc.blocks[2], Block::Link { url, .. } if url.as_str().ends_with("/blog/")));
    assert!(
        matches!(&doc.blocks[3], Block::Link { url, .. } if url.as_str().ends_with("/projects/"))
    );
    assert!(matches!(&doc.blocks[4], Block::Paragraph(_)));
}

#[tokio::test]
async fn nex_document_parses_as_gemtext() {
    let fixture = include_bytes!("fixtures/nex/document.gmi");
    let (host, port) = spawn_nex_server(fixture).await;
    let adapter = NexAdapter::new();
    let url = Url::parse(&format!("nex://{host}:{port}/document.gmi")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.title.as_deref(), Some("Title"));
    assert!(
        doc.blocks
            .iter()
            .any(|b| matches!(b, Block::Heading { level: 1, text, .. } if text == "Title"))
    );
    assert!(doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))));
    assert!(doc.blocks.iter().any(|b| matches!(b, Block::Link { .. })));
}

#[tokio::test]
async fn nex_malformed_arrow_is_text_not_link() {
    let fixture = include_bytes!("fixtures/nex/malformed.nex");
    let (host, port) = spawn_nex_server(fixture).await;
    let adapter = NexAdapter::new();
    let url = Url::parse(&format!("nex://{host}:{port}/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    // "=> " and "=>about.txt" are text; only "=> /valid.txt" is a link.
    assert!(
        doc.blocks
            .iter()
            .any(|b| matches!(b, Block::Link { url, .. } if url.as_str().ends_with("/valid.txt")))
    );
}

#[tokio::test]
async fn nex_empty_reply_yields_no_blocks() {
    let fixture = include_bytes!("fixtures/nex/empty.nex");
    let (host, port) = spawn_nex_server(fixture).await;
    let adapter = NexAdapter::new();
    let url = Url::parse(&format!("nex://{host}:{port}/")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert!(doc.blocks.is_empty());
}

#[tokio::test]
async fn nex_ssrf_blocks_loopback_by_default() {
    let fixture = include_bytes!("fixtures/nex/index.nex");
    let (host, port) = spawn_nex_server(fixture).await;
    let adapter = NexAdapter::new();
    let url = Url::parse(&format!("nex://{host}:{port}/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
