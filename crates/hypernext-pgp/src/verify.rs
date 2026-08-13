//! Core PGP signature verification (rpgp).
//!
//! # CRITICAL INVARIANT — verification runs BEFORE extraction (ethics B-09)
//!
//! PGP verification operates on the **raw response bytes** exactly as received
//! from the wire. It MUST run before any HTML/markdown/structured extraction,
//! parsing, or rendering of the document. The original Bean (Wails) had a bug
//! where `checkPGP` ran *after* content extraction; we must NOT reproduce it.
//!
//! Concretely:
//! - [`verify_clearsign`] and [`verify_detached`] take raw byte slices.
//! - [`extract_clearsign_blocks`] locates the armored blocks but does **not**
//!   decode the HTML body — it only finds block boundaries. It is the ONLY
//!   "extraction" allowed before verification, and it operates on the raw
//!   bytes to hand the exact block to rpgp (rpgp rejects leading data).
//! - Content extraction (HTML→Block, gemtext→Block) must be invoked only
//!   *after* verification has run, and callers are expected to record the
//!   resulting [`PgpStatus`] on the document.
//!
//! The call order is enforced and tested via a tracing hook: a `pgp.verify`
//! event must precede a `content.extract` event.

use pgp::composed::Deserializable;
use pgp::composed::{CleartextSignedMessage, DetachedSignature, SignedPublicKey};
use pgp::types::KeyDetails;

use crate::error::PgpError;

/// Result of a PGP signature check for one document.
///
/// Mirrors `hypernext_core::PgpStatus`; [`Verification::to_status`] bridges to
/// the core domain type so a verified `PageDoc` can carry the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verification {
    /// Signature valid AND signed by the supplied key.
    Valid,
    /// Signature cryptographically valid but the signer key is not trusted
    /// (e.g. fetched via keys.openpgp.org, not TOFU-pinned yet).
    ValidUntrusted,
    /// Signature invalid: content was tampered with or the key is wrong.
    Invalid,
    /// No key could be found via the lookup chain; nothing verified.
    Unverified,
    /// TOFU fingerprint mismatch: the host previously presented a different
    /// signing key than it does now.
    KeyChanged,
}

impl Verification {
    /// Convert to the core domain status used on `PageDoc::signature`.
    pub fn to_status(self) -> hypernext_core::PgpStatus {
        use hypernext_core::PgpStatus;
        match self {
            Verification::Valid => PgpStatus::Valid,
            Verification::ValidUntrusted => PgpStatus::ValidUntrusted,
            Verification::Invalid => PgpStatus::Invalid,
            Verification::Unverified => PgpStatus::Unverified,
            Verification::KeyChanged => PgpStatus::KeyChanged,
        }
    }
}

/// A located armored clearsign block within a byte stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClearsignBlock {
    /// Byte offset of the `-----BEGIN PGP SIGNED MESSAGE-----` header.
    pub start: usize,
    /// Byte offset just past the `-----END PGP SIGNATURE-----` marker.
    pub end: usize,
    /// The full armored block (header through end marker), for rpgp parsing.
    pub raw: Vec<u8>,
    /// The cleartext body (the signed content) as bytes.
    pub payload: Vec<u8>,
}

const BEGIN_MESSAGE: &str = "-----BEGIN PGP SIGNED MESSAGE-----";
const BEGIN_SIGNATURE: &str = "-----BEGIN PGP SIGNATURE-----";
const END_SIGNATURE: &str = "-----END PGP SIGNATURE-----";

/// Locate every `-----BEGIN PGP SIGNED MESSAGE-----` block in `bytes`.
///
/// Only complete blocks (with a matching `-----END PGP SIGNATURE-----`) are
/// returned. This finds block boundaries on the raw bytes; it does not decode
/// the document body.
pub fn extract_clearsign_blocks(bytes: &[u8]) -> Vec<ClearsignBlock> {
    let text = match std::str::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    let mut blocks = Vec::new();
    let mut search_from = 0usize;

    while let Some(rel) = text[search_from..].find(BEGIN_MESSAGE) {
        let start = search_from + rel;
        let after_header = start + BEGIN_MESSAGE.len();
        let Some(end_rel) = text[after_header..].find(END_SIGNATURE) else {
            break;
        };
        let end = after_header + end_rel + END_SIGNATURE.len();

        let raw = bytes[start..end].to_vec();
        let payload = extract_payload(&text[start..end]);
        blocks.push(ClearsignBlock {
            start,
            end,
            raw,
            payload,
        });
        search_from = end;
    }

    blocks
}

/// Extract the cleartext body from a single clearsign block (header through
/// end marker). Returns empty bytes if the body cannot be located.
fn extract_payload(block: &str) -> Vec<u8> {
    let sig_idx = block.find(BEGIN_SIGNATURE).unwrap_or(block.len());
    let head = &block[..sig_idx];
    // Headers end at the first blank line.
    let Some(nl) = head.find("\n\n") else {
        return Vec::new();
    };
    let body = &head[nl + 2..];
    body.trim_end_matches(['\n', '\r']).as_bytes().to_vec()
}

