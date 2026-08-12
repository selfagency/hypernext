//! Hypernext store crate: SQLite persistence layer (ADR 0004).
//!
//! Provides database connection handling, embedded migrations, and the
//! store's error type.

pub mod db;
pub mod error;

pub use error::StoreError;
