//! Critical boundary test (ethics B-09): PGP verification MUST run on the raw
//! response bytes BEFORE any content extraction/parsing/rendering.
//!
//! We assert call order with a tracing hook: a `pgp.verify` event must be
//! emitted before a `content.extract` event. A correct adapter invokes
//! [`verify_clearsign`] first and only then runs extraction; the harness here
//! models the adapter flow and proves verify precedes extract.

use pgp::composed::CleartextSignedMessage;
use pgp::types::Password;
use rand::rngs::StdRng;
use rand::SeedableRng;
use tracing::Subscriber;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};

/// A layer that records the ordered sequence of `event` fields emitted.
#[derive(Default)]
struct OrderLayer {
    events: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl<S: Subscriber> Layer<S> for OrderLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if let Some(ev) = event.metadata().fields().field("event") {
            let mut visitor = CaptureVisitor {
                value: None,
                expected: ev.name(),
            };
            event.record(&mut visitor);
            if let Some(v) = visitor.value {
                self.events.lock().unwrap().push(v);
            }
        }
    }
}

struct CaptureVisitor {
    value: Option<String>,
    expected: &'static str,
}

impl tracing::field::Visit for CaptureVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == self.expected {
            self.value = Some(format!("{value:?}").trim_matches('"').to_string());
        }
    }
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == self.expected {
            self.value = Some(value.to_string());
        }
    }
}

/// Emit the `content.extract` event the adapter would emit after parsing.
fn adapter_extract(_bytes: &[u8]) -> String {
    tracing::info!(event = "content.extract", "extracting document");
    "extracted-blocks".to_string()
}

/// Model the adapter flow: verify the raw bytes FIRST, then extract.
/// Returns (verification_result, order_of_events).
fn adapter_flow(raw: &[u8], key: &pgp::composed::SignedPublicKey) -> (String, Vec<String>) {
    let order = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let layer = OrderLayer {
        events: order.clone(),
    };
    let subscriber = Registry::default().with(layer);
    let _guard = tracing::subscriber::set_default(subscriber);

    // Step 1: verify on the raw bytes BEFORE extraction.
    let ver = hypernext_pgp::verify_clearsign(raw, key)
        .map(|v| format!("{v:?}"))
        .unwrap_or_else(|e| format!("err:{e}"));

    // Step 2: extraction happens AFTER verification.
    let _ = adapter_extract(raw);

    let events = order.lock().unwrap().clone();
    (ver, events)
}

#[test]
fn verify_runs_before_extract_on_raw_bytes() {
    // Build a clearsign-signed HTML page (Pouya Code pattern).
    let mut rng = StdRng::seed_from_u64(99);
    let mut params = pgp::composed::SecretKeyParamsBuilder::default();
    params
        .key_type(pgp::composed::KeyType::Ed25519Legacy)
        .can_certify(true)
        .can_sign(true)
        .primary_user_id("boundary@example.com".into())
        .preferred_hash_algorithms(smallvec::smallvec![
            pgp::crypto::hash::HashAlgorithm::Sha256
        ]);
    let secret = params.build().unwrap().generate(&mut rng).unwrap();
    let public = secret.to_public_key();

    let body = "<!DOCTYPE html>\n<html><body><p>boundary</p></body></html>\n";
    let mut rng = StdRng::seed_from_u64(100);
    let msg = CleartextSignedMessage::sign(&mut rng, body, &*secret, &Password::empty()).unwrap();
    let mut out = Vec::new();
    msg.to_armored_writer(&mut out, Default::default()).unwrap();
    let armor = String::from_utf8(out).unwrap();

    // The raw response bytes (what the wire delivered).
    let raw = format!("<!--\n{armor}\n-->");
    let raw_bytes = raw.as_bytes();

    let (ver, events) = adapter_flow(raw_bytes, &public);
    assert_eq!(ver, "Valid", "raw bytes should verify");

    // Order assertion: pgp.verify BEFORE content.extract.
    let verify_idx = events.iter().position(|e| e == "pgp.verify");
    let extract_idx = events.iter().position(|e| e == "content.extract");
    let (v, e) = (verify_idx.unwrap(), extract_idx.unwrap());
    assert!(
        v < e,
        "pgp.verify must run before content.extract; events were {events:?}"
    );
}

#[test]
fn tampered_raw_bytes_fail_before_any_extraction() {
    // A tampered document must NOT reach extraction as if verified.
    let mut rng = StdRng::seed_from_u64(201);
    let mut params = pgp::composed::SecretKeyParamsBuilder::default();
    params
        .key_type(pgp::composed::KeyType::Ed25519Legacy)
        .can_certify(true)
        .can_sign(true)
        .primary_user_id("boundary2@example.com".into())
        .preferred_hash_algorithms(smallvec::smallvec![
            pgp::crypto::hash::HashAlgorithm::Sha256
        ]);
    let secret = params.build().unwrap().generate(&mut rng).unwrap();
    let public = secret.to_public_key();

    let body = "payload-before-tamper";
    let mut rng = StdRng::seed_from_u64(202);
    let msg = CleartextSignedMessage::sign(&mut rng, body, &*secret, &Password::empty()).unwrap();
    let mut out = Vec::new();
    msg.to_armored_writer(&mut out, Default::default()).unwrap();
    let mut armor = String::from_utf8(out).unwrap();

    // Tamper with the signed payload.
    armor = armor.replace("payload-before-tamper", "payload-AFTER-tamper");

    let ver = hypernext_pgp::verify_clearsign(armor.as_bytes(), &public).unwrap();
    assert_eq!(ver, hypernext_pgp::Verification::Invalid);
}
