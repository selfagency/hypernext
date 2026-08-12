# Phase 5 — Release 1.0 Gate

> Phase 5 of the Hypernext 1.0 Hypertext release.
> Prerequisites: Phase 4 complete (browser shell, persistence, IndieAuth).
> Estimated duration: 3 weeks (single maintainer, AI-assisted)
> TDD requirement: Yes — this phase IS the TDD gate. Every acceptance criterion from the PRD has at least one E2E test.

---

## 1. Goal

Ship Hypernext 1.0 Hypertext. This phase adds no new features — it's the release gate. Work includes: end-to-end journey tests for every user-visible flow, macOS packaging and code signing, URI scheme handlers, performance/correctness hardening, the release checklist, and the actual release tag.

When Phase 5 ships, Hypernext 1.0 is installable on macOS, opens via `hypernext://` URIs, and passes every acceptance criterion in the PRD.

---

## 2. Sub-tasks

### 2.1 E2E journey test suites (Week 1-2)

End-to-end tests drive the running Hypernext app via Playwright. Each journey is a script that launches the app, performs a user action, and asserts both visible state and backend side-effects (DB rows, keychain entries).

**References to consult:**

- Playwright docs: https://playwright.dev/docs/intro
- Playwright + Rust desktop apps: https://github.com/tauri-apps/tauri-plugin-deep-link (reference for app launching patterns)
- Tauri's WebDriver approach: https://v2.tauri.app/develop/tests/ (reference for desktop E2E patterns)
- Original Bean's `frontend/src/test/integration/` and `e2e/coverage-plan.md` (consult upstream)

**Journey list for 1.0:**

