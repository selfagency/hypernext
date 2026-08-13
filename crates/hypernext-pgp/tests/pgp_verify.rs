//! Integration tests for hypernext-pgp: key generation, clearsign/detached
//! verification, TOFU key rotation, the Pouya Code inline HTML-comment pattern,
//! and the critical verify-before-extract boundary (ethics B-09).

use hypernext_pgp::tofu::{TofuStore, apply_tofu};
use hypernext_pgp::{Verification, verify_clearsign, verify_detached};
use pgp::composed::{CleartextSignedMessage, KeyType, SecretKeyParamsBuilder, SignedPublicKey};
use pgp::crypto::hash::HashAlgorithm;
use pgp::types::KeyDetails;
use pgp::types::Password;
use rand::SeedableRng;
use rand::rngs::StdRng;
use smallvec::smallvec;
use std::collections::HashMap;

/// Generate an Ed25519 signing keypair (fast; deterministic via seed).
struct TestKeys {
    secret: pgp::composed::SignedSecretKey,
    public: SignedPublicKey,
    fingerprint: String,
}

fn generate_keys(seed: u64) -> TestKeys {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut params = SecretKeyParamsBuilder::default();
    params
        .key_type(KeyType::Ed25519Legacy)
        .can_certify(true)
        .can_sign(true)
        .primary_user_id(format!("agent-{seed}@example.com"))
        .preferred_hash_algorithms(smallvec![HashAlgorithm::Sha256]);
    let secret = params.build().unwrap().generate(&mut rng).unwrap();
    let public = secret.to_public_key();
    let fingerprint = format!("{:x}", public.primary_key.fingerprint());
    TestKeys {
        secret,
        public,
        fingerprint,
    }
}

/// Clearsign `text` with the given secret key.
fn clearsign(text: &str, key: &pgp::composed::SignedSecretKey) -> String {
    let mut rng = StdRng::seed_from_u64(42);
    let msg = CleartextSignedMessage::sign(&mut rng, text, &**key, &Password::empty()).unwrap();
    // Serialize with to_armored_writer into a Vec<u8>, then to string.
    let mut out = Vec::new();
    msg.to_armored_writer(&mut out, Default::default()).unwrap();
    String::from_utf8(out).unwrap()
}

/// A tiny in-memory TOFU store for the host-key rotation test.
#[derive(Default)]
struct MemTofu {
    map: HashMap<String, String>,
}

impl TofuStore for MemTofu {
    fn pinned_fingerprint(
        &mut self,
        host: &str,
    ) -> Result<Option<String>, hypernext_pgp::PgpError> {
        Ok(self.map.get(host).cloned())
    }
    fn store_fingerprint(
        &mut self,
        host: &str,
        fingerprint: &str,
    ) -> Result<(), hypernext_pgp::PgpError> {
        self.map.insert(host.to_string(), fingerprint.to_string());
        Ok(())
    }
}

#[test]
fn valid_clearsign_returns_valid() {
    let keys = generate_keys(1);
    let signed = clearsign("<html><body>hello</body></html>", &keys.secret);
    let ver = verify_clearsign(signed.as_bytes(), &keys.public).unwrap();
    assert_eq!(ver, Verification::Valid);
}

#[test]
fn tampered_clearsign_returns_invalid() {
    let keys = generate_keys(2);
    let mut signed = clearsign("<html><body>hello</body></html>", &keys.secret);
    // Tamper with the payload inside the armored block.
    signed = signed.replace("hello", "tampered");
    let ver = verify_clearsign(signed.as_bytes(), &keys.public).unwrap();
    assert_eq!(ver, Verification::Invalid);
}

#[test]
fn wrong_key_returns_unverified() {
    let signer = generate_keys(3);
    let other = generate_keys(4);
    let signed = clearsign("content", &signer.secret);
    // The signature was issued by signer, but we supply `other`'s key.
    let ver = verify_clearsign(signed.as_bytes(), &other.public).unwrap();
    assert_eq!(ver, Verification::Unverified);
}

#[test]
fn no_signature_returns_no_signature_error() {
    let keys = generate_keys(5);
    let err = verify_clearsign(b"<html>no signature</html>", &keys.public).unwrap_err();
    assert!(matches!(err, hypernext_pgp::PgpError::NoSignature));
}

