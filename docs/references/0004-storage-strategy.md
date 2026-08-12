# ADR 0004 — Storage Strategy: rusqlite + sqlite-vec + refinery

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** Bean's `modernc.org/sqlite` + manual migrations
- **Related:** `0003-authority-model.md`, `docs/phases/01-foundation-and-architecture.md` §2.3

## Context

Hypernext needs persistent storage for:
- Browsing history (with FTS5 full-text search)
- Bookmarks / collections / folders / tags
- Page cache (with TTL/size policy)
- Settings (key-value)
- TOFU cert pins (Gemini, Molerat, etc.)
- TOFU PGP key pins (per-host)
- Saved-link read state
- Future: capture_fts (vector + FTS5 for semantic search), sync state, captures, etc.

Requirements:
- Embedded (no server)
- Cross-platform (macOS, Linux, Windows)
- FTS5 for full-text search (history, bookmarks)
- Vector search for future semantic search (Phase 1.5+)
- Migrations with version tracking
- WAL mode for concurrent reads during writes
- Foreign keys ON

## Decision

**Use `rusqlite` (v0.40, with `bundled` + `modernsqlite` features) for SQLite access, `refinery` (v0.9) for migrations, and `sqlite-vec` (v0.1) for vector search.**

### Why rusqlite over sqlx

- **`rusqlite`** is a synchronous, ergonomic wrapper over SQLite3. Mature (91M downloads), maintained, no async complexity. Best fit for Hypernext because SQLite operations are fast enough that async overhead doesn't help.
- **`sqlx`** is async, with compile-time query checking. Attractive for type safety, but introduces async complexity throughout the storage layer. Compile-time checking requires a live database during `cargo build`, which complicates CI.
- **`diesel`** is a full ORM with DSL. Too heavy for our needs; we want SQL not a DSL.

`rusqlite` with `bundled` feature ships its own SQLite (no system dependency). `modernsqlite` enables FTS5 + JSON1 + the modern feature set. This gives us a single `cargo build` with no system SQLite version surprises.

### Why refinery over sqlx migrations

- **`refinery`** is migration-agnostic — works with any SQLite driver. We use it with rusqlite.
- **`sqlx` migrations** are tied to sqlx queries; we'd be locked into sqlx.
- **`barrel`** is migration-as-code (Rust DSL). Attractive but adds a layer of indirection.

`refinery` embeds migrations at compile time via `embed_migrations!()` macro. Migrations are SQL files in `migrations/V<n>__<name>.sql` format. Version tracking is automatic via `schema_migrations` table.

### Why sqlite-vec

- **`sqlite-vec`** (v0.1.9) is the Rust binding to the sqlite-vec loadable extension, which adds a `vec_distance` SQL function and a virtual table type for vector storage.
- Required for future semantic search (Phase 1.5 capture_fts/capture_vec; Phase 1.1 feed embedding).
- Alternative: `tantivy` (v0.26.1) is a full-text search engine. Heavier than FTS5, doesn't integrate with SQLite. Reject for 1.0.
- Alternative: `instant-distance` (v0.6.1) is HNSW for nearest-neighbor search. Stale (June 2023). Reject.

`sqlite-vec` loads as a SQLite extension at runtime; one-line setup in `Store::open()`.

## Consequences

**Positive**

- Single storage stack: rusqlite + refinery + sqlite-vec, all mature
- `bundled` SQLite eliminates system version issues
- FTS5 + sqlite-vec cover both text and vector search in one database
- WAL mode enables concurrent reads during writes (important for the protocol dispatcher writing while the UI reads)
- No async pollution — storage layer is sync, called from async via `tokio::task::spawn_blocking` for potentially-slow operations

**Negative / accepted costs**

- `spawn_blocking` is required for long-running SQLite operations to avoid blocking the tokio runtime. Documented in `hypernext-store::Store::spawn_query`.
- Migrations are forward-only (refinery doesn't support down migrations). Document as a known constraint.
- sqlite-vec requires loading at runtime; if loading fails (e.g., extension binary missing), the store must fail gracefully. Documented in `Store::open()` error handling.

**Non-conformance is a release blocker.** Any change that introduces a second database (e.g., a separate SQLite for incognito) must reuse the same rusqlite + refinery + sqlite-vec stack, just with a different file path (or `:memory:` for incognito).

## Database schema overview

Full schema is in `crates/hypernext-store/migrations/V0001__initial_schema.sql`. Summary:

| Table | Purpose |
|---|---|
| `browsing_history` | Visited URLs with timestamps, extracted full text |
| `bookmarks` | Saved links (unified pin/bookmark model) |
| `folders` | Bookmark folders (nested via `parent_id`) |
| `tags` | Tag definitions |
| `bookmark_tags` | Many-to-many bookmark ↔ tag |
| `settings` | Key-value settings (JSON values) |
| `page_cache` | Cached page responses (URL, body, headers, expires_at) |
| `tofu_certs` | TLS cert pins per host |
| `tofu_pgp_keys` | PGP key pins per host |
| `capture_fts` (FTS5 virtual) | Full-text index over browsing_history and bookmarks |
| `capture_vec` (sqlite-vec virtual) | Vector index for future semantic search (unused in 1.0; schema reserved) |

## References

- rusqlite: https://docs.rs/rusqlite/latest/rusqlite/
- rusqlite features (`bundled`, `modernsqlite`): https://crates.io/crates/rusqlite
- refinery: https://docs.rs/refinery/latest/refinery/
- sqlite-vec: https://crates.io/crates/sqlite-vec
- SQLite FTS5: https://www.sqlite.org/fts5.html
- SQLite WAL mode: https://www.sqlite.org/wal.html
- The original Bean's `internal/store/db.go` (consult upstream; schema is similar)
