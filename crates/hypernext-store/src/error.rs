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
