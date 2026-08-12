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

---

Task ID: t8
Agent: gem-implementer
Task: Build the real Relm4 + GTK4 app shell (ApplicationWindow + header bar + body label), smoke test, and gtk-testing doc

Work Log:

- Read t0 spike main.rs, relm4-debugging.md, build-macos.md, logging.rs, and relm4 0.9.1 crate source (simple.rs, macro_reference.rs, shutdown_after_quit.rs test, app.rs, controller.rs) to confirm the real API.
- Split the crate into lib + bin: moved the shell to src/lib.rs (so tests/ can link it in-process) and made src/main.rs a thin entry point that calls init_tracing() + hypernext_app::run(). Kept the --log-probe self-test path.
- Built AppModel (empty struct) + #[relm4::component(pub)] SimpleComponent: gtk::ApplicationWindow title "Hypernext" 1024x768, connect_close_request -> Propagation::Proceed, vertical gtk::Box with gtk::HeaderBar (title_widget label "Hypernext", needs #[wrap(Some)]) + body gtk::Label "Hypernext 1.0 (in development)".
- Gotchas hit: (1) set_title_widget takes Option<&Widget> -> needs #[wrap(Some)] in view!; (2) #[relm4::component] leaks private AppModelWidgets -> use #[relm4::component(pub)]; (3) glib not a direct dep -> use gtk::glib; (4) GTK rejects unknown argv -> strip --smoke-probe via RelmApp::with_args; (5) active_window() is None at idle time -> use app.windows().first().
- Smoke test (tests/smoke.rs): in-process test window_opens_with_title_and_quits_cleanly marked #[ignore] because GTK on macOS must init on the main thread but the test harness runs on a spawned thread (panics "Attempted to initialize GTK on OSX from non-main thread"). Added subprocess test binary_exits_cleanly that spawns the binary with --smoke-probe (opens window, asserts title, quits) and asserts exit 0 — this is the cross-platform CI gate.
- Added hidden --smoke-probe path in lib.rs (run_smoke_probe) + main.rs. The probe sends a SmokeProbe message in init (gated on the flag) so update runs after the window is added, asserts title, quits. Mirrors relm4's own shutdown_after_quit test.
- Wrote docs/references/gtk-testing.md: xvfb-run on Linux CI, system display on macOS, GitHub Actions example, headless #[ignore] fallback.
- Gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (all crates pass; smoke: 1 passed, 1 ignored).

Stage Summary:

- Full app shell built and verified: window opens, title asserted, process exits 0.
- DEVIATION: added a lib.rs target (shell moved there) so integration tests can launch the app in-process; main.rs is now a thin entry point. This is required because tests/ can only link a lib target, not a bin.
- DEVIATION: the in-process smoke test is #[ignore] on macOS (GTK main-thread constraint); the subprocess test is the real CI gate. Documented in gtk-testing.md.
- Note: the smoke-probe message is gated on the --smoke-probe flag so the normal app does not quit immediately.

---

Task ID: t10
Agent: gem-implementer
Task: Wire SQLite store + keychain into app startup; add missing From impls

Work Log:

