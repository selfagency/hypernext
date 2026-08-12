//! Integration tests for the Finger adapter: an in-process finger server
//! (raw TCP) responding to `/W user` queries with fixture replies.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, FingerAdapter, Protocol};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process finger server. Reads a query line, replies with the
/// fixture whose bytes we were given, then closes.
async fn spawn_finger_server(reply: &'static [u8]) -> (String, u16) {
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
                // Read the request line (e.g. "/W alice\r\n").
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

fn plan_blocks_text(blocks: &[Block]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            Block::Paragraph(s) => Some(s.runs.iter().map(|r| r.text.as_str()).collect::<String>()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn finger_server_answers_w_query_with_plan_fixture() {
    let plan_fixture = include_bytes!("fixtures/finger/plan.finger");
    let (host, port) = spawn_finger_server(plan_fixture).await;
    let adapter = FingerAdapter::new();
    let url = Url::parse(&format!("finger://{host}:{port}/alice?verbose=true")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let text = plan_blocks_text(&doc.blocks);
    assert!(text.contains("Plan:"), "plan header in {text}");
    assert!(text.contains("ship phase two"), "plan body in {text}");
}

#[tokio::test]
async fn finger_server_answer_with_pgp_tail_preserves_armor() {
    let pgp_fixture = include_bytes!("fixtures/finger/pgp.finger");
    let (host, port) = spawn_finger_server(pgp_fixture).await;
    let adapter = FingerAdapter::new();
    let url = Url::parse(&format!("finger://{host}:{port}/bob")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let text = plan_blocks_text(&doc.blocks);
    assert!(
        text.contains("-----BEGIN PGP PUBLIC KEY BLOCK-----"),
        "armor begin in {text}"
    );
    assert!(
        text.contains("-----END PGP PUBLIC KEY BLOCK-----"),
        "armor end in {text}"
    );
}

#[tokio::test]
async fn finger_empty_reply_is_not_found() {
    // A server that replies with just a CRLF (user not found).
    let (host, port) = spawn_finger_server(b"\r\n").await;
    let adapter = FingerAdapter::new();
    let url = Url::parse(&format!("finger://{host}:{port}/ghost")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

#[tokio::test]
async fn finger_ssrf_blocks_loopback_by_default() {
    // With the default policy (private network blocked), a loopback finger
    // query must be refused before any bytes hit the wire.
    let (host, port) = spawn_finger_server(b"some reply\r\n").await;
    let adapter = FingerAdapter::new();
    let url = Url::parse(&format!("finger://{host}:{port}/alice")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}

#[tokio::test]
async fn finger_url_without_host_is_invalid() {
    // A finger URL with no host must be rejected as INVALID_URL before any
    // network I/O (host_str() is the source, so loopback is never needed).
    let adapter = FingerAdapter::new();
    let url = Url::parse("finger:///alice").unwrap();
    let policy = FetchPolicy::default();
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_URL");
}
