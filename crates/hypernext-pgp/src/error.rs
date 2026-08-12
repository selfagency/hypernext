//! Error types for the Hypernext PGP crate (ADR 0009: thiserror for libraries).

use thiserror::Error;

/// Errors produced by the PGP verification layer.
#[derive(Debug, Error)]
pub enum PgpError {
    /// The input bytes could not be parsed as an armored PGP block.
    #[error("PGP parse error: {0}")]
    Parse(String),

    /// Signature verification failed (wrong key, tampered content, bad sig).
    #[error("PGP signature invalid: {0}")]
    Invalid(String),

    /// No signature was found in the provided bytes.
    #[error("no PGP signature found")]
    NoSignature,

    /// The key could not be loaded from the supplied public key bytes.
    #[error("invalid public key: {0}")]
    BadKey(String),

    /// A key-lookup source returned an error (finger, keys.openpgp.org).
    #[error("key lookup failed: {0}")]
    KeyLookup(String),

    /// No key could be found via the key lookup chain; verification is skipped.
    #[error("no key found; content unverified")]
    NoKey,

    /// The TOFU store failed.
    #[error("TOFU store error: {0}")]
    Tofu(String),
}

impl From<PgpError> for hypernext_core::HypernextError {
    fn from(e: PgpError) -> Self {
        hypernext_core::HypernextError::Pgp(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::HypernextError;

    #[test]
    fn pgp_error_propagates_via_question_mark() {
        fn inner() -> Result<(), HypernextError> {
            Err(PgpError::NoSignature)?;
            Ok(())
        }
        let err = inner().unwrap_err();
        assert!(matches!(err, HypernextError::Pgp(_)));
        assert_eq!(err.code(), "PGP_ERROR");
    }

    #[test]
    fn display_prefixes_with_pgp_error() {
        let e: HypernextError = PgpError::BadKey("nope".to_string()).into();
        assert!(e.to_string().starts_with("PGP_ERROR:"), "got: {e}");
    }
}
