//! HypernextError: the unified error type for the Hypernext application.
//!
//! ADR 0009: thiserror for library errors, anyhow for the app binary.
//! Every variant carries a stable string code (see [`HypernextError::code`])
//! used by E2E test assertions.

use std::str::FromStr;

/// The single top-level error type for Hypernext.
///
/// Each variant maps to an error category. Crate-specific error types
/// (e.g. `StoreError`, `KeychainError`) implement `From<TheirError> for
/// HypernextError` so errors propagate cleanly with `?`.
#[derive(Debug, thiserror::Error)]
pub enum HypernextError {
    /// A protocol-level error (Gemini, Gopher, Spartan, ...).
    #[error("PROTOCOL_ERROR: {0}")]
    Protocol(String),

    /// A storage / SQLite error.
    #[error("STORAGE_ERROR: {0}")]
    Storage(String),

    /// An OS keychain error.
    #[error("KEYCHAIN_ERROR: {0}")]
    Keychain(String),

    /// A network / HTTP error.
    #[error("NETWORK_ERROR: {0}")]
    Network(String),

    /// A PGP verification error.
    #[error("PGP_ERROR: {0}")]
    Pgp(String),

    /// The operation was cancelled.
    #[error("CANCELLED")]
    Cancelled,

    /// A URL could not be parsed.
    #[error("INVALID_URL: {0}")]
    InvalidUrl(String),

    /// A response exceeded the configured size limit.
    #[error("SIZE_LIMIT_EXCEEDED: {0} bytes")]
    SizeLimitExceeded(usize),

    /// A request was blocked by the SSRF policy.
    #[error("SSRF_BLOCKED: {0}")]
    SsrfBlocked(String),

    /// The request was unauthorized.
    #[error("UNAUTHORIZED: {0}")]
    Unauthorized(String),
}

impl HypernextError {
    /// The stable string code for this error, used by E2E test assertions.
    ///
    /// Codes are part of the public contract (ADR 0009): renaming one is a
    /// breaking change.
    pub fn code(&self) -> &'static str {
        match self {
            HypernextError::Protocol(_) => "PROTOCOL_ERROR",
            HypernextError::Storage(_) => "STORAGE_ERROR",
            HypernextError::Keychain(_) => "KEYCHAIN_ERROR",
            HypernextError::Network(_) => "NETWORK_ERROR",
            HypernextError::Pgp(_) => "PGP_ERROR",
            HypernextError::Cancelled => "CANCELLED",
            HypernextError::InvalidUrl(_) => "INVALID_URL",
            HypernextError::SizeLimitExceeded(_) => "SIZE_LIMIT_EXCEEDED",
            HypernextError::SsrfBlocked(_) => "SSRF_BLOCKED",
            HypernextError::Unauthorized(_) => "UNAUTHORIZED",
        }
    }
}

/// Round-trip a `HypernextError` through its stable string code.
///
/// `FromStr` parses the `Display` output back into the same variant. The
/// payload is not preserved (only the code is stable), so this is used for
/// E2E assertions and logging, not for lossless serialization.
impl FromStr for HypernextError {
    type Err = ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let code = s.split(':').next().unwrap_or(s).trim();
        match code {
            "PROTOCOL_ERROR" => Ok(HypernextError::Protocol(String::new())),
            "STORAGE_ERROR" => Ok(HypernextError::Storage(String::new())),
            "KEYCHAIN_ERROR" => Ok(HypernextError::Keychain(String::new())),
            "NETWORK_ERROR" => Ok(HypernextError::Network(String::new())),
            "PGP_ERROR" => Ok(HypernextError::Pgp(String::new())),
            "CANCELLED" => Ok(HypernextError::Cancelled),
            "INVALID_URL" => Ok(HypernextError::InvalidUrl(String::new())),
            "SIZE_LIMIT_EXCEEDED" => Ok(HypernextError::SizeLimitExceeded(0)),
            "SSRF_BLOCKED" => Ok(HypernextError::SsrfBlocked(String::new())),
            "UNAUTHORIZED" => Ok(HypernextError::Unauthorized(String::new())),
            _ => Err(ParseError::UnknownCode(code.to_string())),
        }
    }
}

