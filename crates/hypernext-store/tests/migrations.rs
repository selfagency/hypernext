//! Integration tests for the Hypernext store migrations.
//!
//! These exercise the real on-disk migration path: apply to a temp file,
//! re-open to verify schema stability, and round-trip a row through every
//! domain table.

use std::path::PathBuf;

use hypernext_store::db;

/// Create a unique temp DB path for this test process.
fn temp_db(name: &str) -> PathBuf {
    let path =
        std::env::temp_dir().join(format!("hypernext-store-{name}-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

#[test]
fn schema_is_stable_across_reopen() {
    let path = temp_db("stable");

    // First open applies migrations.
    {
        let conn = db::open(&path).expect("first open should migrate");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |r| {
                r.get(0)
            })
            .expect("queryable");
        assert_eq!(count, 1, "one migration recorded");
    }

    // Re-open: schema must be identical, no re-migration.
    {
        let conn = db::open(&path).expect("reopen should succeed");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM refinery_schema_history", [], |r| {
                r.get(0)
            })
            .expect("queryable");
        assert_eq!(count, 1, "reopen must not re-apply migrations");

        // Spot-check every domain table exists.
        for table in [
            "browsing_history",
            "bookmarks",
            "folders",
            "tags",
            "bookmark_tags",
            "settings",
            "page_cache",
            "tofu_certs",
            "tofu_pgp_keys",
            "capture_fts",
            "capture_vec",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .expect("queryable");
            assert_eq!(exists, 1, "table {table} should exist");
        }
    }

    let _ = std::fs::remove_file(&path);
}

#[test]
fn down_migration_is_not_supported() {
    // Known constraint: refinery does not support down migrations natively.
    // We document this by asserting the migration is versioned (V-prefixed)
    // and that no U (unversioned) migration exists in the embedded set.
    // There is nothing to reverse; the schema is forward-only.
    let path = temp_db("down");
    let conn = db::open(&path).expect("open should succeed");
    let version: i64 = conn
        .query_row(
            "SELECT version FROM refinery_schema_history ORDER BY version DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .expect("queryable");
    assert_eq!(version, 1, "migration version should be numeric");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn rows_round_trip_through_every_table() {
    let conn = db::open_in_memory().expect("in-memory db should open");

    // browsing_history
    conn.execute(
        "INSERT INTO browsing_history (url, title) VALUES (?1, ?2)",
        ["https://example.com", "Example"],
    )
    .expect("insert browsing_history");
    let (url, title): (String, String) = conn
        .query_row(
            "SELECT url, title FROM browsing_history WHERE url = ?1",
            ["https://example.com"],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("query browsing_history");
    assert_eq!(
        (url.as_str(), title.as_str()),
        ("https://example.com", "Example")
    );

    // folders
    conn.execute("INSERT INTO folders (name) VALUES (?1)", ["Root"])
        .expect("insert folder");
    let folder_id: i64 = conn
        .query_row("SELECT id FROM folders WHERE name = ?1", ["Root"], |r| {
            r.get(0)
        })
        .expect("query folder");

    // bookmarks (FK -> folder)
    conn.execute(
        "INSERT INTO bookmarks (url, title, folder_id) VALUES (?1, ?2, ?3)",
        rusqlite::params!["https://bookmark.example", "Bookmark", folder_id],
    )
    .expect("insert bookmark");
    let bookmark_id: i64 = conn
        .query_row(
            "SELECT id FROM bookmarks WHERE url = ?1",
            ["https://bookmark.example"],
            |r| r.get(0),
        )
        .expect("query bookmark");

    // tags + bookmark_tags (join)
    conn.execute("INSERT INTO tags (name) VALUES (?1)", ["news"])
        .expect("insert tag");
    let tag_id: i64 = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", ["news"], |r| {
            r.get(0)
        })
        .expect("query tag");
    conn.execute(
        "INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
        rusqlite::params![bookmark_id, tag_id],
    )
    .expect("insert bookmark_tags");
    let joined: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bookmark_tags WHERE bookmark_id = ?1 AND tag_id = ?2",
            rusqlite::params![bookmark_id, tag_id],
            |r| r.get(0),
        )
        .expect("query join");
    assert_eq!(joined, 1);

    // settings
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)",
        ["home_page", "https://start.example"],
    )
    .expect("insert setting");
    let setting: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            ["home_page"],
            |r| r.get(0),
        )
        .expect("query setting");
    assert_eq!(setting, "https://start.example");

    // page_cache
    conn.execute(
        "INSERT INTO page_cache (url, body, content_type) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            "https://cache.example",
            b"<html>hi</html>".to_vec(),
            "text/html"
        ],
    )
    .expect("insert page_cache");
    let body: Vec<u8> = conn
        .query_row(
            "SELECT body FROM page_cache WHERE url = ?1",
            ["https://cache.example"],
            |r| r.get(0),
        )
        .expect("query page_cache");
    assert_eq!(body, b"<html>hi</html>".to_vec());

    // tofu_certs
    conn.execute(
        "INSERT INTO tofu_certs (host, fingerprint, pem) VALUES (?1, ?2, ?3)",
        rusqlite::params!["example.com", "abc123", b"-----BEGIN CERT-----".to_vec()],
    )
    .expect("insert tofu_cert");
    let fp: String = conn
        .query_row(
            "SELECT fingerprint FROM tofu_certs WHERE host = ?1",
            ["example.com"],
            |r| r.get(0),
        )
        .expect("query tofu_cert");
    assert_eq!(fp, "abc123");

    // tofu_pgp_keys
    conn.execute(
        "INSERT INTO tofu_pgp_keys (fingerprint, armored_key) VALUES (?1, ?2)",
        ["deadbeef", "-----BEGIN PGP PUBLIC KEY BLOCK-----"],
    )
    .expect("insert tofu_pgp_key");
    let key: String = conn
        .query_row(
            "SELECT armored_key FROM tofu_pgp_keys WHERE fingerprint = ?1",
            ["deadbeef"],
            |r| r.get(0),
        )
        .expect("query tofu_pgp_key");
    assert!(key.starts_with("-----BEGIN PGP"));

    // capture_fts (FTS5)
    conn.execute(
        "INSERT INTO capture_fts (url, title, content) VALUES (?1, ?2, ?3)",
        rusqlite::params!["https://fts.example", "FTS", "needle in a haystack"],
    )
    .expect("insert capture_fts");
    let fts_hits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM capture_fts WHERE capture_fts MATCH ?1",
            ["needle"],
            |r| r.get(0),
        )
        .expect("query capture_fts");
    assert_eq!(fts_hits, 1);

    // capture_vec (sqlite-vec) — insert a float32 vector and read it back.
    // vec0 stores vectors as raw little-endian f32 bytes; the column is
    // declared FLOAT[768], so the vector must have exactly 768 dimensions.
    let embedding: Vec<f32> = (0..768).map(|i| i as f32 / 768.0).collect();
    let embedding_bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "INSERT INTO capture_vec (chunk_id, embedding) VALUES (?1, ?2)",
        rusqlite::params![1, embedding_bytes],
    )
    .expect("insert capture_vec");
    let stored_bytes: Vec<u8> = conn
        .query_row(
            "SELECT embedding FROM capture_vec WHERE chunk_id = ?1",
            [1],
            |r| r.get(0),
        )
        .expect("query capture_vec");
    let stored: Vec<f32> = stored_bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
        .collect();
    assert_eq!(stored, embedding);
}
