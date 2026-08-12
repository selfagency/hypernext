# Hypernext Static Analysis Stack

> Every layer's job, what it catches, and when it runs. This is the source of
> truth for the project's static-analysis tooling (added Phase 2, 2026-08-12).
> Layer numbering follows the Rust developer toolbox convention (fmt/clippy =
> Layer 1, cargo-audit/auditable = Layer 2, Miri/Kani = Layer 3).

## Layer 1 — Fast, on every commit (prek + CI)

| Tool | What it catches | Runs |
|------|-----------------|------|
| `cargo fmt --check` | Non-canonical formatting | prek local + CI `lint` job |
| `cargo clippy --workspace -- -D warnings` | Lints, common bugs, `-D warnings` makes every lint a gate | prek local + CI `lint` job |
| `cargo test --workspace` | Behavioral regressions (3 test layers per ADR 0005) | prek local + CI `test` job |
| `cargo deny check` | License violations, banned crates, sources, **advisories** | prek local + CI `deny` job |

These are the Hypernext release-blocker checks (ADR 0010). They run on every
commit and every push/PR.

## Layer 2 — Dependency security (CI-gated)

| Tool | What it catches | Runs |
|------|-----------------|------|
| `cargo audit --deny warnings` | Known CVEs in the dependency tree (RustSec advisory DB) | prek local (resilient) + CI `audit` job |
| `cargo-auditable` | Builds release binary with an **embedded dependency tree** so a shipped `.app` can be audited post-deploy (`cargo audit binary`) | CI `build` job (macOS release) |

### Local resilience

`cargo-audit` (and `semgrep`, Layer cross-cutting) may not be installed on a
developer's machine. The prek local hooks wrap them in
`scripts/prek-cargo-audit.sh` and `scripts/prek-semgrep.sh`: if the tool is
missing, the hook prints a warning and passes — local dev is never blocked.
**CI always runs them** (the tools are installed in the workflow), so the gate
is enforced at the merge point regardless of local setup.

## Layer 3 — Deep verification (scheduled, nightly + manual)

These are 10-50x slower than normal builds, so they **never run on push/PR**.
They trigger on `schedule` (nightly cron) and `workflow_dispatch` only.

| Tool | What it catches | Targets |
|------|-----------------|---------|
| `cargo +nightly miri test` | Undefined behavior in `unsafe` code (memory errors, data races, aliasing) | Crates with `unsafe`: `hypernext-store` (sqlite-vec), `hypernext-keychain` (keyring), `hypernext-protocol` (adapters) |
| `cargo kani` | Formal verification (exhaustive proof) of safety-critical functions: bounds, panics, arithmetic overflow | `hypernext-protocol` (TOFU cert comparison), `hypernext-store` (sqlite-vec/Titan size limits), `hypernext-pgp` (PGP verification) when Phase 2 task p2-t7 lands |

### Miri

Uses `dtolnay/rust-toolchain@nightly` with the `miri` component. Runs
`cargo +nightly miri test` per targeted crate. If a crate has no `unsafe`
blocks yet, Miri still validates the safe code's soundness; the targets above
are the ones with confirmed `unsafe` usage (verified 2026-08-12: only
`hypernext-store/src/db.rs` currently contains `unsafe`).

### Kani

Uses `cargo install --locked kani-verifier` then `cargo kani` per crate. Kani
requires `#[kani::proof]` harnesses on the functions being verified; those
harnesses are added to the relevant crates as the safety-critical functions
are built. `hypernext-pgp` does not exist yet (Phase 2 task p2-t7) — the Kani
job targets what exists and will gain a `-p hypernext-pgp` line when the crate
lands.

## Cross-cutting — Semgrep (custom security rules)

Semgrep runs custom rules from `semgrep/rules.yaml` that enforce the
Hypernext-specific invariants from AGENTS.md §8/§9 — rules clippy/rustc cannot
express.

| Rule | Invariant |
|------|-----------|
| `no-unwrap-in-production` | No `.unwrap()` in non-test code (ADR 0009) |
| `no-expect-in-production` | No `.expect(...)` in non-test code |
| `no-format-sql` | No `format!` for SQL — rusqlite must use parameterized queries |
| `no-plaintext-secret` | Secrets only in the OS keychain (ADR 0007) |
| `no-webview-outside-raw-mode` | Raw-mode webview confined to the raw-mode module (ADR 0001/0002) |

Test files, fixtures, and the user's `.codacy/` directory are excluded.

Runs in the CI `semgrep` job (semgrep installed via pip) and locally via prek
(scripts/prek-semgrep.sh, resilient to missing install).

## How to run everything locally

```bash
prek run --all-files          # Layer 1 + resilient audit/semgrep hooks
cargo audit --deny warnings   # Layer 2 (if cargo-audit installed)
semgrep --config semgrep/rules.yaml crates/   # cross-cutting
cargo +nightly miri test -p hypernext-store   # Layer 3 (slow, nightly)
cargo kani -p hypernext-protocol              # Layer 3 (slow)
```
