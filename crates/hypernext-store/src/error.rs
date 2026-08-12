//! Error types for the Hypernext store crate (ADR 0009: thiserror for libraries).

use thiserror::Error;

/// Errors produced by the store layer.
///
/// Library errors use `thiserror` (ADR 0009); application code converts these
/// into `anyhow::Error` at the boundary.
#[derive(Debug, Error)]
pub enum StoreError {
    /// A SQLite operation failed (rusqlite error).
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// A database migration failed (refinery error).
    #[error("migration error: {0}")]
    Migration(#[from] refinery::Error),

    /// The sqlite-vec extension could not be loaded or is unavailable.
    #[error("sqlite-vec error: {0}")]
    SqliteVec(String),

    /// A requested record does not exist.
    #[error("record not found")]
    NotFound,

    /// The caller supplied invalid input.
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl From<StoreError> for hypernext_core::HypernextError {
    fn from(e: StoreError) -> Self {
        hypernext_core::HypernextError::Storage(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypernext_core::HypernextError;

    /// `?` propagates from `StoreError` to `HypernextError::Storage` via the
    /// `From` impl (ADR 0009), without manual `map_err`.
    #[test]
    fn store_error_propagates_via_question_mark() {
        fn inner() -> Result<(), HypernextError> {
            Err(StoreError::InvalidInput("bad".to_string()))?;
            Ok(())
        }
        let err = inner().unwrap_err();
        assert!(matches!(err, HypernextError::Storage(_)));
        assert_eq!(err.code(), "STORAGE_ERROR");
    }

    /// The `From` impl preserves the underlying message in the payload.
    #[test]
    fn from_impl_preserves_message() {
        let e: HypernextError = StoreError::Sqlite(rusqlite::Error::InvalidQuery).into();
        assert_eq!(e.code(), "STORAGE_ERROR");
        assert!(
            e.to_string().starts_with("STORAGE_ERROR: sqlite error:"),
            "got: {e}"
        );
    }
}
