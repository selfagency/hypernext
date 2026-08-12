use thiserror::Error;

/// Errors from keychain operations (ADR 0009: thiserror for libraries).
#[derive(Debug, Error)]
pub enum KeychainError {
    /// The underlying keyring store failed.
    #[error("keychain error: {0}")]
    Keyring(#[from] keyring::Error),
    /// No secret is stored for the requested account.
    #[error("no secret stored for this account")]
    NotFound,
    /// The account name is invalid (e.g. empty).
    #[error("invalid keychain input")]
    InvalidInput,
}

impl From<KeychainError> for hypernext_core::HypernextError {
    fn from(e: KeychainError) -> Self {
        hypernext_core::HypernextError::Keychain(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::HypernextError;

    /// `?` propagates from `KeychainError` to `HypernextError::Keychain` via
    /// the `From` impl (ADR 0009), without manual `map_err`.
    #[test]
    fn keychain_error_propagates_via_question_mark() {
        fn inner() -> Result<(), HypernextError> {
            Err(KeychainError::InvalidInput)?;
            Ok(())
        }
        let err = inner().unwrap_err();
        assert!(matches!(err, HypernextError::Keychain(_)));
        assert_eq!(err.code(), "KEYCHAIN_ERROR");
    }

    /// The `From` impl preserves the underlying message in the payload.
    #[test]
    fn from_impl_preserves_message() {
        let e: HypernextError = KeychainError::NotFound.into();
        assert_eq!(e.code(), "KEYCHAIN_ERROR");
        assert!(
            e.to_string()
                .starts_with("KEYCHAIN_ERROR: no secret stored"),
            "got: {e}"
        );
    }
}