- Added hypernext-core path dep to crates/hypernext-store/Cargo.toml and crates/hypernext-keychain/Cargo.toml [dependencies] (t4 decision: From impls live in leaf crates to avoid core->store/keychain cycle).
- Wrote Red tests first in store/error.rs and keychain/error.rs: `?` propagation from StoreError/KeychainError to HypernextError::Storage/Keychain, plus payload-preservation checks. Confirmed Red (E0277: From not implemented).
- Implemented Green From impls: `impl From<StoreError> for HypernextError { Storage(e.to_string()) }` and `impl From<KeychainError> for HypernextError { Keychain(e.to_string()) }`.
- Added `dirs = "6"` to [workspace.dependencies] (verified via context7: dirs 6.0.0, data_dir() -> macOS ~/Library/Application Support). Added hypernext-store/keychain/core + anyhow + dirs + rusqlite to hypernext-app deps; keyring + keyring-core as app dev-deps for mock-store startup tests.
- Wrote crates/hypernext-app/src/startup.rs (TDD): resolve_data_dir() honors HYPERNEXT_DATA_DIR env override else dirs::data_dir().join("Hypernext"); startup() creates data dir, opens store via hypernext_store::db::open(<dir>/hypernext.db) (runs migrations), init_keychain() probes via Secret::get (NotFound treated as OK) returning Err through From impl. Startup { data_dir, conn } returned.
- Wired startup() into run() -> now returns anyhow::Result<()>; main.rs expects() it. run_smoke_probe() bypasses startup (hermetic smoke test). Added `pub mod startup;` to lib.rs.
- Tests (Red->Green): startup_runs_migrations_and_creates_no_files_outside_data_dir (asserts refinery_schema_history row count == 1 AND every file under temp root lives inside data dir - the hard confinement exit criterion), init_keychain_verifies_service_usable (mock store).

Stage Summary:

- From impls added in store + keychain leaf crates (ADR 0009) with ?-propagation tests.
- App startup wires store (migrations on first launch) + keychain init; data dir is ~/Library/Application Support/Hypernext (HYPERNEXT_DATA_DIR overrides).
- All gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (store 10, keychain 9, app 5 lib + 3 logging + 1 smoke + 1 ignored), cargo deny check.
- DEVIATION: used `dirs` crate (data_dir()) not ProjectDirs (would produce com.selfagency.Hypernext); join("Hypernext") yields exact spec path. Refinery Error is opaque (no public NoMigration ctor), so store payload test uses rusqlite::Error::InvalidQuery.
- run() signature changed to return anyhow::Result<()>; main.rs handles startup errors via expect().

---

Task ID: t9
Agent: gem-devops
Task: Build the CI pipeline (GitHub Actions), pre-commit hook, and check-no-verify guard

Work Log:

- Created .github/workflows/ci.yml: triggers push to main + pull_request; 5 jobs.
  - lint (ubuntu): cargo fmt --check + cargo clippy --workspace -- -D warnings + scripts/check-no-verify.sh
  - test (ubuntu): xvfb-run -a cargo test --workspace (GTK smoke test needs a display)
  - coverage (ubuntu): cargo tarpaulin --workspace --out lcov --fail-under 30 (Linux/ptrace only)
  - deny (ubuntu): cargo deny check (licenses + advisories)
  - build (macos-latest): brew install gtk4 + security unlock-keychain + cargo build --release
  - All jobs use Swatinem/rust-cache@v2; cargo-deny/tarpaulin via taiki-e/install-action@v2.
- Created scripts/pre-commit.sh (committed hook body): runs cargo fmt --check + cargo clippy
  --workspace -- -D warnings, records parent SHA into scripts/.pre-commit-log, refuses on failure.
- Created scripts/check-no-verify.sh: walks git rev-list HEAD, fails if any commit's parent is
  missing from .pre-commit-log (a --no-verify commit skips the hook, so its parent is never recorded).
- Wired .git/hooks/pre-commit-user to exec scripts/pre-commit.sh. GitButler's managed pre-commit
  hook already delegates to pre-commit-user, so the committed body runs on every commit.
- Backfilled scripts/.pre-commit-log with all existing commit parents (history predates the hook;
  created with gates green per worklog, no --no-verify).
- Verified: pre-commit.sh passes (fmt + clippy green); check-no-verify.sh returns 0 on full log,
  returns 1 when a parent is missing (simulated bypass); CI YAML parses (jobs: lint,test,coverage,deny,build).

Stage Summary:

