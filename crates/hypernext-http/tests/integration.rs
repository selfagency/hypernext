//! Integration tests for `hypernext-http` client using wiremock.
//!
//! wiremock binds to 127.0.0.1, so the size-limit and redirect-limit tests
//! use `block_private_network = false` (localhost is the test harness, not an
//! SSRF target). SSRF-at-redirect-hop is tested separately with the private
//! block enabled and the initial request issued directly (no initial
//! `check_url`), so only the redirect closure enforces the block.

use hypernext_http::{build_client, fetch_body, FetchPolicy};
use std::time::Duration;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn policy() -> FetchPolicy {
    FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    }
}

#[tokio::test]
async fn fetch_body_aborts_at_max_response_size() {
    const MAX: u64 = 10 * 1024 * 1024;
    let server = MockServer::start().await;

    // Body comfortably larger than the limit (10 MiB + 1 KiB).
    let oversize = vec![0u8; (MAX as usize) + 1024];
    Mock::given(method("GET"))
        .and(path("/big"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(oversize))
        .mount(&server)
        .await;

    let pol = FetchPolicy {
        max_response_size: MAX,
        ..policy()
    };
    let client = build_client(&pol);
    let url = Url::parse(&format!("{}/big", server.uri())).unwrap();

    let err = fetch_body(&client, &url, &pol).await.unwrap_err();
    assert!(matches!(
        err,
        hypernext_http::Error::SizeLimitExceeded { .. }
    ));
}

#[tokio::test]
async fn redirect_to_private_host_blocked_at_hop() {
    let server = MockServer::start().await;
    // Redirect toward a loopback address on an unused port. With the private
    // block enabled, the redirect closure rejects it before connecting.
    Mock::given(method("GET"))
        .and(path("/r"))
        .respond_with(ResponseTemplate::new(301).insert_header("Location", "http://127.0.0.1:9/"))
        .mount(&server)
        .await;

    let pol = FetchPolicy {
        block_private_network: true,
        ..FetchPolicy::default()
    };
    let client = build_client(&pol);

    // Issue the request directly (no initial check_url) so only the redirect
    // hop is audited by the policy.
    let result = client.get(format!("{}/r", server.uri())).send().await;

    // The redirect was refused by our policy (reqwest marks it is_redirect).
    match result {
        Ok(_) => panic!("redirect to private host should have been blocked"),
        Err(e) => assert!(e.is_redirect(), "expected a redirect-policy error, got {e}"),
    }
}

#[tokio::test]
async fn redirect_chain_over_limit_fails() {
    let server = MockServer::start().await;
    let n = 7; // 7 endpoints, chain must be cut by max_redirects=5.
    for i in 0..n {
        let next = if i + 1 < n {
            format!("{}/r{}", server.uri(), i + 1)
        } else {
            format!("{}/r{}", server.uri(), i)
        };
        Mock::given(method("GET"))
            .and(path(format!("/r{i}")))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", next))
            .mount(&server)
            .await;
    }

    let pol = FetchPolicy {
        max_redirects: 5,
        ..policy()
    };
    let client = build_client(&pol);
    let url = Url::parse(&format!("{}/r0", server.uri())).unwrap();

    let err = fetch_body(&client, &url, &pol).await.unwrap_err();
    assert!(matches!(err, hypernext_http::Error::RedirectLimit { .. }));
}

#[tokio::test]
async fn fetch_ok_small_body() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/hello"))
        .respond_with(ResponseTemplate::new(200).set_body_string("hi"))
        .mount(&server)
        .await;

    let pol = policy();
    let client = build_client(&pol);
    let url = Url::parse(&format!("{}/hello", server.uri())).unwrap();
    let body = fetch_body(&client, &url, &pol).await.unwrap();
    assert_eq!(body, b"hi".to_vec());
}

#[tokio::test]
async fn fetch_ok_with_timeout_set_on_client() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/slow"))
        // 200ms response; timeout is 30s so this succeeds.
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(200)))
        .mount(&server)
        .await;

    let pol = FetchPolicy {
        timeout: Duration::from_secs(30),
        ..policy()
    };
    let client = build_client(&pol);
    let url = Url::parse(&format!("{}/slow", server.uri())).unwrap();
    let body = fetch_body(&client, &url, &pol).await.unwrap();
    assert!(body.is_empty()); // response arrived
}
