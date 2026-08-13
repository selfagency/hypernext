//! Web-mode domain logic (Phase 3, p3-t5): per-origin Reader/Raw preference.
//!
//! Left half of the WebMode toggle. The mode preference is persisted per
//! origin in the `settings` table under the `webmode.<origin>` key; `resolve`
//! looks it up and falls back to [`WebMode::Reader`].
//!
//! # Home in hypernext-store
//!
//! This module lives here — not `hypernext-core` — because the dependency
//! graph forbids it elsewhere. `hypernext-store` depends on `hypernext-core`
//! (for the shared error type / ADR 0009 propagation decisions), so a WebMode
//! module in `hypernext-core` that took the store's `Connection` would create
//! a `core -> store -> core` cycle. The store crate owns the `settings` table
//! and the `Connection`, so the domain logic that reads/writes it belongs
//! here. Both the http adapter (via `hypernext-store`) and the UI (Phase 4)
//! can reach it without a cycle.
//!
//! # Security: incognito forces Reader
//!
//! Raw mode is disabled in incognito windows. Per-phase-doc safety reasoning,
//! raw mode renders un-sanitized content, so it must never activate in an
//! incognito session even if the user has opted into Raw for that origin. The
//! incognito flag therefore short-circuits `resolve` to always return
//! [`WebMode::Reader`] regardless of any saved preference.

use url::Url;

use crate::StoreError;

/// How a page is rendered.
///
/// `Reader` renders sanitized/processed content (the default).
/// `Raw` renders the un-processed origin document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebMode {
    /// Sanitized/processed rendering (default, and the only mode in incognito).
    Reader,
    /// Un-processed rendering of the origin document.
    Raw,
}

/// Settings-table key prefix for per-origin web-mode preferences.
pub const WEBMODE_KEY_PREFIX: &str = "webmode.";
/// Value stored for the `Raw` preference.
const VALUE_RAW: &str = "\"raw\"";

/// Resolve the effective web mode for `url`.
///
/// When `incognito` is `true`, this **always** returns [`WebMode::Reader`] —
/// raw mode cannot activate in incognito for safety, regardless of any saved
/// preference (documented above).
///
/// Otherwise it looks up the per-origin preference under `webmode.<origin>`
/// and returns [`WebMode::Raw`] if set, defaulting to [`WebMode::Reader`] for
/// unknown origins (and for the "not stored" state, since setting Reader
/// clears the row entirely).
pub fn resolve_mode(url: &Url, store: &rusqlite::Connection, incognito: bool) -> WebMode {
    if incognito {
        return WebMode::Reader;
    }
    let key = origin_key(url);
    let raw: Option<String> = store
        .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |row| {
            row.get(0)
        })
        .ok();
    match raw.as_deref() {
        Some(VALUE_RAW) => WebMode::Raw,
        _ => WebMode::Reader,
    }
}

/// Persist `mode` for `url`'s origin.
///
/// Setting [`WebMode::Reader`] **clears** the preference: the `webmode.<origin>`
/// row is removed rather than stored as a Reader row. Only a `Raw` preference
/// produces a row.
pub fn set_mode_pref(
    url: &Url,
    mode: WebMode,
    store: &rusqlite::Connection,
) -> Result<(), StoreError> {
    let key = origin_key(url);
    match mode {
        WebMode::Reader => {
            store.execute("DELETE FROM settings WHERE key = ?1", [&key])?;
        }
        WebMode::Raw => {
            store.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                [&key, VALUE_RAW],
            )?;
        }
    }
    Ok(())
}

