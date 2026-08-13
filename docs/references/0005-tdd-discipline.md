# ADR 0005 — TDD Discipline: Three Layers, Coverage Gates

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** Bean's Vitest unit + integration + e2e split (we drop React testing entirely)
- **Related:** `0003-authority-model.md`, `docs/phases/01-foundation-and-architecture.md` §4, every phase doc's TDD section

## Context

The Wails version of Bean had 80+ integration tests and 24 e2e suites — testing infrastructure consumed more effort than product features. The lesson isn't "test less" — it's "test at the right layer." The webview-as-app-chrome architecture made integration tests expensive because every test had to mock both the Wails binding layer AND the React component layer.

Hypernext's single-process Rust architecture eliminates the binding layer. Tests are simpler: cargo test runs everything, no separate frontend test runner, no Vite config.

## Decision

**Hypernext uses three layers of automated tests, with coverage gates enforced in CI.**

### Layer 1: Unit tests (`cargo test`)

- **Location:** `#[cfg(test)] mod tests { ... }` blocks in every Rust source file, OR `tests/` subdirs per crate
- **Purpose:** Test pure functions, parsers, type conversions, isolated logic
- **Run on:** Every commit, every PR
- **Speed target:** Full workspace unit test suite <30 seconds
- **Tools:**
  - `pretty_assertions` — readable diff output for struct equality
  - `rstest` — parametric tables (one test function, many input rows)
  - `mockall` — mock traits for external interfaces
- **Coverage gate:** 80% line coverage per crate (enforced via `cargo-tarpaulin`)
  - Exception: `hypernext-ui` may have a lower threshold (60%) because GTK testing is harder — see `docs/references/gtk-testing.md`
  - Exception: `hypernext-testutil` has no coverage gate (it's test infrastructure)

### Layer 2: Integration tests (`tests/` directory per crate)

- **Location:** `crates/<crate>/tests/<name>.rs`
- **Purpose:** Test module boundaries — a crate's public API exercised end-to-end against in-process mocks
- **Run on:** Every commit, every PR
- **Tools:**
  - `wiremock` — mock HTTP servers
  - `tokio::net::TcpListener` — for raw TCP protocols (Gemini, Gopher, etc.)
  - `tokio-rustls` — for TLS protocols with self-signed certs
- **Fixtures:** Every protocol has a `tests/fixtures/<protocol>/` directory with real captured responses (PGP-signed, includes edge cases). Fixtures are how we catch spec drift.
- **Coverage gate:** 70% line coverage at the integration level (cumulative with unit tests; the goal is the sum exceeds 80%)

### Layer 3: End-to-end tests (Playwright)

- **Location:** `e2e/journeys/<NN>-<name>.spec.ts` at the repo root (separate package)
- **Purpose:** Drive the running Hypernext app via Playwright through CDP, exercising user-visible flows
- **Run on:** Release tags only (too slow for every PR; documented in CI config)
- **Tools:**
  - Playwright (Node.js) — drives the bundled `.app` via CDP
  - In-process mock servers (in TypeScript, mirroring the Rust mocks)
  - Helper scripts: `e2e/helpers/launch.ts`, `e2e/helpers/db.ts`, `e2e/helpers/keychain.ts`
- **Pattern:** Every journey has both a visible assertion (e.g. "the page title is X") AND a backend side-effect assertion (e.g. "browsing_history has 1 row")
- **Coverage gate:** Every PRD acceptance criterion has at least one E2E test (verified by a static check: `scripts/check-e2e-coverage.sh`)

### Layer 4 (manual): Release gate

Before tagging a release:

- Cold start <2 seconds
- Memory <150MB idle
- Binary <60MB
- 30-minute smoke test: navigate every 30 seconds, verify no panics, no memory growth >50MB
- 50-tab stress test: open 50 tabs, switch between them, verify no panics
- macOS notarization passes
- URI scheme handlers register correctly
- Documented in `docs/references/release-checklist.md`

## The TDD cycle

For every feature, the development cycle is:

1. **Write a failing unit test** that describes the behavior you want
2. **Write the minimum code** to make the test pass
3. **Refactor** with confidence (tests catch regressions)
4. **Write an integration test** that exercises the public API
5. **If user-visible:** write an E2E journey that exercises the full flow

The Wails version sometimes wrote tests after the feature ("we'll add tests once it works"). That's not TDD; it's verification. We don't do that.

## AI agent guidance

AI agents writing Hypernext code must follow this discipline:

1. **Before writing implementation, write the test.** If you find yourself writing implementation before tests, STOP. Back up. Write the test first.
2. **Use `rstest` for parametric tests** wherever a function has multiple input shapes. One test function with 10 input rows is better than 10 separate tests.
3. **Use `pretty_assertions::assert_eq!`** for struct equality — the diff output saves hours of debugging.
4. **Mock external interfaces** with `mockall`. Don't make real network calls in tests.
5. **Every fixture is real.** Don't synthesize a fixture; capture one from a live server (with permission). Fixtures catch spec drift that hand-written fixtures miss.
6. **If a test is flaky, mark it `#[ignore]` with a comment explaining why.** Don't delete it. Come back to it.
7. **Coverage is enforced.** `cargo tarpaulin --workspace --fail-under 80` runs in CI. If you add code without tests, CI fails.

## Consequences

### Positive

- Regression catches happen at the unit level (fast) before integration (slower) before E2E (slowest)
- Every PRD acceptance criterion has automated coverage
- Refactoring is safe — tests catch behavior changes
- AI agents have clear guidance on how to write tests

### Negative / accepted costs

- TDD is slower than "write code, ship it" — by design. The cost is paid up front.
- Some tests will be expensive to write (GTK UI tests, raw-mode webview tests). We accept this.
- E2E tests are slow (minutes, not seconds). They run on release tags, not every PR.
- Coverage gates can be gamed (write tests that assert nothing). Code review catches this.

**Non-conformance is a release blocker.** Any PR that drops test coverage below the gate, or that adds code without tests, is rejected.

## References

- cargo test: <https://doc.rust-lang.org/cargo/commands/cargo-test.html>
- rstest: <https://crates.io/crates/rstest>
- pretty_assertions: <https://crates.io/crates/pretty_assertions>
- mockall: <https://crates.io/crates/mockall>
- wiremock: <https://crates.io/crates/wiremock>
- cargo-tarpaulin: <https://crates.io/crates/cargo-tarpaulin>
- Playwright: <https://playwright.dev/>
- Bean's e2e coverage plan: `docs/plans/e2e-coverage-plan.md` (consult upstream for journey list inspiration)
