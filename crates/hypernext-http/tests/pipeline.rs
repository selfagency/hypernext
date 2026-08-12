//! Integration tests for `hypernext-http::extract`: wiremock HTTP round-trips,
//! the size limit, redirect final-URL capture, and the PGP-verify-before-extract
//! ordering invariant (tracing hook).

use std::sync::{Arc, Mutex};

use hypernext_core::{Block, HttpResponseDebug, PgpStatus};
use hypernext_http::{build_client, extract_doc, fetch_and_extract, FetchPolicy};
use tracing::field;
use tracing::Subscriber;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::Layer;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// A policy that permits loopback so the wiremock server (127.0.0.1) is
/// reachable despite default SSRF protection.
fn loopback_policy() -> FetchPolicy {
    FetchPolicy {
        block_private_network: false,
        max_response_size: 10 * 1024 * 1024,
        ..Default::default()
    }
}

fn simple_article_html() -> &'static str {
    include_str!("fixtures/http/simple-article.html")
}

#[tokio::test(flavor = "multi_thread")]
async fn mock_article_round_trip_extracts() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/article"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(simple_article_html().as_bytes(), "text/html"),
        )
        .mount(&server)
        .await;

    let url = Url::parse(&format!("{}/article", server.uri())).unwrap();
    let policy = loopback_policy();
    let client = build_client(&policy);
    let doc = fetch_and_extract(&url, &client, &policy)
        .await
        .expect("fetch+extract");

    assert_eq!(doc.url, url);
    assert_eq!(doc.final_url, url);
    assert!(doc.title.is_some());
    assert!(
        doc.blocks.iter().any(|b| matches!(b, Block::Paragraph(_))),
        "expected paragraphs, got {:?}",
        doc.blocks
    );
    assert_eq!(doc.debug.response.status, 200);
    assert_eq!(
        doc.debug.response.content_type.as_deref(),
        Some("text/html")
    );
    assert!(!doc.debug.parser_decisions.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn oversized_body_is_rejected_by_size_limit() {
    let server = MockServer::start().await;
    // A 5 MB body delivered in chunks.
    let body = "x".repeat(5 * 1024 * 1024);
    Mock::given(method("GET"))
        .and(path("/big"))
        .respond_with(ResponseTemplate::new(200).set_body_string(body))
        .mount(&server)
        .await;

    let url = Url::parse(&format!("{}/big", server.uri())).unwrap();
    let policy = FetchPolicy {
        block_private_network: false,
        max_response_size: 1024, // 1 KiB << 5 MiB
        ..Default::default()
    };
    let client = build_client(&policy);
    let err = fetch_and_extract(&url, &client, &policy).await.unwrap_err();
    assert!(
        matches!(err, hypernext_http::Error::SizeLimitExceeded { .. }),
        "expected SizeLimitExceeded, got {err}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn redirect_sets_final_url() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/target"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(simple_article_html().as_bytes(), "text/html"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/source"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("location", format!("{}/target", server.uri())),
        )
        .mount(&server)
        .await;

    let src = Url::parse(&format!("{}/source", server.uri())).unwrap();
    let tgt = Url::parse(&format!("{}/target", server.uri())).unwrap();
    let policy = loopback_policy();
    let client = build_client(&policy);
    let doc = fetch_and_extract(&src, &client, &policy)
        .await
        .expect("redirected fetch");
    assert_eq!(doc.url, src);
    assert_eq!(
        doc.final_url, tgt,
        "final_url must reflect the redirect target"
    );
    assert!(doc.title.is_some());
}

/* ------------------------------------------------------------------ *
 * PGP verify-before-extract ordering (invariant #6)
 * ------------------------------------------------------------------ */

/// A tracing subscriber layer that records the value of the `event` field on
/// every `tracing::info!` event, in emission order.
#[derive(Clone)]
struct EventCapture(Arc<Mutex<Vec<String>>>);

impl<S> Layer<S> for EventCapture
where
    S: Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        struct Capture(String);
        impl field::Visit for Capture {
            fn record_str(&mut self, f: &field::Field, v: &str) {
                if f.name() == "event" {
                    self.0 = v.to_string();
                }
            }
            fn record_debug(&mut self, f: &field::Field, v: &dyn std::fmt::Debug) {
                if f.name() == "event" {
                    self.0 = format!("{v:?}");
                }
            }
        }
        let mut cap = Capture(String::new());
        event.record(&mut cap);
        if !cap.0.is_empty() {
            self.0.lock().unwrap().push(cap.0);
        }
    }
}