/// Extract the `href` of a `<link rel="signature">` element from raw HTML
/// bytes, if present.
///
/// Returns the URL string. This is a raw-text scan over the response bytes; it
/// does not run a full HTML parser. It is safe to call before verification
/// because it only locates the signature's source URL — it does not decode or
/// render the document.
pub fn extract_signature_link(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    let lower = text.to_ascii_lowercase();
    let idx = lower.find("rel=\"signature\"")?;
    let window = &text[idx.saturating_sub(256)..(idx + 256).min(text.len())];
    // Find the href attribute within a generous window around the rel marker.
    let href = window.find("href=")?;
    let after = &window[href + 5..];
    let rest = after.trim_start();
    let (quote, open) = match rest.chars().next() {
        Some('\"') => ('\"', 1),
        Some('\'') => ('\'', 1),
        _ => ('\"', 0),
    };
    let value = &rest[open..];
    let end = value.find(quote)?;
    Some(value[..end].to_string())
}

/// Verify a clearsign-signed document against `key`.
///
/// `bytes` are the raw response bytes. A `-----BEGIN PGP SIGNED MESSAGE-----`
/// block is located and verified. Returns `Unverified` when the signature was
/// issued by a different key than the one supplied, `Invalid` when the content
/// was tampered, `Valid` on success.
pub fn verify_clearsign(bytes: &[u8], key: &SignedPublicKey) -> Result<Verification, PgpError> {
    tracing::info!(
        event = "pgp.verify",
        mode = "clearsign",
        "verifying clearsign signature"
    );

    let blocks = extract_clearsign_blocks(bytes);
    let Some(block) = blocks.first() else {
        return Err(PgpError::NoSignature);
    };

    let block_text = std::str::from_utf8(&block.raw)
        .map_err(|e| PgpError::Parse(format!("clearsign block not utf-8: {e}")))?;
    let (msg, _headers) = CleartextSignedMessage::from_string(block_text)
        .map_err(|e| PgpError::Parse(format!("clearsign parse: {e}")))?;

    let issuers = msg.signatures().first().map(|s| s.issuer_fingerprint());
    if let Some(issuer) = issuers.and_then(|v| v.into_iter().next())
        && !fingerprints_match(issuer, key)
    {
        return Ok(Verification::Unverified);
    }

    match msg.verify(key) {
        Ok(_) => Ok(Verification::Valid),
        Err(e) => {
            tracing::debug!(error = %e, "clearsign signature invalid");
            Ok(Verification::Invalid)
        }
    }
}

/// Verify a detached signature over `payload`.
///
/// `signature` is the armored `-----BEGIN PGP SIGNATURE-----` block bytes.
/// Returns `Unverified` when the signature was issued by a different key,
/// `Invalid` when it does not validate against `payload`, `Valid` on success.
pub fn verify_detached(
    payload: &[u8],
    signature: &[u8],
    key: &SignedPublicKey,
) -> Result<Verification, PgpError> {
    tracing::info!(
        event = "pgp.verify",
        mode = "detached",
        "verifying detached signature"
    );

    let sig_text = std::str::from_utf8(signature)
        .map_err(|e| PgpError::Parse(format!("detached signature not utf-8: {e}")))?;
    let (detached, _headers) = DetachedSignature::from_string(sig_text)
        .map_err(|e| PgpError::Parse(format!("detached signature parse: {e}")))?;

    if let Some(issuer) = detached.signature.issuer_fingerprint().into_iter().next()
        && !fingerprints_match(issuer, key)
    {
        return Ok(Verification::Unverified);
    }

    match detached.verify(key, payload) {
        Ok(_) => Ok(Verification::Valid),
        Err(e) => {
            tracing::debug!(error = %e, "detached signature invalid");
            Ok(Verification::Invalid)
        }
    }
}

/// Compare an issuer fingerprint to the primary key fingerprint.
fn fingerprints_match(issuer: &pgp::types::Fingerprint, key: &SignedPublicKey) -> bool {
    let issuer_hex = format!("{issuer:x}");
    let key_fp = key.primary_key.fingerprint();
    let key_hex = format!("{key_fp:x}");
    // Fingerprints may be truncated to key-id (last 16 hex) if only the
    // IssuerKeyId subpacket is present; fall back to a suffix comparison.
    issuer_hex == key_hex
        || (issuer_hex.len() >= 16
            && key_hex.len() >= 16
            && issuer_hex.ends_with(&key_hex[key_hex.len() - 16..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_maps_to_core_status() {
        use hypernext_core::PgpStatus;
        assert_eq!(Verification::Valid.to_status(), PgpStatus::Valid);
        assert_eq!(
            Verification::ValidUntrusted.to_status(),
            PgpStatus::ValidUntrusted
        );
        assert_eq!(Verification::Invalid.to_status(), PgpStatus::Invalid);
        assert_eq!(Verification::Unverified.to_status(), PgpStatus::Unverified);
        assert_eq!(Verification::KeyChanged.to_status(), PgpStatus::KeyChanged);
    }

    #[test]
    fn extract_finds_no_blocks_on_empty() {
        assert!(extract_clearsign_blocks(b"").is_empty());
        assert!(extract_clearsign_blocks(b"<html>no signature</html>").is_empty());
    }

    #[test]
    fn signature_link_extracts_href() {
        let html = b"<html><head>\n<link rel=\"signature\" href=\"sig.asc\">\n</head></html>";
        assert_eq!(extract_signature_link(html).as_deref(), Some("sig.asc"));
    }

    #[test]
    fn signature_link_absent_returns_none() {
        assert!(extract_signature_link(b"<html>no link</html>").is_none());
        assert!(extract_signature_link(b"").is_none());
    }
}
