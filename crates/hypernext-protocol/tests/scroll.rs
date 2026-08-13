//! Integration tests for the Scroll adapter: an in-process TLS server
//! (self-signed cert via `rcgen`) serving scrolltext fixtures over
//! `scroll://`.

use std::sync::{Arc, Mutex};

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, Protocol, ScrollAdapter};
use rcgen::{CertifiedKey, generate_simple_self_signed};
use rustls::pki_types::PrivateKeyDer;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use url::Url;

/// A self-signed cert + key for `localhost`.
fn self_signed() -> CertifiedKey {
    generate_simple_self_signed(vec!["localhost".to_string()]).unwrap()
}

/// Build a TLS acceptor from a `CertifiedKey`.
fn acceptor(cert: &CertifiedKey) -> TlsAcceptor {
    let cert_der = cert.cert.der().clone();
    let key_der = PrivateKeyDer::try_from(cert.key_pair.serialize_der()).unwrap();
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .unwrap();
    TlsAcceptor::from(Arc::new(config))
}

/// Bind a loopback listener and return it with its port.
async fn bind() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

/// Serve one TLS connection, reading the request line and replying with the
/// scroll response bytes (status line + three metadata lines + body).
async fn serve_one(listener: TcpListener, acceptor: TlsAcceptor, body: Vec<u8>) {
    let (tcp, _) = listener.accept().await.unwrap();
    let mut tls = acceptor.accept(tcp).await.unwrap();
    let mut buf = [0u8; 1024];
    let _n = tls.read(&mut buf).await.unwrap();
    tls.write_all(&body).await.unwrap();
    tls.shutdown().await.unwrap();
}

fn ctx(policy: &FetchPolicy) -> FetchContext<'_> {
    let client = Box::leak(Box::new(reqwest::Client::new()));
    let store = Box::leak(Box::new(Mutex::new(
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
        ..Default::default()
    }
}

/// Wrap a fixture body in a scroll success response (code 20, text/scroll,
/// three blank metadata lines).
fn scroll_response(body: &'static [u8]) -> Vec<u8> {
    let mut out = b"20 text/scroll\r\n\r\n\r\n\r\n".to_vec();
    out.extend_from_slice(body);
    out
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

#[tokio::test]
async fn scroll_server_serves_spec_fixture() {
    let fixture = include_bytes!("fixtures/scroll/spec.scroll");
    let (listener, port) = bind().await;
    let acc = acceptor(&self_signed());
    let body = scroll_response(fixture);
    let server = tokio::spawn(async move { serve_one(listener, acc, body).await });

    let adapter = ScrollAdapter::new();
    let url = Url::parse(&format!("scroll://localhost:{port}/spec.scroll")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    server.await.unwrap();
    assert_eq!(
        doc.title.as_deref(),
        Some("Scroll Protocol Speculative Specification")
    );
    let text = paragraph_text(&doc.blocks);
    assert!(text.contains("A scrolltext document"), "body in {text}");
}

#[tokio::test]
async fn scroll_server_serves_lists_fixture() {
    let fixture = include_bytes!("fixtures/scroll/lists.scroll");
    let (listener, port) = bind().await;
    let acc = acceptor(&self_signed());
    let body = scroll_response(fixture);
    let server = tokio::spawn(async move { serve_one(listener, acc, body).await });

    let adapter = ScrollAdapter::new();
    let url = Url::parse(&format!("scroll://localhost:{port}/lists.scroll")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    server.await.unwrap();
    assert!(
        doc.blocks
            .iter()
            .any(|b| matches!(b, Block::List { items, .. } if items.len() == 4))
    );
    assert!(doc.blocks.iter().any(|b| matches!(b, Block::Quote(_))));
}

#[tokio::test]
async fn scroll_server_serves_code_fixture() {
    let fixture = include_bytes!("fixtures/scroll/code.scroll");
    let (listener, port) = bind().await;
    let acc = acceptor(&self_signed());
    let body = scroll_response(fixture);
    let server = tokio::spawn(async move { serve_one(listener, acc, body).await });

    let adapter = ScrollAdapter::new();
    let url = Url::parse(&format!("scroll://localhost:{port}/code.scroll")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    server.await.unwrap();
    assert!(doc
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Code { language: Some(l), text } if l == "rust" && text.contains("fn main"))));
    // Inline markup produced styled runs.
    if let Block::Paragraph(s) = doc
        .blocks
        .iter()
        .find(|b| matches!(b, Block::Paragraph(_)))
        .unwrap()
    {
        assert!(s.runs.iter().any(|r| r.style.bold), "strong run present");
    }
}

#[tokio::test]
async fn scroll_server_serves_empty_fixture() {
    let fixture = include_bytes!("fixtures/scroll/empty.scroll");
    let (listener, port) = bind().await;
    let acc = acceptor(&self_signed());
    let body = scroll_response(fixture);
    let server = tokio::spawn(async move { serve_one(listener, acc, body).await });

    let adapter = ScrollAdapter::new();
    let url = Url::parse(&format!("scroll://localhost:{port}/empty.scroll")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    server.await.unwrap();
    assert!(doc.blocks.is_empty(), "empty body yields no blocks");
}

#[tokio::test]
async fn scroll_server_serves_redirect_fixture() {
    let fixture = include_bytes!("fixtures/scroll/redirect.scroll");
    let (listener, port) = bind().await;
    let acc = acceptor(&self_signed());
    let server = tokio::spawn(async move { serve_one(listener, acc, fixture.to_vec()).await });

    let adapter = ScrollAdapter::new();
    let url = Url::parse(&format!("scroll://localhost:{port}/redirect.scroll")).unwrap();
    let policy = local_policy();
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    server.await.unwrap();
    assert_eq!(
        doc.final_url.as_str(),
        "scroll://example.net/moved.scroll",
        "redirect target is the final_url"
    );
}

#[tokio::test]
async fn scroll_ssrf_blocks_loopback_by_default() {
    // SSRF blocks before any dial, so no server is needed — the gate refuses
    // the loopback host before a connection is attempted.
    let adapter = ScrollAdapter::new();
    let url = Url::parse("scroll://localhost:5699/").unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
