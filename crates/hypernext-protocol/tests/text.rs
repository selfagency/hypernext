//! Integration tests for the Text adapter: an in-process plain-TCP server
//! responding to `text://` requests with fixture replies.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, Protocol, TextAdapter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// A minimal in-process text server. Reads the request line, replies with the
/// fixture bytes we were given, then closes. Success-body fixtures (which hold
/// plain body text) are framed with the Text protocol status line
/// `20 text/plain\r\n` (the grammar is `"20" SP mimetype CRLF body` — a single
/// CRLF, no blank line); fixtures that already begin with a status code
/// (e.g. `30 ` redirects) are sent verbatim.
async fn spawn_text_server(reply: &'static [u8]) -> (String, u16) {
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
            // Frame the reply: success status line unless the fixture already
            // starts with a Text protocol status code (two digits + space).
            let framed: Vec<u8> = if reply.len() >= 3
                && reply[0].is_ascii_digit()
                && reply[1].is_ascii_digit()
                && reply[2] == b' '
            {
                reply.to_vec()
            } else {
                let mut v = b"20 text/plain\r\n".to_vec();
                v.extend_from_slice(reply);
                v
            };
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                let _n = sock.read(&mut buf).await.unwrap_or(0);
                sock.write_all(&framed).await.ok();
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

fn paragraph_text(blocks: &[Block]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            Block::Paragraph(s) => Some(s.runs.iter().map(|r| r.text.as_str()).collect::<String>()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn local_policy() -> FetchPolicy {
    FetchPolicy {
        block_private_network: false,
        ..Default::default()
    }
}

#[tokio::test]
async fn text_server_serves_hello_fixture() {
    let fixture = include_bytes!("fixtures/text/hello.txt");
    let (host, port) = spawn_text_server(fixture).await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/hello.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let text = paragraph_text(&doc.blocks);
    assert!(text.contains("Hello, smolnet."), "body in {text}");
    // The `=>` line is a link, not a paragraph: assert a Block::Link targets it.
    let links: Vec<_> = doc
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Link { url, .. } => Some(url.as_str().to_string()),
            _ => None,
        })
        .collect();
    assert!(
        links.iter().any(|u| u.contains("license.txt")),
        "link line became a link block: {links:?}"
    );
    // The paragraph is preformatted.
    if let Block::Paragraph(s) = &doc.blocks[0] {
        assert!(s.runs[0].style.preformatted);
    }
}

#[tokio::test]
async fn text_server_serves_links_fixture() {
    let fixture = include_bytes!("fixtures/text/links.txt");
    let (host, port) = spawn_text_server(fixture).await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/links.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let links: Vec<_> = doc
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Link { url, .. } => Some(url.as_str().to_string()),
            _ => None,
        })
        .collect();
    assert_eq!(links.len(), 3, "three link lines: {links:?}");
    assert!(links.iter().any(|u| u.contains("a.txt")));
}

#[tokio::test]
async fn text_server_serves_whitespace_fixture() {
    let fixture = include_bytes!("fixtures/text/whitespace.txt");
    let (host, port) = spawn_text_server(fixture).await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/whitespace.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let text = paragraph_text(&doc.blocks);
    assert!(
        text.contains("  leading spaces"),
        "leading spaces in {text:?}"
    );
    assert!(text.contains('\t'), "tab preserved in {text:?}");
}

#[tokio::test]
async fn text_server_serves_empty_fixture() {
    let fixture = include_bytes!("fixtures/text/empty.txt");
    let (host, port) = spawn_text_server(fixture).await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/empty.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert!(doc.blocks.is_empty(), "empty body yields no blocks");
}

#[tokio::test]
async fn text_server_serves_redirect_fixture() {
    let fixture = include_bytes!("fixtures/text/redirect.txt");
    let (host, port) = spawn_text_server(fixture).await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/redirect.txt")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(
        doc.final_url.as_str(),
        "text://example.org/moved.txt",
        "redirect target is the final_url"
    );
}

#[tokio::test]
async fn text_ssrf_blocks_loopback_by_default() {
    let (host, port) = spawn_text_server(b"20 text/plain\r\nhi\n").await;
    let adapter = TextAdapter::new();
    let url = Url::parse(&format!("text://{host}:{port}/")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
