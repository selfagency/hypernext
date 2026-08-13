//! Hypernext store crate: SQLite persistence layer (ADR 0004).
//!
//! Provides database connection handling, embedded migrations, and the
//! store's error type.

pub mod db;
pub mod error;
pub mod webmode;

pub use error::StoreError;
pub use webmode::{WebMode, resolve_mode, set_mode_pref};
