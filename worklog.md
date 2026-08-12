---
Task ID: t0
Agent: gem-implementer
Task: Phase 1 spike — prove a minimal Relm4 + GTK4 window opens on macOS and document the gvsbuild bundling path (de-risk R6, R1)

Work Log:
- Verified crate versions on crates.io: relm4 0.9.1 (MSRV 1.75, Apache-2.0/MIT), gtk4 0.9.7 (MSRV 1.70, MIT). Pinned `relm4 = "0.9"` + `gtk4 = "0.9"` in workspace [workspace.dependencies] and wired into hypernext-app.
- Read relm4 0.9.1 example `simple.rs` from crate source (not training data) to confirm the real API: `#[relm4::component] impl SimpleComponent`, `view!`, `view_output!()`, `ComponentParts`. Phase doc's "AppWidgets struct" is shorthand, not literal — documented in relm4-debugging.md.
- Wrote crates/hypernext-app/src/main.rs: RelmApp::new("com.selfagency.hypernext"), AppModel empty struct, gtk::ApplicationWindow title "Hypernext" 1024x768, connect_close_request -> exit cleanly.
- Build blocker hit & resolved: `close-request` handler returns `glib::Propagation` (NOT `gtk::Inhibit` — doesn't exist in gtk4 0.9.7). Fixed to `gtk::glib::Propagation::Proceed`.
- First build failed at gdk4-sys: `pkg-config` couldn't find gtk4 (R1). Installed Homebrew gtk4 4.22.4; cargo check then passed.
- Verified window opens: process runs GTK main loop (stayed alive >5s on XQuartz display), no stderr errors. screencapture blocked by XQuartz capture permission (env, not app).
- Gates green: cargo fmt --check, cargo clippy -p hypernext-app -- -D warnings, cargo test (1 passed).
- Wrote docs/references/build-macos.md (Homebrew dev path proven + gvsbuild bundling recipe documented, not yet run end-to-end) and docs/references/relm4-debugging.md (gotchas).

Stage Summary:
- R6 de-risked: minimal Relm4+GTK4 window compiles and runs on macOS against real crate API.
- R1 status: dev path proven via Homebrew GTK4; gvsbuild bundling path documented with exact setup, NOT yet exercised end-to-end (hours-long GTK-from-source build deferred to t8). Bundle size not measured — open gate in t8.
- Key gotchas: (1) GTK4 system lib required or build fails at gdk4-sys; (2) close-request returns glib::Propagation not gtk::Inhibit; (3) gtk4 re-exports glib as gtk::glib.

---
Task ID: t2
Agent: gem-implementer
Task: Pin Phase-1 workspace dependencies in root Cargo.toml [workspace.dependencies]

Work Log:
- Verified every Phase-1 crate's latest version against crates.io API (User-Agent header required).
- Discovered R2 CONFLICT: refinery-core 0.9.2 caps rusqlite at ">=0.23, <=0.39". rusqlite 0.40 (phase-doc version) is incompatible -> pinned rusqlite 0.39 (latest 0.39.x) so app and refinery share ONE rusqlite Connection.
- Corrected feature name: rusqlite 0.39/0.40 use modern_sqlite (underscore), NOT modernsqlite as phase doc wrote.
- Verified sqlite-vec 0.1.9 has EMPTY [dependencies] (rusqlite is dev-only) -> no runtime double-link risk from sqlite-vec.
- Confirmed relm4 0.9.1 deps gtk4 ^0.9 and tokio ^1.38; gtk4 0.9.7 resolves. No duplicate versions in final graph.
- Installed cargo-deny 0.20.2 (was not installed). Created deny.toml (none existed) with protocol allowlist.
- cargo update --dry-run: clean (Locking 0 packages, no semver-breaking transitive updates).
- cargo deny check: advisories ok, bans ok, licenses ok, sources ok.

Stage Summary:
- Final pins: tokio 1.53, rusqlite 0.39 (bundled+modern_sqlite), refinery 0.9 (rusqlite), sqlite-vec 0.1, relm4 0.9, gtk4 0.9, keyring 4, serde 1, serde_json 1, chrono 0.4, uuid 1.24, anyhow 1, thiserror 2, tracing 0.1, tracing-subscriber 0.3 (env-filter,json), pretty_assertions 1, rstest 0.26, mockall 0.15, wiremock 0.6.
- DEVIATIONS from phase doc: (1) rusqlite 0.40 -> 0.39 (refinery-core cap <=0.39); (2) feature modernsqlite -> modern_sqlite; (3) rstest 0.23 -> 0.26, mockall 0.13 -> 0.15 (latest stable); (4) deny.toml created (allowlist + Zlib via nanorand->flume->relm4, Apache-2.0 WITH LLVM-exception via target-lexicon/wasi).
- R2 DE-RISKED: single rusqlite 0.39.0 shared by app and refinery; sqlite-vec links no runtime rusqlite. No sqlx fallback needed.

---
Task ID: t4
Agent: gem-implementer
Task: Error types (HypernextError enum, stable codes) per ADR 0009

Work Log:
- Wrote crates/hypernext-core/src/error.rs TDD-first: tests first (Red), then impl (Green).
- Defined HypernextError enum (thiserror 2) with 10 variants: Protocol, Storage, Keychain, Network, Pgp, Cancelled, InvalidUrl, SizeLimitExceeded, SsrfBlocked, Unauthorized.
- Each variant carries a stable string code via code() method + Display prefix (ADR 0009): PROTOCOL_ERROR, STORAGE_ERROR, KEYCHAIN_ERROR, NETWORK_ERROR, PGP_ERROR, CANCELLED, INVALID_URL, SIZE_LIMIT_EXCEEDED, SSRF_BLOCKED, UNAUTHORIZED.
- Implemented FromStr for round-trip (parses Display back to variant; payload not preserved, code-only). ParseError enum for unknown codes.
- Implemented From<rusqlite::Error> for HypernextError -> Storage (satisfies `?` propagation acceptance criterion without map_err).
- Added thiserror + rusqlite to hypernext-core Cargo.toml (workspace deps). rusqlite dep is only for the From impl; no cycle (store/keychain depend on core, not vice versa).
- Wired pub mod error + re-exports into lib.rs.
- 5 unit tests: stable codes, Display prefix, Display+FromStr round-trip, unknown-code parse failure, `?` from rusqlite, `?` from crate error via From.

Stage Summary:
- cargo test -p hypernext-core: 10 passed (5 mine + 5 from parallel t3 types.rs). fmt --check clean. clippy -p hypernext-core -- -D warnings clean.
- DECISION: HypernextError variants wrap simple payloads (String/usize), NOT crate-specific error types. Crate errors (StoreError, KeychainError) + their From impls live in their own crates (t6/t7) to avoid a core->store/keychain dependency cycle. This matches ADR 0009's "each crate defines its own error, implements From<TheirError> for HypernextError".
- NOTE: cargo test --workspace and clippy --workspace currently FAIL in crates/hypernext-store/src/db.rs (untracked, parallel t6 work): references non-existent rusqlite::libsqlite3_sys. Not my file/task; my changes are isolated to hypernext-core and green.

---
Task ID: t3
Agent: gem-implementer
Task: Define the domain model in hypernext-core (PageDoc, Metadata, Block, Span, PgpInfo, DebugInfo)

Work Log:
- Verified `url` crate on crates.io: 2.5.8, updated 2026-01, 792M downloads, servo/rust-url, MIT/Apache-2.0. Added `url = { version = "2.5", features = ["serde"] }` to workspace [workspace.dependencies] and wired into hypernext-core Cargo.toml.
- TDD: wrote tests FIRST in crates/hypernext-core/src/types.rs::tests (5 tests), then implemented types to pass.
- Defined in types.rs: PageDoc, Metadata, Block (enum), Span, SpanRun, SpanStyle, PgpInfo, PgpStatus (enum), PgpKeySource (enum), DebugInfo, HttpRequestDebug, HttpResponseDebug, TimingDebug, RedirectHop, TlsDebug. All derive Serialize, Deserialize, Debug, Clone, PartialEq (where sensible). PgpStatus + PgpKeySource have Display impls.
- PgpStatus::Display matches Bean v1 shield UI strings exactly: valid, valid-untrusted, invalid, missing, unsupported, unverified, key-changed.
- lib.rs re-exports all types; preserved concurrent agent's `error` module (error.rs) alongside.
- Gates: cargo fmt --check clean, cargo clippy -p hypernext-core -- -D warnings clean, cargo test -p hypernext-core = 10 passed (5 mine + 5 concurrent error.rs tests).

Stage Summary:
- Domain model defined and tested. 5 acceptance-criteria tests pass: PageDoc round-trip, Block::Image+caption round-trip, Span mixed-styles serialize, all enums Display, PgpStatus shield strings.
- DEVIATION: `url` needed `features = ["serde"]` for Url to derive Serialize/Deserialize (compile error otherwise).
- CONCURRENCY NOTE: another agent's in-flight work (untracked crates/hypernext-app/tests/logging_integration.rs) fails workspace `cargo test` with `CARGO_BIN_EXE_hypernext_app` not defined. Pre-existing, unrelated to t3. Also concurrent edits to core Cargo.toml (thiserror/rusqlite) and lib.rs (error module) were preserved.

---
Task ID: t6
Agent: gem-implementer
Task: Build the SQLite store with migrations for Hypernext (ADR 0004 persistence layer)

Work Log:
- Wired hypernext-store Cargo.toml to workspace deps (rusqlite 0.39 bundled+modern_sqlite, refinery 0.9 rusqlite, sqlite-vec 0.1, serde, serde_json, chrono, thiserror, tracing).
- Wrote migrations/V0001__initial_schema.sql: PRAGMA journal_mode=WAL + foreign_keys=ON; tables browsing_history, bookmarks, folders, tags, bookmark_tags, settings, page_cache, tofu_certs, tofu_pgp_keys, capture_fts (FTS5), capture_vec (vec0 FLOAT[768]). Each with purpose comment; indexes on browsing_history.visited_at.
- Wrote src/error.rs: StoreError enum (thiserror) with Sqlite, Migration, SqliteVec(String), NotFound, InvalidInput.
- Wrote src/db.rs: open(path), open_in_memory(); refinery::embed_migrations!("migrations"); register_vec_auto_extension() BEFORE opening conn (auto_extension only affects conns opened after registration); verify_vec() checks vec_version() non-null.
- Wrote unit tests (7) + integration tests/migrations.rs (3).
- Fixed: WAL unsupported on in-memory DB -> wal test uses temp file. vec0 requires exact 768-dim vector -> test builds 768 floats. refinery_schema_history.version is INTEGER not TEXT. sqlite-vec stores vectors as raw LE f32 bytes -> manual encode/decode in test.
- Clippy: transmute needs explicit type annotations (missing_transmute_annotations) -> used rusqlite::ffi::* types (ffi IS libsqlite3_sys reexport).

Stage Summary:
- All gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (13 suites ok, 0 failures), cargo deny check (advisories/bans/licenses/sources ok).
- Store tests: 7 unit + 3 integration pass.
- Key decisions: sqlite-vec registered as auto-extension before connection open (required for vec0 module during migration); WAL/foreign_keys set via pragma_update in configure(); down-migration documented as unsupported (refinery forward-only) and asserted in test.

---
Task ID: t7
Agent: gem-implementer
Task: Build OS keychain integration (hypernext-keychain crate) per ADR 0007

Work Log:
- Added keyring = { workspace = true } + thiserror = { workspace = true } to crates/hypernext-keychain/Cargo.toml; added keyring-core = "1" as dev-dependency for the mock store.
- Wrote crates/hypernext-keychain/src/error.rs: KeychainError enum (Keyring(#[from] keyring::Error), NotFound, InvalidInput) via thiserror (ADR 0009).
- Wrote crates/hypernext-keychain/src/lib.rs: Secret { service: &'static str, account: String }, Secret::new(feature, id) -> <feature>.<id> account, SERVICE = "com.selfagency.hypernext", and set/get/delete/exists. get maps keyring::Error::NoEntry -> NotFound; delete treats NoEntry as no-op.
- TDD: wrote 7 tests first (set/get round-trip, get missing -> NotFound, delete missing no-op, exists false after delete, set overwrites, empty account invalid, account namespace). Tests use keyring's in-memory mock store via keyring_core::set_default_store(mock::Store::new()) after triggering keyring's one-time v1 store init (Entry::store_status()), guarded by std::sync::Once.
- Fixed two Red failures: Secret needed #[derive(Debug)] for test panic formatting; Secret::new("","") produced account "." so validation moved to feature.is_empty() || id.is_empty().
- Wrote docs/references/keychain-testing.md: mock-store test strategy (hermetic, no real keychain), macOS first-run permission prompt handling (security unlock-keychain, cache authorization), CI recommendation.
- Gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (7 keychain tests + all others), cargo deny check (advisories/bans/licenses/sources ok).

Stage Summary:
- hypernext-keychain crate complete: Secret type + set/get/delete/exists with ADR 0007 service/account conventions, thiserror error enum, 7 passing unit tests against in-memory mock store (no real keychain, no permission prompt).
- Key decision: tests use keyring_core mock store (not the real macOS keychain) so they are hermetic and CI-safe; real-keychain smoke testing documented separately in keychain-testing.md.
- No deviations from task spec. No flaky tests to ignore.

---
Task ID: t5
Agent: gem-implementer
Task: Logging / tracing infrastructure (subscriber, redaction, policy doc)

Work Log:
- Added `tracing` + `tracing-subscriber` (workspace pins from t2) to `crates/hypernext-app/Cargo.toml` [dependencies].
- TDD-first (Red): wrote unit tests in new `src/logging.rs` and integration tests in new `tests/logging_integration.rs` BEFORE the impl.
- Implemented `src/logging.rs`:
  - `Redacted<T>` wrapper whose Display impl always renders `<redacted>` (used via `tracing::field::display(Redacted(secret))`).
  - `env_filter()` reads RUST_LOG via EnvFilter::try_from_default_env, default `info`.
  - `init_tracing()`: writes to stderr; structured JSON when HYPERNEXT_LOG_FORMAT=json. Kept as one separable function so t8 calls it without conflict.
  - `log_probe()`: hidden self-test emitting one line per level + a redacted-secret demo.
- Wired `main.rs`: call `logging::init_tracing()` at startup; short-circuit on `--log-probe` before entering GTK main loop (integration test hooks).
- Wrote `docs/references/logging-policy.md`: framework, runtime config (RUST_LOG/HYPERNEXT_LOG_FORMAT), level semantics, and MANDATORY no-secrets rules with Redacted usage.
- Fixed integration-test env var: cargo exposes `CARGO_BIN_EXE_hypernext-app` (hyphen, bin name) not underscore; must read at runtime, not env!().

Stage Summary:
- 4 unit tests + 3 integration tests all pass; redaction renders `<redacted>` and the secret value never appears in stderr.
- Gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (all crates pass), cargo deny check (advisories/bans/licenses/sources ok).
- DEVIATION: none functional. Debug enables DEBUG but NOT TRACE (correct per level semantics); test asserts that.
- Note: `--log-probe` is a dev/test-only path in main; t8 shell replaces the GTK entry while init_tracing() stays callable.
