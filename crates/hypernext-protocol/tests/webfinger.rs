//! Integration tests for the WebFinger adapter: an in-process HTTP server
//! serving the `/.well-known/webfinger` endpoint with JRD fixtures.

use hypernext_core::Block;
use hypernext_protocol::{FetchContext, FetchPolicy, Protocol, WebFingerAdapter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

const WELL_KNOWN_PATH: &str = "/.well-known/webfinger";

/// A tiny in-process HTTP/1.1 server. Returns `body` with `status` for the
/// WebFinger well-known path, `404` otherwise.
async fn spawn_http_server(body: &'static [u8], status: &'static str) -> (String, u16) {
    spawn_http_server_with_extra(status, None, body).await
}

/// Like [`spawn_http_server`] but allows injecting an extra `Location` header
/// (used to exercise the redirect branch of the adapter).
async fn spawn_http_server_with_extra(
    status: &'static str,
    location: Option<&'static str>,
    body: &'static [u8],
) -> (String, u16) {
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
            let body = body.to_vec();
            let status = status.to_string();
            let location = location.map(str::to_string);
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                let _n = sock.read(&mut buf).await.unwrap_or(0);
                let loc = location
                    .map(|l| format!("Location: {l}\r\n"))
                    .unwrap_or_default();
                let headers = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/jrd+json\r\n{loc}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                sock.write_all(headers.as_bytes()).await.ok();
                sock.write_all(&body).await.ok();
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

#[tokio::test]
async fn webfinger_server_serves_multi_rel_jrd() {
    let fixture = include_bytes!("fixtures/webfinger/multi-rel.jrd");
    let (host, port) = spawn_http_server(fixture, "200 OK").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Acarol%40example.com"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.title.as_deref(), Some("acct:carol@example.com"));
    let links = doc
        .blocks
        .iter()
        .filter(|b| matches!(b, Block::Link { .. }))
        .count();
    assert_eq!(links, 3, "three rel links parsed");
}

#[tokio::test]
async fn webfinger_404_is_not_found() {
    let (host, port) = spawn_http_server(b"{}", "404 Not Found").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aghost%40example.com"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

#[tokio::test]
async fn webfinger_missing_subject_is_invalid_response() {
    let fixture = include_bytes!("fixtures/webfinger/missing-subject.jrd");
    let (host, port) = spawn_http_server(fixture, "200 OK").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aanonymous%40example.com"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_RESPONSE");
}

#[tokio::test]
async fn webfinger_malformed_json_is_invalid_response() {
    let (host, port) = spawn_http_server(b"{ not json", "200 OK").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Abad%40example.com"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_RESPONSE");
}

#[tokio::test]
async fn webfinger_ssrf_blocks_loopback_by_default() {
    let fixture = include_bytes!("fixtures/webfinger/multi-rel.jrd");
    let (host, port) = spawn_http_server(fixture, "200 OK").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Acarol%40example.com"
    ))
    .unwrap();
    let policy = FetchPolicy::default(); // block_private_network = true
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "SSRF_BLOCKED");
}

#[tokio::test]
async fn webfinger_redirect_returns_final_url() {
    // 3xx with a valid Location: the adapter hands back the target and emits
    // no link blocks (the Dispatcher re-vets + loops).
    let (host, port) =
        spawn_http_server_with_extra("302 Found", Some("https://example.com/target"), b"{}").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aa%40b"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let doc = adapter.fetch(&url, &c).await.unwrap();
    assert_eq!(doc.final_url.as_str(), "https://example.com/target");
    assert!(doc.blocks.is_empty());
}

#[tokio::test]
async fn webfinger_redirect_without_location_is_network_error() {
    let (host, port) = spawn_http_server_with_extra("302 Found", None, b"{}").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aa%40b"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NETWORK_ERROR");
}

#[tokio::test]
async fn webfinger_redirect_with_unparseable_location_is_invalid_url() {
    let (host, port) =
        spawn_http_server_with_extra("302 Found", Some("http:// no space allowed"), b"{}").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aa%40b"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_URL");
}

#[tokio::test]
async fn webfinger_server_error_is_network_error() {
    let (host, port) = spawn_http_server(b"oops", "500 Internal Server Error").await;
    let adapter = WebFingerAdapter::new();
    let url = Url::parse(&format!(
        "http://{host}:{port}{WELL_KNOWN_PATH}?resource=acct%3Aa%40b"
    ))
    .unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "NETWORK_ERROR");
}

#[tokio::test]
async fn webfinger_no_host_is_invalid_url() {
    // A URL with no authority reaches the host gate: `file:///.well-known/webfinger`
    // has no host but the correct well-known path.
    let adapter = WebFingerAdapter::new();
    let url = Url::parse("file:///.well-known/webfinger?resource=acct%3Aa%40b").unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    };
    let c = ctx(&policy);

    let err = adapter.fetch(&url, &c).await.unwrap_err();
    assert_eq!(err.code(), "INVALID_URL");
}
