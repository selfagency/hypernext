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