/// Generate an Ed25519 signing key (matches hypernext-pgp's test pattern).
fn generate_key() -> (
    pgp::composed::SignedSecretKey,
    pgp::composed::SignedPublicKey,
) {
    use pgp::composed::{KeyType, SecretKeyParamsBuilder};
    use pgp::crypto::hash::HashAlgorithm;
    use rand::SeedableRng;
    use smallvec::smallvec;

    let mut rng = rand::rngs::StdRng::seed_from_u64(42);
    let params = SecretKeyParamsBuilder::default()
        .key_type(KeyType::Ed25519Legacy)
        .can_certify(true)
        .can_sign(true)
        .primary_user_id("tester@example.com".into())
        .preferred_hash_algorithms(smallvec![HashAlgorithm::Sha256])
        .build()
        .unwrap();
    let secret = params.generate(&mut rng).unwrap();
    let public = secret.to_public_key();
    (secret, public)
}

/// Clearsign-sign `text`, returning the armored string.
fn clearsign(text: &str, secret: &pgp::composed::SignedSecretKey) -> String {
    use pgp::composed::CleartextSignedMessage;
    use pgp::types::Password;
    use rand::SeedableRng;
    let mut rng = rand::rngs::StdRng::seed_from_u64(99);
    let msg = CleartextSignedMessage::sign(&mut rng, text, &secret.primary_key, &Password::empty())
        .unwrap();
    msg.to_armored_string(pgp::composed::ArmorOptions::default())
        .unwrap()
}

#[test]
fn pgp_verify_runs_before_extract_order_enforced() {
    // A minimal HTML body that we will clearsign. The signed payload (the
    // cleartext) is what extraction runs on after verification.
    let body = "<html><body><article><h1>Signed</h1><p>This signed article's text must be extracted after verification.</p></article></body></html>";
    let (_secret, public) = generate_key();
    let armored = clearsign(body, &_secret);

    let events: EventCapture = EventCapture(Arc::new(Mutex::new(Vec::new())));
    let subscriber = tracing_subscriber::registry().with(events.clone());

    let url = Url::parse("https://example.com/signed").unwrap();
    let resp = HttpResponseDebug {
        status: 200,
        content_type: Some("text/html".to_string()),
        ..Default::default()
    };

    let doc = tracing::subscriber::with_default(subscriber, || {
        extract_doc(
            &url,
            &url,
            armored.as_bytes().to_vec(),
            Some("text/html"),
            &[public],
            &resp,
        )
        .expect("clearsign-signed content should verify and extract")
    });

    // The signature was verified -> status Valid.
    let sig = doc.signature.expect("signed document should carry PgpInfo");
    assert_eq!(sig.status, PgpStatus::Valid);

    // Ordering: pgp.verify must precede content.extract.
    let captured = events.0.lock().unwrap().clone();
    let verify_at = captured
        .iter()
        .position(|e| e == "pgp.verify")
        .expect("pgp.verify event emitted");
    let extract_at = captured
        .iter()
        .position(|e| e == "content.extract")
        .expect("content.extract event emitted");
    assert!(
        verify_at < extract_at,
        "PGP verification must run before extraction (events: {captured:?})"
    );

    // And the signed payload was extracted, not the armor.
    let all = doc
        .blocks
        .iter()
        .map(|b| format!("{b:?}"))
        .collect::<String>();
    assert!(
        all.contains("must be extracted after verification"),
        "signed payload not extracted: {all}"
    );
}

#[test]
fn tampered_clearsign_is_rejected_as_pgp_invalid() {
    let body = "<html><body><p>sign this then tamper</p></body></html>";
    let (_secret, public) = generate_key();
    let mut armored = clearsign(body, &_secret);

    // Tamper with the cleartext AFTER signing.
    let tampered = armored.replace("sign this then tamper", "SIGN THIS THEN TAMPER");
    assert_ne!(armored, tampered);
    armored = tampered;

    let url = Url::parse("https://example.com/signed").unwrap();
    let resp = HttpResponseDebug {
        status: 200,
        content_type: Some("text/html".to_string()),
        ..Default::default()
    };
    let err = extract_doc(
        &url,
        &url,
        armored.as_bytes().to_vec(),
        Some("text/html"),
        &[public],
        &resp,
    )
    .unwrap_err();
    assert!(
        matches!(err, hypernext_http::Error::PgpInvalid),
        "expected PgpInvalid, got {err}"
    );
}

#[test]
fn unsigned_content_has_no_signature_and_no_timeout() {
    // Regression: ordinary (unsigned) HTTP must not attempt verification.
    let url = Url::parse("https://example.com/page").unwrap();
    let resp = HttpResponseDebug {
        status: 200,
        content_type: Some("text/html".to_string()),
        ..Default::default()
    };
    let doc = extract_doc(
        &url,
        &url,
        simple_article_html().as_bytes().to_vec(),
        Some("text/html"),
        &[],
        &resp,
    )
    .expect("unsigned extraction");
    assert!(
        doc.signature.is_none(),
        "unsigned page must have no signature"
    );
}
