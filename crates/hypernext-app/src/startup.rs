//! Application startup wiring (Phase 1, task t10).
//!
//! Runs before the RelmApp starts: opens the SQLite store (running migrations
//! on first launch) at `<data_dir>/hypernext.db` and initializes the OS
//! keychain service.
//!
//! Data directory resolution:
//! - `HYPERNEXT_DATA_DIR` env var overrides the location (used by tests and
//!   power users).
//! - Otherwise macOS `~/Library/Application Support/Hypernext/` (via `dirs`).
//!
//! Errors propagate as `anyhow::Error` at the app boundary (ADR 0009: anyhow
//! for the app). Store and keychain errors route through their `From<...> for
//! HypernextError` impls (added in the leaf crates, t10) before reaching the
//! boundary.

use std::path::PathBuf;

use anyhow::Context;
use tracing::info;

use hypernext_keychain::KeychainError;

/// The database file name inside the data directory.
const DB_FILE: &str = "hypernext.db";

/// The account used to probe whether the keychain service is usable. No
/// secret is stored; a successful read (or `NotFound`) proves the service
/// responds.
const KEYCHAIN_PROBE_ACCOUNT: &str = "__startup_probe__";

/// Everything the app needs at startup.
pub struct Startup {
    /// The resolved data directory (where all persistent files live).
    pub data_dir: PathBuf,
    /// An open, migrated SQLite connection.
    pub conn: rusqlite::Connection,
}

/// Run all startup steps: resolve the data dir, open (and migrate) the SQLite
/// store, and initialize the keychain service.
///
/// Returns an error if any step fails; the caller should abort startup.
pub fn startup() -> anyhow::Result<Startup> {
    let data_dir = resolve_data_dir().with_context(|| {
        "no usable data directory: HOME is not set and HYPERNEXT_DATA_DIR is unset"
    })?;

    // Create the data dir if missing (macOS: ~/Library/Application Support/Hypernext).
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create data dir {}", data_dir.display()))?;

    let db_path = data_dir.join(DB_FILE);
    let conn = hypernext_store::db::open(&db_path)
        .with_context(|| format!("failed to open store at {}", db_path.display()))?;

    init_keychain()?;

    info!(data_dir = %data_dir.display(), "startup complete");
    Ok(Startup { data_dir, conn })
}

/// Resolve the data directory: `HYPERNEXT_DATA_DIR` if set, else
/// `<home>/Library/Application Support/Hypernext` on macOS (via `dirs`).
fn resolve_data_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("HYPERNEXT_DATA_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    let base = dirs::data_dir()?; // macOS: ~/Library/Application Support
    Some(base.join("Hypernext"))
}

/// Verify the keychain service is usable by performing a read on a probe
/// account. A successful read, or `NotFound`, proves the service responds;
/// any other error means the service is unavailable.
///
/// Returns `Err(HypernextError::Keychain(...))` via the `From<KeychainError>`
/// impl (exercised with `?`).
fn init_keychain() -> Result<(), hypernext_core::HypernextError> {
    // Install the real platform store unless a store is already set (e.g. the
    // in-memory mock in tests). Then probe it.
    hypernext_keychain::ensure_default_store()?;
    let secret = hypernext_keychain::Secret::new("__startup_probe__", KEYCHAIN_PROBE_ACCOUNT)?;
    match hypernext_keychain::get(&secret) {
        Ok(_) | Err(KeychainError::NotFound) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Install keyring's in-memory mock store once (ADR 0007: tests never hit
    /// the real keychain).
    ///
    /// Order is critical for CI on headless Linux. `keyring::Entry::store_status()`
    /// would trigger keyring v1's one-time platform-store init, which fails when no
    /// D-Bus Secret Service is available. That failure is cached and permanently
    /// gates every later `keyring::Entry::new()` with `NoDefaultStore` — even after
    /// the mock store is set. So the mock store is installed directly via
    /// `keyring_core::set_default_store` (which the keychain crate's operations read
    /// through `keyring_core::Entry`), never through the gated `keyring::Entry`.
    fn install_mock_keychain() {
        use std::sync::Once;
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
        });
    }

    /// Recursively collect every path under `root`.
    fn collect_paths(root: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let p = entry.path();
                out.push(p.clone());
                if p.is_dir() {
                    collect_paths(&p, out);
                }
            }
        }
    }

    /// First launch runs migrations (refinery schema history gets one row) and
    /// creates every file only inside the data directory.
    ///
    /// Confinement is the hard Phase 1 exit criterion: nothing may be written
    /// outside `<data_dir>`.
    #[test]
    fn startup_runs_migrations_and_creates_no_files_outside_data_dir() {
        // nosemgrep: temp-dir - test-only data-dir confinement check, not a security decision
        let base = std::env::temp_dir().join(format!(
            "hypernext-startup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = base.join("data");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        // Point the data dir at a fresh temp location.
        std::env::set_var("HYPERNEXT_DATA_DIR", &data);

        // Install the in-memory keychain mock before startup so the probe read
        // never hits the real keychain (ADR 0007).
        install_mock_keychain();

        let s = startup().expect("startup should succeed");
        assert_eq!(s.data_dir, data);

        // Acceptance: first launch runs migrations (schema history populated).
        let count: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |r| {
                r.get(0)
            })
            .expect("schema history queryable");
        assert_eq!(count, 1, "first launch must apply exactly one migration");

        // Drop the connection so WAL/SHM files are finalized before scanning.
        drop(s);

        // Acceptance: zero files outside the data directory. Walk the temp
        // root and assert every entry lives under `data`.
        let mut paths = Vec::new();
        collect_paths(&base, &mut paths);
        for p in paths {
            assert!(
                p.starts_with(&data),
                "file created outside data dir: {}",
                p.display()
            );
        }

        // The DB file must exist under the data dir.
        assert!(data.join(DB_FILE).exists(), "hypernext.db should exist");

        let _ = std::fs::remove_dir_all(&base);
    }

    /// The keychain service initializes successfully (probe read against the
    /// mock store).
    #[test]
    fn init_keychain_verifies_service_usable() {
        install_mock_keychain();
        init_keychain().expect("keychain init should succeed against mock store");
    }
}