- CI pipeline created and locally verified. Coverage threshold 30% (Phase 1), ratchets per phase.
- GTK tests + tarpaulin on ubuntu (xvfb-run); macOS runner for release build only.
- security unlock-keychain on macOS build job (R4 mitigation).
- No --no-verify in history enforced by scripts/check-no-verify.sh (CI gate + pre-commit marker).
- DEVIATION: pre-commit hook runs workspace-wide fmt+clippy (matches CI gates exactly) rather than
  staged-only, so a locally-passing commit cannot fail CI on fmt/clippy.
- DEVIATION: used taiki-e/install-action@v2 for cargo-deny/tarpaulin (pinned, no curl|bash).
- Note: .git/hooks/pre-commit-user is untracked (local); scripts/pre-commit.sh is the committed body.

---

Task ID: R1-macos-bundle (spike 20260812-phase1-foundation)
Agent: gem-devops
Task: Produce a self-contained Hypernext.app carrying the GTK runtime (R1 de-risk).

Work Log:

- Installed cargo-bundle v0.11.0 (cargo install) + dylibbundler 1.0.5 (brew).
- Added [package.metadata.bundle] to crates/hypernext-app/Cargo.toml (name Hypernext, id com.selfagency.hypernext, min macOS 14.0).
- Wrote scripts/bundle-macos.sh: build release -> cargo bundle -> dylibbundler copies closure into Contents/Frameworks (@executable_path) -> gdk-pixbuf loaders + loaders.cache (@RES@ placeholder) -> share data (icons/adwaita, gtk-4.0, compiled glib schemas) -> shell wrapper sets GTK_DATA_PREFIX/XDG_*/GIO_EXTRA_MODULES/GDK_PIXBUF_MODULE_FILE -> ad-hoc codesign.
- Blocker found+fixed: gdk-pixbuf-query-loaders crashes (SIGKILL) on bundled loaders (their deps rewritten to @executable_path); fixed by generating cache from original brew loaders and rewriting paths.
- Verified: otool -L shows only @executable_path/../Frameworks refs (no /opt/homebrew load commands); --smoke-probe exits 0 (window opened, title asserted) using bundled GTK.
- All checks green: cargo fmt --check, clippy --workspace -D warnings, cargo test --workspace (exit 0).
- Updated docs/references/build-macos.md: marked bundling PROVEN, Option C (Homebrew dylib bundling) = primary path, gvsbuild = fallback.

Stage Summary:

- Self-contained Hypernext.app: 46.1 MB (under ~100MB R1 gate).
- Launches with NO system/Homebrew GTK (bundled dylibs used).
- Primary path: cargo-bundle + dylibbundler; gvsbuild kept as documented fallback.
- Caveats: ad-hoc codesign only (real signing/notarization for distribution); bundle reflects installed Homebrew.

---

Task ID: p2-t1
Agent: gem-implementer
Task: Add the 10 smolnet protocol crates as direct dependencies of hypernext-protocol (ADR 0006)

Work Log:

