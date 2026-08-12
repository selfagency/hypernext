//! Database connection and migration handling (ADR 0004).
//!
//! This module opens a SQLite connection, applies embedded refinery
//! migrations, and loads the sqlite-vec extension. The connection is
//! synchronous (`rusqlite::Connection`); callers in async contexts should wrap
//! calls in `tokio::task::spawn_blocking` (Phase 2+).

use std::path::Path;

use rusqlite::Connection;
use tracing::debug;

use crate::error::StoreError;

refinery::embed_migrations!("migrations");

/// Open (or create) a SQLite database at `path`, apply all pending migrations,
/// and load the sqlite-vec extension.
///
/// Re-opening an already-migrated database is a no-op: refinery skips
/// migrations already recorded in `refinery_schema_history`.
pub fn open(path: &Path) -> Result<Connection, StoreError> {
    register_vec_auto_extension();
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    run_migrations(&mut conn)?;
    verify_vec(&conn)?;
    Ok(conn)
}

/// Open an in-memory SQLite database for tests, applying migrations and
/// loading sqlite-vec.
pub fn open_in_memory() -> Result<Connection, StoreError> {
    register_vec_auto_extension();
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    run_migrations(&mut conn)?;
    verify_vec(&conn)?;
    Ok(conn)
}

/// Apply connection-level PRAGMAs: WAL journal mode and foreign keys.
fn configure(conn: &Connection) -> Result<(), StoreError> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// Run all embedded migrations against the connection.
fn run_migrations(conn: &mut Connection) -> Result<(), StoreError> {
    let report = migrations::runner().run(conn)?;
    debug!(
        applied = report.applied_migrations().len(),
        "migrations applied"
    );
    Ok(())
}

/// Register the sqlite-vec extension as an auto-extension so it is loaded on
/// every connection opened after this call. Must run BEFORE opening the
/// connection so the `vec0` module is available during migration.
fn register_vec_auto_extension() {
    // SAFETY: sqlite3_vec_init is a C entrypoint exposed by the sqlite-vec
    // crate; transmuting it to the auto-extension callback signature is the
    // documented registration pattern.
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::os::raw::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> i32,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    }
}

/// Verify the sqlite-vec extension is loaded by querying its version function.
fn verify_vec(conn: &Connection) -> Result<(), StoreError> {
    let version: Option<String> = conn
        .query_row("SELECT vec_version()", [], |row| row.get(0))
        .map_err(|e| StoreError::SqliteVec(e.to_string()))?;
    if version.is_none() {
        return Err(StoreError::SqliteVec(
            "vec_version() returned NULL; extension not loaded".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_succeeds() {
        let conn = open_in_memory().expect("in-memory db should open");
        assert!(conn.is_autocommit());
    }

    #[test]
    fn all_migrations_apply_cleanly() {
        let conn = open_in_memory().expect("in-memory db should open");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |row| {
                row.get(0)
            })
            .expect("schema history should be queryable");
        assert_eq!(count, 1, "exactly one migration should be recorded");
    }

    #[test]
    fn reopening_migrated_db_is_noop() {
        let dir =
            std::env::temp_dir().join(format!("hypernext-store-reopen-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&dir);

        let conn = open(&dir).expect("first open should migrate");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |row| {
                row.get(0)
            })
            .expect("queryable");
        assert_eq!(count, 1);

        // Re-open: no new migrations should be applied.
        let conn2 = open(&dir).expect("reopen should be a no-op");
        let count2: i64 = conn2
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |row| {
                row.get(0)
            })
            .expect("queryable");
        assert_eq!(count2, 1, "reopen must not re-apply migrations");

        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn fts5_virtual_table_exists_and_accepts_inserts() {
        let conn = open_in_memory().expect("in-memory db should open");
        conn.execute(
            "INSERT INTO capture_fts (url, title, content) VALUES (?1, ?2, ?3)",
            rusqlite::params!["https://example.com", "Example", "hello world"],
        )
        .expect("fts5 insert should succeed");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM capture_fts", [], |row| row.get(0))
            .expect("queryable");
        assert_eq!(count, 1);
    }

    #[test]
    fn sqlite_vec_extension_loads() {
        let conn = open_in_memory().expect("in-memory db should open");
        let version: String = conn
            .query_row("SELECT vec_version()", [], |row| row.get(0))
            .expect("vec_version should be queryable");
        assert!(!version.is_empty(), "vec_version must be non-empty");
    }

    #[test]
    fn foreign_keys_are_on() {
        let conn = open_in_memory().expect("in-memory db should open");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("queryable");
        assert_eq!(fk, 1, "foreign_keys pragma must be 1");
    }

    #[test]
    fn wal_mode_is_enabled() {
        // WAL is not supported on in-memory databases, so use a temp file.
        let dir =
            std::env::temp_dir().join(format!("hypernext-store-wal-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&dir);

        let conn = open(&dir).expect("file db should open");
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("queryable");
        assert_eq!(mode, "wal", "journal_mode must be wal");

        let _ = std::fs::remove_file(&dir);
    }
}
