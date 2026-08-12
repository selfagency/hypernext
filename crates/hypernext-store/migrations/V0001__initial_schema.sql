-- V0001__initial_schema.sql
-- Hypernext Phase 1 initial schema (ADR 0004: rusqlite + refinery + sqlite-vec).
-- refinery owns the `refinery_schema_history` table; we create the domain tables.

-- WAL journal mode is persistent in the database file and improves concurrent
-- read/write throughput for the app's single-process access pattern.
PRAGMA journal_mode = WAL;

-- Enforce referential integrity across all tables below.
PRAGMA foreign_keys = ON;

-- browsing_history: append-only log of every URL the user visits, used for
-- the back/forward history, "recently visited" lists, and search ranking.
CREATE TABLE browsing_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT    NOT NULL,
    title       TEXT,
    visited_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Index for chronological history queries (most recent first).
CREATE INDEX idx_browsing_history_visited_at ON browsing_history (visited_at DESC);

-- bookmarks: user-saved URLs. A bookmark may live in a folder (nullable) and
-- carry an optional description. `created_at` is ISO-8601 UTC.
CREATE TABLE bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT,
    folder_id   INTEGER REFERENCES folders (id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- folders: hierarchical bookmark folders. `parent_id` is nullable to allow
-- top-level folders; self-referential FK enforces the tree shape.
CREATE TABLE folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    parent_id   INTEGER REFERENCES folders (id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- tags: free-form labels attachable to bookmarks (many-to-many via
-- bookmark_tags). Kept separate so tag names are unique and reusable.
CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- bookmark_tags: join table linking bookmarks to tags.
CREATE TABLE bookmark_tags (
    bookmark_id INTEGER NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (bookmark_id, tag_id)
);

-- settings: simple key/value store for app preferences (e.g. home page,
-- default search engine, theme). `value` is stored as JSON text.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- page_cache: cached raw page bodies keyed by URL, used for offline reading
-- and fast re-render. `body` is the raw bytes; `content_type` and `etag`
-- support conditional revalidation.
CREATE TABLE page_cache (
    url          TEXT PRIMARY KEY,
    body         BLOB NOT NULL,
    content_type TEXT,
    etag         TEXT,
    cached_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- tofu_certs: trust-on-first-use TLS certificates. On first contact a cert is
-- pinned here; later connections must present the same fingerprint or the
-- connection is refused (TOFU, not CA-based trust).
CREATE TABLE tofu_certs (
    host        TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    pem         BLOB NOT NULL,
    first_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- tofu_pgp_keys: trust-on-first-use PGP public keys, pinned by fingerprint on
-- first contact (used for smolnet PGP-verified content).
CREATE TABLE tofu_pgp_keys (
    fingerprint TEXT PRIMARY KEY,
    armored_key TEXT NOT NULL,
    first_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- capture_fts: FTS5 virtual table over captured page text for full-text
-- search. `content` is the extracted plain text; `url` and `title` are
-- searchable metadata. External content is not used; rows are inserted here
-- directly alongside the capture.
CREATE VIRTUAL TABLE capture_fts USING fts5 (
    url,
    title,
    content,
    tokenize = 'porter unicode61'
);

-- capture_vec: sqlite-vec virtual table storing page embeddings for semantic
-- search. `embedding` is a float32 vector; `chunk_id` links to the source
-- capture row. Requires the sqlite-vec extension to be loaded at runtime.
CREATE VIRTUAL TABLE capture_vec USING vec0 (
    chunk_id  INTEGER PRIMARY KEY,
    embedding FLOAT[768]
);