| # | Journey | Asserted visible state | Asserted backend state |
|---|---|---|---|
| 1 | App launch with blank tab | Window opens, "Hypernext" title, location bar focused | `browsing_history` has 0 rows |
| 2 | Navigate to `gemini://geminiprotocol.net/` | Page renders with gemtext blocks | `browsing_history` has 1 row; `tofu_certs` has 1 row |
| 3 | Navigate to `gopher://gopher.floodgap.com/` | Menu renders as list of links | `browsing_history` 1 row |
| 4 | Navigate to `finger://user@example.com` | Plan section renders preformatted | `browsing_history` 1 row |
| 5 | Navigate to `https://example.com` (reader mode) | Extracted article renders, no ads | `browsing_history` 1 row |
| 6 | Toggle raw mode for `https://example.com` | Webview widget loads, full JS | `settings` has `webmode.https://example.com = Raw` |
| 7 | Visit PGP-signed page | Shield shows "valid" | `tofu_pgp_keys` has 1 row |
| 8 | Visit PGP-tampered page | Shield shows "invalid", page renders anyway (no exec) | No new keychain entries |
| 9 | ⌘T opens new tab, types URL, Enter | New tab loads | `browsing_history` +1 |
| 10 | ⌘W closes tab | Tab removed | No DB change |
| 11 | ⌘B bookmarks current page | Dialog opens, save | `bookmarks` +1 row |
| 12 | Open bookmark from sidebar | Tab loads bookmark URL | `browsing_history` +1 |
| 13 | Search history with ⇧⌘F | History view filters | n/a |
| 14 | Titan upload (fixture server) | Confirmation dialog → upload progress → success | `browsing_history` no entry (uploads don't navigate) |
| 15 | IndieAuth login against mock IdP | Token stored | Keychain has `indieauth.<url>` entry |
| 16 | WebFinger lookup `@user@example.com` | Completions appear | n/a |
| 17 | Open incognito window | Incognito badge visible | In-memory DB used; main DB unchanged |
| 18 | Visit URL in incognito | Page renders | Main `browsing_history` 0 rows |
| 19 | Settings: change reading font | Setting applies live | `settings` row updated |
| 20 | Find-in-page ⌘F | Find bar opens, matches highlight | n/a |

**Implementation:**

- [ ] `e2e/` directory at repo root, separate package
- [ ] Each journey in its own file: `e2e/journeys/01-app-launch.spec.ts`, etc.
- [ ] Helper: `e2e/helpers/launch.ts` — launches the bundled app via `child_process.spawn`, returns a Playwright `Browser` connected via CDP
- [ ] Helper: `e2e/helpers/db.ts` — reads the SQLite DB to assert side-effects
- [ ] Helper: `e2e/helpers/keychain.ts` — reads the macOS keychain via `security find-generic-password` to assert secret presence (without revealing values)
- [ ] Mock servers: `e2e/mocks/gemini-server.ts`, `gopher-server.ts`, `http-server.ts`, `finger-server.ts`, `titan-server.ts`, `indieauth-idp.ts`
- [ ] Test runner: `package.json` script `test:e2e` runs all journeys; `test:e2e --grep "<name>"` runs a single journey

**TDD gate:**

- All 20 journeys pass against the bundled macOS app
- `e2e/README.md` documents how to run them locally
- CI runs E2E on every release tag (not every PR — too slow)

### 2.2 macOS packaging (Week 2)

**References to consult:**

- cargo-bundle: https://crates.io/crates/cargo-bundle
- gtk4 macOS bundling: https://github.com/wingtk/gvsbuild (Windows) — for macOS, see below
- gtk4-rs macOS deployment: https://gtk-rs.org/gtk4-rs/stable/latest/book/installation_macos.html
- Apple code signing: https://developer.apple.com/developer-id/
- Apple notarization: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution

**Implementation:**

- [ ] `scripts/build-macos.sh`:
  1. `cargo build --release --target aarch64-apple-darwin`
  2. `cargo bundle --target aarch64-apple-darwin` — produces `Hypernext.app`
  3. Bundle GTK4 runtime into the .app's `Frameworks/` directory (via `dylibbundler` or `gtk-mac-bundler`)
  4. Sign with Developer ID: `codesign --deep --force --options runtime --sign "Developer ID Application: Selfagency" Hypernext.app`
  5. Notarize: `xcrun notarytool submit Hypernext.app.zip --apple-id ... --team-id ... --wait`
  6. Staple: `xcrun stapler staple Hypernext.app`
- [ ] Universal binary: build for both `aarch64-apple-darwin` and `x86_64-apple-darwin`, combine with `lipo`
- [ ] Bundle size target: <60MB (GTK runtime is ~30MB, app is ~5-10MB)
- [ ] Bundle identifier: `com.selfagency.hypernext`

**TDD gate:**

- `scripts/build-macos.sh` produces a notarized `Hypernext.app` that launches on a clean macOS 14+ machine
- Code signature verified: `codesign --verify --verbose Hypernext.app` passes
- Notarization ticket stapled: `spctl -a -vv Hypernext.app` passes

### 2.3 URI scheme handlers (Week 2)

**References to consult:**

- Apple URL schemes: https://developer.apple.com/documentation/uniformtypeidentifierresources/uttype/identifier#3585343
- macOS CFBundleURLTypes: https://developer.apple.com/documentation/bundleresources/information_property_list/cfbundleurltypes
- The original Bean's `scripts/check-uri-handlers.sh` and `build/darwin/Info.plist` (consult upstream)

**Implementation:**

- [ ] Register URI schemes in `Info.plist`:
  - `hypernext` (internal: open tab)
  - `gemini`, `titan` (Gemini family)
  - `gopher` (Gopher)
  - `finger` (Finger)
  - `spartan` (Spartan)
  - `nex` (Nex)
  - `text` (Text)
  - `scroll` (Scroll)
  - `molerat`, `scorpions` (TLS variants)
  - `scorpion` (Scorpion)
  - `kepler` (Kepler)
  - `feed`, `rss`, `atom` (feed hints — strip and treat as HTTP)
- [ ] On launch, if app was opened via a URI, navigate the active tab to that URL
- [ ] If app is already running, the new URI opens in a new tab in the existing instance (single-instance enforcement via `gtk::Application::hold` + URL signal)
- [ ] `scripts/check-uri-handlers.sh` — verifies the plist registration (per the Wails version's hard-won lesson: the script must NOT claim to test packaged-app launch; it only checks plist entries)

**TDD gate:**

- `defaults read com.selfagency.hypernext CFBundleURLTypes` lists all 13 schemes
- `scripts/check-uri-handlers.sh` passes
- `open gemini://geminiprotocol.net/` from the macOS terminal opens Hypernext and navigates
- `open hypernext://new-tab` opens a new tab in the running instance

### 2.4 Performance and correctness hardening (Week 2-3)

**Action items:**

- [ ] **Cold start target:** <2 seconds from app launch to interactive window (measured via `time open -a Hypernext`)
- [ ] **Memory target:** <150MB RSS idle (measured via `Activity Monitor` after 1 minute idle)
- [ ] **Binary target:** <60MB
- [ ] **Race detector:** `cargo test --workspace --features race-test` with `tokio`'s race-detection instrumentation (or `loom` for concurrency tests)
- [ ] **Stress test:** open 50 tabs, switch between them, verify no panics; documented in `tests/stress.rs`
- [ ] **30-minute smoke test:** `tests/smoke_30min.rs` — opens app, navigates every 30 seconds, asserts no panics, no memory growth >50MB

**TDD gate:**

- Performance benchmarks (`criterion` crate): cold start < 2s, idle memory < 150MB
- Stress test passes
- 30-minute smoke test passes

### 2.5 Documentation finalization (Week 3)

**Action items:**

- [ ] `README.md` at repo root: what Hypernext is, how to build, how to contribute
- [ ] `CONTRIBUTING.md`: setup, code style, test conventions, AI-agent guidelines
- [ ] `SECURITY.md`: how to report vulnerabilities, security model summary
- [ ] `docs/references/release-checklist.md` — manual checklist for tagging a release
- [ ] `docs/references/library-lookup-protocol.md` — guide for AI agents on how to verify a crate before depending on it (see §3 below)
- [ ] User-facing docs: `docs/user-guide/` with markdown files for each feature (Gemini, Gopher, IndieAuth, etc.)
- [ ] `CHANGELOG.md` for the 1.0 release
- [ ] Archive the Go/Wails Bean repo (or mark it deprecated with a pointer to Hypernext)

**TDD gate:**

- README has working build instructions (verified by a fresh clone + build)
- `docs/references/release-checklist.md` covers every gate
- All cross-references between docs are valid (run `scripts/check-doc-links.sh`)

### 2.6 Library lookup protocol (AI agent guide) (Week 3)

A critical reference for AI agents: how to verify a crate before depending on it. This is non-negotiable — silent API drift is what made the Wails version's docs unreliable.

**`docs/references/library-lookup-protocol.md` contents:**

```markdown
# Library Lookup Protocol (for AI agents)

Before adding any `use` statement for an external crate, an AI agent MUST:

## 1. Verify the crate exists and is healthy

1. Visit https://crates.io/crates/<name>
2. Check:
   - Latest version was released within the last 12 months
   - Recent downloads > 100 (signal of active use)
   - Repository link works (not 404)
   - License is compatible (MPL-2.0, MIT, Apache-2.0 are fine; GPL is not for Hypernext)
3. If the crate is stale (>18 months since last release) or abandoned:
   - Search for alternatives on https://crates.io/search?q=<topic>
   - If no alternative exists, document the risk in `worklog.md` under `## Open questions`
   - Do NOT silently depend on the abandoned crate

## 2. Read the API

1. Visit https://docs.rs/<crate>/<version>/<crate>/index.html
2. Read the module-level docs (the `//!` at the top of `lib.rs`)
3. Identify the main entry point (the type or function you'll use)
4. Read its full doc comment, including:
   - Examples (cargo test the examples if possible)
   - Panics section
   - Errors section
   - Safety section (if unsafe)

## 3. Read the CHANGELOG

1. Visit the crate's repository (linked from crates.io)
2. Read `CHANGELOG.md` for the pinned version
3. Note any breaking changes since the version above
4. If the API you plan to use is recent, verify it exists in the pinned version (not just HEAD)

## 4. Pin the version

1. Add to the workspace `Cargo.toml` `[workspace.dependencies]` block with an exact version:
   ```toml
   <crate> = "=1.2.3"  # or just "1.2" if you trust the maintainer's semver
   ```
2. Use `cargo update -p <crate> --precise 1.2.3` to lock the lockfile
3. Run `cargo tree -p <crate>` to verify no surprise transitive deps

## 5. If the API doesn't match the phase doc

1. STOP writing code.
2. Open the phase doc in your editor.
3. Update the API reference in the phase doc to match the actual API.
4. Commit the doc change separately with `docs(<phase>): correct <crate> API`.
5. Now proceed with implementation.

## 6. When in doubt

1. Don't guess.
2. Use the `web-search` skill to search for the API.
3. Use the `web-reader` skill to fetch the docs.rs page.
4. If still unclear, document the question in `worklog.md` and propose a path forward.
```

**Action item:**

- [ ] Write `docs/references/library-lookup-protocol.md` with the contents above
- [ ] Reference it from every phase doc's "AI-agent instructions" section

### 2.7 Release tag (Week 3)

**Action items:**

- [ ] Run `scripts/release-checklist.sh` — runs every check listed in `docs/references/release-checklist.md`:
  - `cargo test --workspace` green
  - `cargo clippy --workspace -- -D warnings` clean
  - `cargo fmt --check` clean
  - `cargo deny check` clean
  - `cargo tarpaulin --workspace --fail-under 80` (or whatever the final threshold is)
  - All 20 E2E journeys pass
  - `prek run --all-files` passes (ADR 0010)
  - `scripts/check-uri-handlers.sh` passes
  - `scripts/check-doc-links.sh` passes
- [ ] Bump version in `Cargo.toml` to `1.0.0`
- [ ] Update `CHANGELOG.md` with 1.0.0 entry
- [ ] Tag: `git tag -a v1.0.0 -m "Hypernext 1.0 Hypertext"`
- [ ] Push tag: `git push origin v1.0.0`
- [ ] GitHub release: build the macOS `.app` via CI, attach to the release
- [ ] Archive `selfagency/bean` (or mark deprecated with a pointer to Hypernext)

**TDD gate:**

- `scripts/release-checklist.sh` exits 0
- Tag `v1.0.0` exists
- GitHub release page has the `.app` attached
- A clean-machine install of the `.app` launches and passes manual smoke

---

## 3. Phase exit criteria (1.0 release gate)

All of these must be true to tag 1.0.0:

- [ ] All 20 E2E journeys pass against the bundled macOS app
- [ ] `cargo test --workspace` green with ≥80% overall coverage
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] `cargo fmt --check` clean
- [ ] `cargo deny check` clean (no advisories, no forbidden licenses)
- [ ] Cold start < 2 seconds
- [ ] Memory < 150MB idle
- [ ] Binary < 60MB
- [ ] 30-minute smoke test passes (no panics, no memory growth >50MB)
- [ ] 50-tab stress test passes
- [ ] macOS .app is notarized and stapled
- [ ] All 13 URI schemes register correctly (verified by `scripts/check-uri-handlers.sh`)
- [ ] All docs finalized; no broken cross-references
- [ ] `docs/references/release-checklist.md` exists and is accurate
- [ ] `docs/references/library-lookup-protocol.md` exists and is referenced from every phase doc
- [ ] No `--no-verify` in git history
- [ ] `worklog.md` complete for every Task ID from Phase 1 through 5
- [ ] Tag `v1.0.0` pushed
- [ ] GitHub release published with the `.app` artifact
- [ ] Old `selfagency/bean` repo archived or deprecated

---

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | macOS notarization fails (signing cert issue, missing entitlements) | Medium | High | Test notarization early in week 2; if it fails, reach out to Apple Developer Support or use an ad-hoc build for the initial release |
| R2 | GTK4 runtime bundling inflates binary beyond 60MB target | Medium | Medium | Document the actual size; if >80MB, consider GTK3 fallback or document the cost in the release notes |
| R3 | E2E journey for raw-mode webview (journey #6) is flaky on CI | Medium | Medium | Mark as `@slow` and run only on release tags; document the flake pattern |
| R4 | 30-minute smoke test reveals a memory leak | Medium | High | If leak is found, document and fix; if unfixable in 1.0, document as known issue in release notes |
| R5 | Apple changes notarization requirements mid-phase | Low | High | Subscribe to Apple Developer news; if changes break our flow, use the prior known-good notarization process |
| R6 | Coverage threshold of 80% is unreachable for some crates (e.g. UI crate) | Medium | Low | Per-crate thresholds: 80% for `core`/`store`/`protocol`/`http`/`pgp`; 60% for `ui` (GTK testing is harder) |

---

## 5. References

### Playwright / E2E

- Playwright: https://playwright.dev/docs/intro
- Tauri testing reference: https://v2.tauri.app/develop/tests/

### macOS packaging

- cargo-bundle: https://crates.io/crates/cargo-bundle
- gtk4 macOS bundling: https://gtk-rs.org/gtk4-rs/stable/latest/book/installation_macos.html
- Apple Developer ID: https://developer.apple.com/developer-id/
- Apple notarization: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution

### URI handlers

- macOS URL schemes: https://developer.apple.com/documentation/uniformtypeidentifierresources/uttype/identifier
- CFBundleURLTypes: https://developer.apple.com/documentation/bundleresources/information_property_list/cfbundleurltypes

### Coverage / lint

- cargo-tarpaulin: https://crates.io/crates/cargo-tarpaulin
- cargo-deny: https://crates.io/crates/cargo-deny
- cargo clippy: https://doc.rust-lang.org/clippy/

### Performance

- criterion: https://crates.io/crates/criterion
- loom (concurrency testing): https://crates.io/crates/loom

### Original Bean reference

- `scripts/check-uri-handlers.sh`
- `prek.toml` (pre-commit hook config)
- `build/darwin/Info.plist`
- `docs/references/e2e-coverage.md`
- `docs/references/bean-v1-prd.md` (acceptance criteria matrix)

---

## 6. AI-agent instructions for Phase 5

**Before writing code:**

1. Read the PRD acceptance criteria matrix in the original Bean's `docs/references/bean-v1-prd.md` (consult upstream). Every P-*, N-*, R-*, S-*, Q-* row that applies to 1.0 needs at least one E2E journey.
2. Read `docs/references/release-checklist.md` (after you write it).
3. Read `docs/references/library-lookup-protocol.md` (after you write it) — every new dep added in Phase 5 follows the protocol.

**While writing code:**

1. **E2E tests are not unit tests.** They launch the real app and exercise real flows. Don't mock the app inside E2E tests — mock only the network (via `wiremock` for HTTP, in-process TLS servers for smolnet protocols).
2. **Backend side-effects are asserted, not just visible state.** Every journey has both a visible assertion AND a DB/keychain assertion. The "upload doesn't write to browsing_history" invariant is enforced here.
3. **Release checklist is executable.** `scripts/release-checklist.sh` runs the checks; it doesn't just print them.

**After writing code:**

1. Run `bash scripts/release-checklist.sh`. Must exit 0.
2. Update `worklog.md`.
3. Use Conventional Commits: `test(phase-5): add journey 14 titan upload`, `chore(phase-5): notarize macOS app`, `docs(phase-5): finalize release checklist`.

**If the release gate fails:**

1. Don't ship with failing tests.
2. If a journey is flaky, mark it `@slow` and run it on release tags only; document the flake in `worklog.md`.
3. If a check is unreachable (e.g. 80% coverage on `hypernext-ui`), adjust the threshold and document why in `docs/references/tdd-discipline.md` (the ADR).
4. If notarization fails, do NOT ship unsigned. Either fix the notarization or delay the release.

---

## 7. After 1.0 ships

Once Hypernext 1.0 Hypertext is tagged and released:

1. **Update the overview doc** — mark 1.0 as shipped, link to the release notes
2. **Write the 1.1 Feeds phase doc** — `docs/phases/1.1-feeds.md`, following the same TDD + library-lookup-protocol structure
3. **Begin 1.1 development** — RSS/Atom/JSON Feed via `feed-rs`, WebSub, Salmention, ActivityPub read-only, ATProto read-only, Nostr read-only
4. **Monitor 1.0 in production** — collect bug reports, fix in patch releases (1.0.1, 1.0.2, etc.); never add features in patch releases
5. **Plan the 1.5 Distributed release** after 1.1 ships — IPFS, Solid, ATProto write, Nostr write, Mastodon write

The Hypernext roadmap is now real. Each dimension release follows the same phase structure: foundation work → adapter implementation → UI shell → release gate. The discipline that 1.0 establishes is what makes the later releases possible.
