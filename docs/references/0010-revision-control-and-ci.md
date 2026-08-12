# ADR 0010 — Revision Control & CI

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** Bean's gitbutler + Taskfile + GitHub Actions setup
- **Related:** `0005-tdd-discipline.md`, `docs/phases/01-foundation-and-architecture.md` §2.8

## Context

The Wails version used `gitbutler/workspace` via `but` for branch management. The 2026-08-06 master plan flagged `skills-lock.json` and untracked skill directories as dirty-tree pain points during `but diff` / `but commit`. The `--no-verify` flag was used at least once in history, breaking the pre-commit hooks (the `scripts/check-no-verify.sh` script exists specifically to enforce this lesson).

Hypernext resets to a simpler, more conventional setup.

## Decision

**Use git directly (no gitbutler), Conventional Commits, GitHub Actions CI, cargo for builds, cargo-deny for license/advisory gates. No `--no-verify` ever.**

### Git workflow

- **Default branch:** `main`
- **Feature branches:** `feat/<scope>-<description>` e.g. `feat/phase-2-gemini-adapter`
- **Bug branches:** `fix/<scope>-<description>`
- **Conventional Commits** (required):
  - `feat(phase-N): <description>`
  - `fix(phase-N): <description>`
  - `test(phase-N): <description>`
  - `docs(phase-N): <description>`
  - `chore(phase-N): <description>`
  - `refactor(phase-N): <description>`
  - `perf(phase-N): <description>`
- **Commit message body:** Optional but encouraged for non-trivial changes. Wrapped at 72 chars.
- **Co-authored commits:** If an AI agent wrote the code, the commit message body includes:
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
  (Or whatever agent is used.)

### Pre-commit hook (mandatory)

A pre-commit hook (via `cargo-husky` or a manual `.git/hooks/pre-commit`) runs:
1. `cargo fmt --check` — must pass
2. `cargo clippy --workspace -- -D warnings` — must pass
3. `scripts/check-no-verify.sh` — refuses `--no-verify` in the commit command (the hook itself cannot bypass this; if you need to bypass for an emergency, you must edit the script, which leaves a paper trail)

The hook is **non-bypassable except by editing the script**. Documented in `CONTRIBUTING.md`.

### GitHub Actions CI

`.github/workflows/ci.yml`:

- **Triggers:** Push to `main`, pull request, release tag
- **Matrix (Phase 1-4):** macOS only
- **Matrix (Phase 5+):** macOS + Linux + Windows (added when raw-mode webview work stabilizes)
- **Jobs:**
  1. **lint** — `cargo fmt --check` + `cargo clippy --workspace -- -D warnings`
  2. **test** — `cargo test --workspace` with `xvfb-run` for GTK tests on Linux; native display on macOS
  3. **coverage** — `cargo tarpaulin --workspace --out lcov --fail-under <threshold>` (threshold ratchets up per phase; see `0005-tdd-discipline.md`)
  4. **deny** — `cargo deny check` for license + advisories
  5. **build** — `cargo build --release` to catch release-only issues
  6. **e2e** (release tags only) — runs the 20-journey E2E suite against the bundled macOS app
- **Cache:** `Swatinem/rust-cache@v2` for `~/.cargo` and `target/`
- **Required status checks:** lint, test, deny, build (must pass for PR merge to `main`)

### Cargo workspace

- Root `Cargo.toml` defines `[workspace]` and `[workspace.dependencies]` (see Phase 1 §2.9)
- Each crate's `Cargo.toml` inherits versions via `dep.workspace = true`
- `cargo-deny` config in `deny.toml`:
  - Licenses: allow `MIT`, `Apache-2.0`, `MPL-2.0`, `BSD-3-Clause`, `ISC`, `Unicode-DFS-2016`; forbid `GPL`, `AGPL`, `LGPL` (would force Hypernext to be GPL)
  - Advisories: `cargo audit` integration; vulnerabilities fail CI
  - Bans: certain crates are banned (e.g. `openssl` for being a maintenance burden; use `rustls` instead)
  - Forbid `--no-verify` patterns in `Cargo.toml` or `Cargo.lock`

### Version policy

- **Pre-1.0:** Phase 1-5 development uses version `0.1.0` for all crates
- **1.0 release:** Tag `v1.0.0`; all crates bumped to `1.0.0`
- **Post-1.0:** Semver — patch releases (1.0.1, 1.0.2) for bug fixes only; minor releases (1.1, 1.5, 2.0, etc.) per the dimension roadmap in `docs/overview.md`

### Worklog protocol

Every task (Phase 1 sub-task, Phase 2 adapter, etc.) has a Task ID. AI agents append to `worklog.md` (repo root):

```markdown
---
Task ID: 2-a
Agent: Claude
Task: Implement Gemini adapter with TOFU cert pinning

Work Log:
- Read gemini-protocol spec at https://geminiprotocol.net/
- Read gemini-protocol crate API at https://docs.rs/gemini-protocol/latest/gemini_protocol/
- Wrote failing unit tests for status code parsing (10 cases)
- Implemented GeminiAdapter::fetch
- Tests pass with 85% coverage
- Opened question about client cert prompts — see Q4 in docs/phases/02-smolnet-protocols.md

Stage Summary:
- Gemini adapter complete; ready for integration tests
- TOFU cert pinning verified against in-process TLS mock
- Client cert prompts deferred (documented in open questions)
```

## Consequences

**Positive**

- Conventional, predictable git workflow
- Pre-commit hooks catch issues before they hit CI
- `cargo-deny` blocks license/advisory drift
- Worklog provides AI-agent accountability

**Negative / accepted costs**

- No gitbutler's parallel-branch workflow — but the Wails version's `but` workflow was itself a pain point
- Pre-commit hook adds ~10 seconds per commit; acceptable
- Strict commit message format requires discipline; mitigated by a `commit-msg` hook that validates Conventional Commits

**Non-conformance is a release blocker.** Any PR that uses `--no-verify`, that fails the pre-commit hook, or that introduces a forbidden license violates this ADR and is rejected.

## References

- Conventional Commits: https://www.conventionalcommits.org/
- cargo-husky: https://crates.io/crates/cargo-husky
- cargo-deny: https://crates.io/crates/cargo-deny
- cargo-tarpaulin: https://crates.io/crates/cargo-tarpaulin
- Swatinem/rust-cache: https://github.com/Swatinem/rust-cache
- The original Bean's `scripts/check-no-verify.sh` (consult upstream)