/// Build the per-origin settings key `webmode.<scheme>://<host>`.
fn origin_key(url: &Url) -> String {
    // Origin must be `scheme://host` (host is non-empty for http(s); fall back
    // to the full scheme://host:port so preferences don't alias across ports).
    let host = url.host_str().unwrap_or("");
    let mut origin = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        origin.push(':');
        origin.push_str(&port.to_string());
    }
    if host.is_empty() {
        // Non-hierarchical / opaque URLs (e.g. `about:`) cannot carry a
        // per-origin pref; key by the whole URL authority-less form.
        origin = url.as_str().to_string();
    }
    format!("{WEBMODE_KEY_PREFIX}{origin}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn url(s: &str) -> Url {
        Url::parse(s).expect("test url parses")
    }

    fn open_db() -> rusqlite::Connection {
        db::open_in_memory().expect("in-memory db opens")
    }

    /// Unknown origin -> default Reader.
    #[test]
    fn unknown_origin_defaults_to_reader() {
        let conn = open_db();
        let u = url("https://unknown.example/");
        assert_eq!(resolve_mode(&u, &conn, false), WebMode::Reader);
    }

    /// Raw pref set on origin, resolve on a sub-path -> Raw.
    #[test]
    fn raw_pref_on_origin_applies_to_subpath() {
        let conn = open_db();
        let origin = url("https://example.com");
        set_mode_pref(&origin, WebMode::Raw, &conn).expect("set raw");
        let page = url("https://example.com/some/page");
        assert_eq!(resolve_mode(&page, &conn, false), WebMode::Raw);
    }

    /// Port is part of the origin (no cross-port aliasing).
    #[test]
    fn preference_is_per_origin_including_port() {
        let conn = open_db();
        set_mode_pref(&url("https://example.com:8080"), WebMode::Raw, &conn).expect("set raw");
        // Without port = different origin -> Reader.
        assert_eq!(
            resolve_mode(&url("https://example.com/a"), &conn, false),
            WebMode::Reader
        );
        assert_eq!(
            resolve_mode(&url("https://example.com:8080/a"), &conn, false),
            WebMode::Raw
        );
    }

    /// Preference persists across DB re-open (file-backed).
    #[test]
    fn preference_persists_across_reopen() {
        let dir =
            std::env::temp_dir().join(format!("hypernext-store-webmode-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&dir);

        {
            let conn = db::open(&dir).expect("open");
            set_mode_pref(&url("https://example.com"), WebMode::Raw, &conn).expect("set raw");
        }
        {
            let conn = db::open(&dir).expect("reopen");
            assert_eq!(
                resolve_mode(&url("https://example.com/x"), &conn, false),
                WebMode::Raw,
                "pref must survive reopen"
            );
        }
        let _ = std::fs::remove_file(&dir);
    }

    /// Incognito forces Reader even when Raw is saved.
    #[test]
    fn incognito_forces_reader_regardless_of_pref() {
        let conn = open_db();
        let origin = url("https://example.com");
        set_mode_pref(&origin, WebMode::Raw, &conn).expect("set raw");
        assert_eq!(resolve_mode(&origin, &conn, true), WebMode::Reader);
        // And on a sub-path.
        assert_eq!(
            resolve_mode(&url("https://example.com/sub"), &conn, true),
            WebMode::Reader
        );
    }

    /// Setting Reader clears the row (no row, not a Reader row).
    #[test]
    fn set_reader_clears_preference() {
        let conn = open_db();
        let origin = url("https://example.com");
        set_mode_pref(&origin, WebMode::Raw, &conn).expect("set raw");

        set_mode_pref(&origin, WebMode::Reader, &conn).expect("clear");
        // Row is gone entirely.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
                [origin_key(&origin)],
                |row| row.get(0),
            )
            .expect("queryable");
        assert_eq!(count, 0, "Reader must delete the row, not store one");
        // Resolve falls back to Reader.
        assert_eq!(resolve_mode(&origin, &conn, false), WebMode::Reader);
    }

    /// Setting Reader on a never-set origin is a no-op (no error, no row).
    #[test]
    fn clear_nonexistent_is_noop() {
        let conn = open_db();
        let origin = url("https://example.com");
        set_mode_pref(&origin, WebMode::Reader, &conn).expect("clear on empty is ok");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .expect("queryable");
        assert_eq!(count, 0);
    }

    /// Re-setting Raw overwrites the value (idempotent upsert).
    #[test]
    fn resets_to_raw_is_idempotent() {
        let conn = open_db();
        let origin = url("https://example.com");
        set_mode_pref(&origin, WebMode::Raw, &conn).expect("set raw");
        set_mode_pref(&origin, WebMode::Raw, &conn).expect("set raw again");
        assert_eq!(resolve_mode(&origin, &conn, false), WebMode::Raw);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
                [origin_key(&origin)],
                |row| row.get(0),
            )
            .expect("queryable");
        assert_eq!(count, 1, "single row, not duplicated");
    }

    /// Opaque / no-host URLs still resolve to Reader without touching the table.
    #[test]
    fn opaque_url_resolves_to_reader() {
        let conn = open_db();
        let about = url("about:blank");
        assert_eq!(resolve_mode(&about, &conn, false), WebMode::Reader);
        // Setting Raw on an opaque URL must not error and leaves a row we won't
        // use; resolve still returns Raw for it deterministically.
        set_mode_pref(&about, WebMode::Raw, &conn).expect("set raw on opaque");
        assert_eq!(resolve_mode(&about, &conn, false), WebMode::Raw);
    }
}
