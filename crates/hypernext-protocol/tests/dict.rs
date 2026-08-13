//! Integration tests for the DICT adapter (p2-t5d): an in-process TLS DICT
//! server (RFC 2229 command loop) answering `DEFINE`/`MATCH`/`QUIT` with
//! fixture responses. The adapter wraps the connection in TOFU-pinned TLS, so
//! the server is a `tokio-rustls` acceptor with a self-signed cert.

use std::sync::Arc;

use hypernext_core::Block;
use hypernext_protocol::{DictAdapter, FetchContext, FetchPolicy, Protocol};
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

/// Serve one DICT session over TLS: banner, then respond to DEFINE with the
/// define fixture, MATCH with the matches fixture, and QUIT with 221.
async fn serve_dict(listener: TcpListener, acceptor: TlsAcceptor) {
    let (tcp, _) = listener.accept().await.unwrap();
    let mut tls = acceptor.accept(tcp).await.unwrap();
    tls.write_all(b"220 dict.example.com <1@dict.example.com>\r\n")
        .await
        .unwrap();
    let mut buf = [0u8; 1024];
    loop {
        let n = tls.read(&mut buf).await.unwrap();
        if n == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&buf[..n]);
        if line.starts_with("DEFINE") {
            tls.write_all(include_bytes!("fixtures/dict/define.dict"))
                .await
                .unwrap();
        } else if line.starts_with("MATCH") {
            tls.write_all(include_bytes!("fixtures/dict/matches.dict"))
                .await
                .unwrap();
        } else if line.starts_with("QUIT") {
            tls.write_all(b"221 bye\r\n").await.unwrap();
            break;
        }
    }
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
async fn dict_server_answers_define_with_fixture() {
    let (listener, port) = bind().await;
    let acceptor = acceptor(&self_signed());
    tokio::spawn(serve_dict(listener, acceptor));
    let adapter = DictAdapter::new();
    let url = Url::parse(&format!("dict://localhost:{port}/smolweb")).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    let text = paragraph_text(&doc.blocks);
    assert!(
        text.contains("The small web, a collection of lightweight protocols."),
        "definition text in {text}"
    );
    // The MATCH fixture adds a "Matches" heading + link.
    assert!(
        doc.blocks.iter().any(|b| matches!(b, Block::Link { .. })),
        "match link present"
    );
}

#[tokio::test]
async fn dict_ssrf_blocks_loopback_by_default() {
    let (listener, port) = bind().await;
    let acceptor = acceptor(&self_signed());
    tokio::spawn(serve_dict(listener, acceptor));
    let adapter = DictAdapter::new();
    let url = Url::parse(&format!("dict://localhost:{port}/smolweb")).unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}