/// Error returned when parsing a [`HypernextError`] from a string code.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// The string did not start with a known stable error code.
    #[error("unknown HypernextError code: {0}")]
    UnknownCode(String),
}

impl From<rusqlite::Error> for HypernextError {
    fn from(e: rusqlite::Error) -> Self {
        HypernextError::Storage(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every variant's stable code is exactly the expected string, and
    /// `Display` produces the code as a prefix (ADR 0009).
    #[test]
    fn error_codes_are_stable() {
        let cases: &[(HypernextError, &str)] = &[
            (HypernextError::Protocol("x".into()), "PROTOCOL_ERROR"),
            (HypernextError::Storage("x".into()), "STORAGE_ERROR"),
            (HypernextError::Keychain("x".into()), "KEYCHAIN_ERROR"),
            (HypernextError::Network("x".into()), "NETWORK_ERROR"),
            (HypernextError::Pgp("x".into()), "PGP_ERROR"),
            (HypernextError::Cancelled, "CANCELLED"),
            (HypernextError::InvalidUrl("x".into()), "INVALID_URL"),
            (HypernextError::SizeLimitExceeded(0), "SIZE_LIMIT_EXCEEDED"),
            (HypernextError::SsrfBlocked("x".into()), "SSRF_BLOCKED"),
            (HypernextError::Unauthorized("x".into()), "UNAUTHORIZED"),
        ];
        for (err, expected) in cases {
            assert_eq!(err.code(), *expected, "code() mismatch");
            assert!(
                err.to_string().starts_with(expected),
                "Display should start with code {expected}, got: {}",
                err.to_string()
            );
        }
    }

    /// Every variant round-trips through Display + FromStr.
    #[test]
    fn error_round_trips_through_display_and_fromstr() {
        let cases: &[HypernextError] = &[
            HypernextError::Protocol("boom".into()),
            HypernextError::Storage("boom".into()),
            HypernextError::Keychain("boom".into()),
            HypernextError::Network("boom".into()),
            HypernextError::Pgp("boom".into()),
            HypernextError::Cancelled,
            HypernextError::InvalidUrl("boom".into()),
            HypernextError::SizeLimitExceeded(1024),
            HypernextError::SsrfBlocked("boom".into()),
            HypernextError::Unauthorized("boom".into()),
        ];
        for err in cases {
            let s = err.to_string();
            let parsed: HypernextError = s.parse().expect("FromStr should succeed");
            assert_eq!(
                parsed.code(),
                err.code(),
                "round-trip code mismatch for {s}"
            );
        }
    }

    /// Unknown codes fail to parse.
    #[test]
    fn unknown_code_fails_to_parse() {
        let result: Result<HypernextError, _> = "NOT_A_CODE".parse();
        assert!(result.is_err());
    }

    /// `?` propagates from `rusqlite::Error` to `HypernextError::Storage`
    /// without manual `map_err`.
    #[test]
    fn question_mark_propagates_from_rusqlite() {
        fn inner() -> Result<(), HypernextError> {
            // A rusqlite error that does not require a live connection.
            let e = rusqlite::Error::InvalidQuery;
            Err(e)?;
            Ok(())
        }
        let err = inner().unwrap_err();
        assert!(matches!(err, HypernextError::Storage(_)));
        assert_eq!(err.code(), "STORAGE_ERROR");
    }

    /// `?` propagates from a crate error type via `From` (pattern used by
    /// store/keychain crates).
    #[test]
    fn question_mark_propagates_from_crate_error() {
        #[derive(Debug, thiserror::Error)]
        enum StoreError {
            #[error("migration failed")]
            Migration,
        }
        impl From<StoreError> for HypernextError {
            fn from(e: StoreError) -> Self {
                HypernextError::Storage(e.to_string())
            }
        }
        fn inner() -> Result<(), HypernextError> {
            Err(StoreError::Migration)?;
            Ok(())
        }
        let err = inner().unwrap_err();
        assert!(matches!(err, HypernextError::Storage(_)));
    }
}
