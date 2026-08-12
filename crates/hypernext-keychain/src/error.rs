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
