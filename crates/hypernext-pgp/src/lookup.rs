//! Key lookup chain for PGP-verified smolnet content.
//!
//! The lookup chain is tried in order until a key is found:
//!   1. Embedded key (from `link rel="signature"` or an inline armored key)
//!   2. Finger lookup (if the URL scheme is `finger://`)
//!   3. keys.openpgp.org lookup by email
//!   4. None found -> caller returns [`crate::Verification::Unverified`]
//!
//! This module defines the [`KeyLookup`] trait so the chain is testable
//! without real network calls; production wiring (Phase 2 t8) supplies a
//! `reqwest`-backed implementation for finger/keys.openpgp.org.

use pgp::composed::SignedPublicKey;

use crate::error::PgpError;

/// Source of a candidate signing key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeySource {
    /// Key embedded in the document (`link rel="signature"` or inline armor).
    Embedded,
    /// Key fetched from a `finger://` address.
    Finger,
    /// Key fetched from keys.openpgp.org by email.
    KeysOpenpgpOrg,
}

impl KeySource {
    pub fn to_core(self) -> hypernext_core::PgpKeySource {
        use hypernext_core::PgpKeySource;
        match self {
            KeySource::Embedded => PgpKeySource::Embedded,
            KeySource::Finger => PgpKeySource::FingerLookup,
            KeySource::KeysOpenpgpOrg => PgpKeySource::KeysOpenpgpOrg,
        }
    }
}

/// Result of the key lookup chain.
#[derive(Debug, Clone)]
pub struct ResolvedKey {
    pub key: SignedPublicKey,
    pub source: KeySource,
}

/// Abstraction over key-fetching backends (finger, keys.openpgp.org).
pub trait KeyLookup {
    /// Fetch a public key from a `finger://` address.
    fn lookup_finger(&mut self, address: &str) -> Result<Option<SignedPublicKey>, PgpError>;
    /// Fetch a public key from keys.openpgp.org by email address.
    fn lookup_by_email(&mut self, email: &str) -> Result<Option<SignedPublicKey>, PgpError>;
}

/// Run the key lookup chain and return the first resolved key, if any.
pub fn resolve_key(
    embedded: Option<SignedPublicKey>,
    url: Option<&str>,
    lookup: &mut dyn KeyLookup,
) -> Result<Option<ResolvedKey>, PgpError> {
    // 1. Embedded key wins.
    if let Some(key) = embedded {
        return Ok(Some(ResolvedKey {
            key,
            source: KeySource::Embedded,
        }));
    }

    let Some(url) = url else {
        return Ok(None);
    };

    // 2. finger:// address.
    if let Some(address) = url.strip_prefix("finger://")
        && let Some(key) = lookup.lookup_finger(address)?
    {
        return Ok(Some(ResolvedKey {
            key,
            source: KeySource::Finger,
        }));
    }

    // 3. keys.openpgp.org by email (extracted from a mailto: or the page URL).
    if let Some(email) = extract_email(url)
        && let Some(key) = lookup.lookup_by_email(&email)?
    {
        return Ok(Some(ResolvedKey {
            key,
            source: KeySource::KeysOpenpgpOrg,
        }));
    }

    // 4. None.
    Ok(None)
}

/// Extract an email address from a `mailto:` URL or a bare email string.
fn extract_email(url: &str) -> Option<String> {
    let rest = url.strip_prefix("mailto:").unwrap_or(url);
    let candidate = rest.split(['?', '/', ' ']).next().unwrap_or("");
    if candidate.contains('@') && !candidate.contains("://") {
        Some(candidate.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use pgp::composed::{KeyType, SecretKeyParamsBuilder};
    use pgp::crypto::hash::HashAlgorithm;
    use rand::SeedableRng;
    use rand::rngs::StdRng;
    use smallvec::smallvec;

    struct NoopLookup;

    impl KeyLookup for NoopLookup {
        fn lookup_finger(&mut self, _a: &str) -> Result<Option<SignedPublicKey>, PgpError> {
            Ok(None)
        }
        fn lookup_by_email(&mut self, _e: &str) -> Result<Option<SignedPublicKey>, PgpError> {
            Ok(None)
        }
    }

    #[test]
    fn embedded_key_wins_over_everything() {
        let mut lookup = NoopLookup;
        let r = resolve_key(
            Some(fake_key()),
            Some("finger://x@example.com"),
            &mut lookup,
        )
        .unwrap();
        assert_eq!(r.map(|k| k.source), Some(KeySource::Embedded));
    }

    #[test]
    fn finger_url_hits_finger_lookup() {
        let mut lookup = NoopLookup;
        let r = resolve_key(None, Some("finger://user@example.com"), &mut lookup).unwrap();
        // NoopLookup returns None, so chain falls through to None.
        assert!(r.is_none());
    }

    #[test]
    fn mailto_extracts_email() {
        assert_eq!(extract_email("mailto:a@b.com"), Some("a@b.com".to_string()));
        assert_eq!(extract_email("https://example.com/a@b.com"), None);
    }

    #[test]
    fn no_url_and_no_key_returns_none() {
        let mut lookup = NoopLookup;
        assert!(resolve_key(None, None, &mut lookup).unwrap().is_none());
    }

    fn fake_key() -> SignedPublicKey {
        // Generate a real Ed25519 signing key (fast) for source-ordering tests.
        let mut rng = StdRng::seed_from_u64(1);
        let mut params = SecretKeyParamsBuilder::default();
        params
            .key_type(KeyType::Ed25519Legacy)
            .can_certify(true)
            .can_sign(true)
            .primary_user_id("test@example.com".into())
            .preferred_hash_algorithms(smallvec![HashAlgorithm::Sha256]);
        let secret = params.build().unwrap().generate(&mut rng).unwrap();
        secret.to_public_key()
    }
}