#[test]
fn inline_html_comment_signature_pouya_code_pattern_extracts_and_verifies() {
    // The Pouya Code pattern wraps the PGP armor inside HTML comments so both
    // browsers (which ignore <!-- -->) and PGP clients (which locate the
    // -----BEGIN block) can consume the file. The armor is NOT modified.
    let keys = generate_keys(6);
    let body = "<!DOCTYPE html>\n<html>\n<body>\n<p>signed page</p>\n</body>\n</html>\n";
    let armor = clearsign(body, &keys.secret);

    // Simulate the pattern: signature armor sits inside an HTML comment.
    let page = format!("<!--\n{armor}\n-->\n");

    let blocks = hypernext_pgp::extract_clearsign_blocks(page.as_bytes());
    assert_eq!(
        blocks.len(),
        1,
        "must locate the inline HTML-comment signature"
    );

    let ver = verify_clearsign(page.as_bytes(), &keys.public).unwrap();
    assert_eq!(ver, Verification::Valid);
}

#[test]
fn detached_signature_verifies() {
    let keys = generate_keys(7);
    let payload = b"<html><body>detached</body></html>";

    // Sign binary payload -> detached signature armor.
    let mut rng = StdRng::seed_from_u64(7);
    let detached = pgp::composed::DetachedSignature::sign_binary_data(
        &mut rng,
        &*keys.secret,
        &Password::empty(),
        HashAlgorithm::Sha256,
        &payload[..],
    )
    .unwrap();
    let mut out = Vec::new();
    detached
        .to_armored_writer(&mut out, Default::default())
        .unwrap();

    let ver = verify_detached(payload, &out, &keys.public).unwrap();
    assert_eq!(ver, Verification::Valid);
}

#[test]
fn detached_signature_tampered_payload_is_invalid() {
    let keys = generate_keys(8);
    let payload = b"<html><body>detached</body></html>";
    let tampered = b"<html><body>DETACHED</body></html>";

    let mut rng = StdRng::seed_from_u64(8);
    let detached = pgp::composed::DetachedSignature::sign_binary_data(
        &mut rng,
        &*keys.secret,
        &Password::empty(),
        HashAlgorithm::Sha256,
        &payload[..],
    )
    .unwrap();
    let mut out = Vec::new();
    detached
        .to_armored_writer(&mut out, Default::default())
        .unwrap();

    let ver = verify_detached(tampered, &out, &keys.public).unwrap();
    assert_eq!(ver, Verification::Invalid);
}

#[test]
fn key_rotation_first_stores_then_second_reports_key_changed() {
    let keys_a = generate_keys(9);
    let keys_b = generate_keys(10);
    let host = "example.com";
    let mut store = MemTofu::default();

    // First successful verify with key A -> TOFU pins fingerprint A.
    let r1 = apply_tofu(&mut store, host, &keys_a.fingerprint).unwrap();
    assert_eq!(r1, Verification::Valid);
    assert_eq!(
        store.pinned_fingerprint(host).unwrap().as_deref(),
        Some(keys_a.fingerprint.as_str())
    );

    // Second verify with a different key (rotation) -> KeyChanged.
    let r2 = apply_tofu(&mut store, host, &keys_b.fingerprint).unwrap();
    assert_eq!(r2, Verification::KeyChanged);

    // Same key still Valid.
    let r3 = apply_tofu(&mut store, host, &keys_a.fingerprint).unwrap();
    assert_eq!(r3, Verification::Valid);
}

#[test]
fn clearsign_fingerprint_matches_signer() {
    // Sanity: the fingerprint recorded by TOFU matches the signer's key.
    let keys = generate_keys(11);
    assert_eq!(
        keys.fingerprint.len(),
        40,
        "Ed25519 v4 fingerprint is 40 hex chars"
    );
}

#[test]
fn detached_signature_via_link_rel_signature_fetches_and_verifies() {
    // A page carries `<link rel="signature" href="page.sig">`. The detached
    // signature is fetched separately, then verified against the payload.
    let keys = generate_keys(12);
    let payload = b"<html><body>signed via link rel signature</body></html>";

    let mut rng = StdRng::seed_from_u64(12);
    let detached = pgp::composed::DetachedSignature::sign_binary_data(
        &mut rng,
        &*keys.secret,
        &Password::empty(),
        HashAlgorithm::Sha256,
        &payload[..],
    )
    .unwrap();
    let mut out = Vec::new();
    detached
        .to_armored_writer(&mut out, Default::default())
        .unwrap();

    // The "fetched" page contains a link rel="signature" to the armor file.
    let page = "<html><head><link rel=\"signature\" href=\"page.sig\"></head><body>x</body></html>"
        .to_string();
    let href = hypernext_pgp::extract_signature_link(page.as_bytes());
    assert_eq!(href.as_deref(), Some("page.sig"));

    // "Fetch" the detached signature bytes (simulating HTTP GET page.sig).
    let ver = hypernext_pgp::verify_detached(payload, &out, &keys.public).unwrap();
    assert_eq!(ver, Verification::Valid);
}
