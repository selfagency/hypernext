//! Integration tests for the Guppy adapter (p2-t5d): an in-process UDP guppy
//! server (using the crate's own `serve`) answering with fixture bodies.

use guppy_protocol::{GuppyResponse, ServerConfig, serve};
use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, GuppyAdapter, Protocol};
use tokio::net::UdpSocket;
use url::Url;

/// Bind a UDP socket on loopback and return it with its port.
async fn bind_udp() -> (UdpSocket, u16) {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    (socket, port)
}

/// Serve `body` as a `text/gemini` success response until `shutdown` fires.
async fn spawn_guppy_server(body: &'static [u8]) -> (String, u16) {
    let (socket, port) = bind_udp().await;
    let host = "127.0.0.1".to_string();
    // A never-resolving future keeps the server running for the test's lifetime.
    let shutdown = std::future::pending::<()>();
    let body = std::sync::Arc::new(body.to_vec());
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let (err_tx, mut err_rx) = tokio::sync::oneshot::channel::<String>();
    let handle = tokio::spawn(async move {
        let handler = move |_req: guppy_protocol::Request| {
            let body = std::sync::Arc::clone(&body);
            async move {
                GuppyResponse::Success {
                    mime: "text/gemini".to_string(),
                    body: (*body).clone(),
                }
            }
        };
        let _ = ready_tx.send(());
        let result = serve(socket, handler, ServerConfig::default(), shutdown).await;
        let _ = err_tx.send(format!("serve returned: {result:?}"));
    });
    // Wait until the server task is running before the client sends.
    let _ = ready_rx.await;
    if let Ok(e) = err_rx.try_recv() {
        panic!("guppy server exited: {e}");
    }
    // If the server task panicked, surface it.
    if handle.is_finished() {
        let _ = handle.await;
    }
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

fn heading_text(blocks: &[Block]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            Block::Heading { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn guppy_server_answers_index_fixture() {
    let body = include_bytes!("fixtures/guppy/index.guppy");
    let (host, port) = spawn_guppy_server(body).await;
    let adapter = GuppyAdapter::new();
    let url = Url::parse(&format!("guppy://{host}:{port}/")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let headings = heading_text(&doc.blocks);
    assert!(
        headings.contains("Welcome to the Guppy Capsule"),
        "in {headings}"
    );
    assert!(
        doc.blocks.iter().any(|b| matches!(b, Block::Link { .. })),
        "link block present"
    );
}

#[tokio::test]
async fn guppy_server_answers_list_fixture() {
    let body = include_bytes!("fixtures/guppy/list.guppy");
    let (host, port) = spawn_guppy_server(body).await;
    let adapter = GuppyAdapter::new();
    let url = Url::parse(&format!("guppy://{host}:{port}/list")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert!(
        doc.blocks
            .iter()
            .any(|b| matches!(b, Block::List { items, .. } if items.len() == 3)),
        "list of 3 items"
    );
}

#[tokio::test]
async fn guppy_server_answers_code_fixture() {
    let body = include_bytes!("fixtures/guppy/code.guppy");
    let (host, port) = spawn_guppy_server(body).await;
    let adapter = GuppyAdapter::new();
    let url = Url::parse(&format!("guppy://{host}:{port}/code")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert!(
        doc.blocks
            .iter()
            .any(|b| matches!(b, Block::Code { language: Some(l), .. } if l == "rust")),
        "rust code block"
    );
}

#[tokio::test]
async fn guppy_ssrf_blocks_loopback_by_default() {
    let body = include_bytes!("fixtures/guppy/index.guppy");
    let (host, port) = spawn_guppy_server(body).await;
    let adapter = GuppyAdapter::new();
    let url = Url::parse(&format!("guppy://{host}:{port}/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