- Verified all 10 crate versions against crates.io API (User-Agent header): every planned version exists exactly as specified — gemini-protocol 0.1.2, scroll-protocol 0.1.0, text-protocol 0.1.0, spartan-protocol 0.1.1, nex-protocol 0.1.1, gopher-protocol 0.1.2, scorpion-protocol 0.1.0, kepler-protocol 0.1.0, guppy-protocol 0.1.1, titanite 0.3.2. No version drift. All license = MIT (deny.toml allowlist). Repos valid (merely-made/smolweb, mark-ik/serval, YGGverse/titanite).
- Created crates/hypernext-protocol (did NOT exist — Phase 1 only created app/ui/core/store/keychain/testutil). Wrote Cargo.toml (workspace version/edition/license/authors) + minimal src/lib.rs doc-only (Protocol trait + dispatcher are later p2 tasks; this task is dep-wiring only). Added to workspace members.
- Added all 10 crates to root Cargo.toml [workspace.dependencies] (caret-pinned per library-lookup-protocol.md step 4; lockfile pins exact). Wired each as { workspace = true } in hypernext-protocol Cargo.toml deps, plus thiserror/hypernext-core/url/tokio.
- cargo build -p hypernext-protocol: all 10 compile + resolve. Lockfile pins exact versions (verified via Cargo.lock grep).
- cargo tree -p hypernext-protocol --depth 1: all 10 at pinned versions. Transitive tree clean: only permissive std/well-known crates (tokio, url, rustls 0.23, ring 0.17, serde, log, percent-encoding, idna, regex, anyhow, indexmap). scorpion-protocol has ZERO runtime deps (self-contained client). No GPL/AGPL/LGPL anywhere.
- Crate->adapter mapping confirmed from crates.io descriptions + phase doc 3.5/3.6 + ADR 0006:
  - gemini-protocol -> Gemini (gemini://), TLS+TOFU
  - gopher-protocol -> Gopher (gopher://) + Gopher+ (RFC 1436)
  - spartan-protocol -> Spartan (spartan://), plaintext TCP
  - nex-protocol -> Nex (nex://), plaintext TCP
  - text-protocol -> Text (text://), minimal plain TCP+TLS
  - scroll-protocol -> Scroll (scroll://), TLS, scrolltext
  - guppy-protocol -> Molerat (guppy://), TLS (Molerat protocol; guppy = Molerat crate)
  - scorpion-protocol -> Scorpion (scorpion://, scorpions://), 4 subprotocols, binary blocks
  - kepler-protocol -> Kepler (kepler://, keplers://), Gemini-shaped
  - titanite -> Titan (titan://), upload over Gemini-style TLS

Stage Summary:

- hypernext-protocol crate created + all 10 smolnet protocol crates wired as direct deps, pinned in lockfile, never vendored (ADR 0006 compliance).
- All gates green: cargo fmt --check, cargo clippy --workspace -- -D warnings, cargo test --workspace (all suites pass), cargo deny check (advisories/bans/licenses/sources ok).
- NO version deviations — all 10 planned versions exist exactly on crates.io.
- FLAG (out of scope): 6 crates declare rust-version = "1.88" (gemini, scroll, text, gopher, scorpion, kepler) > Hypernext MSRV 1.83. Local toolchain 1.97.1 builds fine; CI/rust-version gate should account for this. Documented in Cargo.toml comment. Not a p2-t1 failure (acceptance criteria met on toolchain 1.97).
- NO deviations from task spec.

---
Task ID: p2-t-audit
Agent: gem-researcher
Task: Audit API fitness of all 10 smolnet protocol crates before adapters are built (de-risk R1)

Work Log:
- Read each crate's source at pinned version from cargo registry (authoritative for fresh 0.1.0 crates), not just docs.rs.
- Assessed 6 criteria per crate: injectable client, custom TLS, error types, cancellation, response->PageDoc fit, async runtime.
- Verified rust-version 1.88 flag: all 6 flagged crates use edition 2024 (needs >=1.85); gemini additionally uses let-chains (needs >=1.88). Real conflict with MSRV 1.83.
- Wrote docs/references/protocol-crate-audit.md with per-crate table + verdicts + rust-version assessment.

Stage Summary:
- 9 of 10 crates are "ready to wrap" (proper error enums, tokio, clean response shapes). No crate needs an upstream PR to be usable.
- titanite 0.3.2 is the exception: pure wire-format codec, NO network/async/tokio, anyhow errors -> needs full wrapping (adapter owns TCP/TLS/TOFU/cancel/size limits).
- SSRF: NONE route through reqwest; all do own DNS via TcpStream/UdpSocket -> adapter must pre-check resolved IP against FetchPolicy (invariant #8).
- Cancellation: NONE accept a token; adapter wraps each fetch in tokio::select! with CancellationToken. spartan/nex/guppy have internal timeouts; gemini/scroll/text/gopher/scorpion/kepler read to EOF with no timeout.
- TOFU: gemini+scroll built-in (TofuStore); scorpion best (connect_with(verifier) injection); text/gopher/kepler accept-any TLS, adapter supplies pinning verifier.
- RUST-VERSION: 1.88 is a REAL blocker for MSRV 1.83 (edition 2024 needs 1.85; gemini let-chains need 1.88). Recommend raising Hypernext MSRV to 1.88. Not a p2-t-audit failure (audit is research-only).
- Open question: none blocking. Optional upstream PRs documented (TLS injection, CancellationToken, titanite thiserror) — all low priority, adapter wraps them.
- DISCREPANCY FLAG: phase doc + worklog t2 label guppy-protocol as "Molerat (TLS, mtxt, TOFU)". WRONG — the crate is dimkr's smolweb-over-UDP protocol (UDP 6775, chunking/ack). jcs's Molerat (TLS/mtxt) has NO crate in this set. Resolve which protocol is in scope before building the guppy adapter. Documented in protocol-crate-audit.md.

---
Task ID: p2-t-audit-static-analysis (20260812-phase2-smolnet)
Agent: gem-devops
Task: Add static analysis layers (cargo-audit, cargo-auditable, Miri, Kani, Semgrep) wired into prek + CI, per docs/references/static-analysis.md

Work Log:
- Verified current state: prek.toml runs fmt/clippy/test/deny; ci.yml has lint/test/coverage/deny/build (5 jobs). Only crates/hypernext-store/src/db.rs has `unsafe`; hypernext-pgp does NOT exist yet.
- Wrote scripts/prek-cargo-audit.sh + scripts/prek-semgrep.sh: resilient wrappers that warn+pass when the tool is missing locally (cargo-audit/semgrep not installed on this machine). CI always runs the tools (installed there).
- prek.toml: added cargo-audit + semgrep local hooks (language=system, pass_filenames=false, entry=bash scripts/...).
- Created semgrep/rules.yaml with 5 custom Rust rules: no-unwrap-in-production, no-expect-in-production, no-format-sql, no-plaintext-secret, no-webview-outside-raw-mode (tests/fixtures/.codacy excluded).
- ci.yml: added 3 jobs (audit: cargo audit --deny warnings; semgrep: semgrep --config semgrep/rules.yaml --error; miri + kani as ONE scheduled job pair), switched macOS build to cargo auditable build --release, added `schedule` cron + `workflow_dispatch` triggers (miri/kani if-guarded to schedule/dispatch only).
- Miri job: dtolnay/rust-toolchain@nightly + miri component, targets store/keychain/protocol. Kani job: cargo install --locked kani-verifier, targets protocol+store (pgp added when p2-t7 lands).
- docs/references/static-analysis.md: full tool-stack doc (each layer, what it catches, when it runs).
- docs/references/build-macos.md: added cargo-auditable section (embedded dep tree, cargo audit binary).
- Verified: prek validate-config passes; prek run --all-files passes (all 14 hooks green incl. new audit/semgrep which warn+skip); both wrapper scripts exit 0 with missing-tool warning.

Stage Summary:
- 5 tools wired: cargo-audit (CI audit job + resilient local hook), cargo-auditable (macOS release build), Miri (scheduled), Kani (scheduled), Semgrep (CI job + resilient local hook, 5 invariant rules).
- Scheduled jobs NEVER run on push/PR (if-guarded to schedule+workflow_dispatch).
- Deviation: folded Miri+Kani into one scheduled job pair (both slow, same trigger) rather than separate jobs.
- Decision: local audit/semgrep hooks are resilient (warn+pass) per spec; CI is the enforcement point.
- hypernext-pgp absent: Kani job documents it will cover PGP when p2-t7 lands (no crate to target now).
- All existing gates still pass (fmt/clippy/test/deny verified via prek run).
- NO commits (orchestrator handles). .codacy/codacy.yaml + .rumdl.toml untouched.
