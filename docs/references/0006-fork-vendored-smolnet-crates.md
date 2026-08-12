# ADR 0006 — Fork-Vendored Smolnet Protocol Crates

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** None
- **Related:** `docs/phases/02-smolnet-protocols.md` §3.1-3.2, `crate-audit.md`

## Context

During the planning phase, a coordinated batch of fresh 0.1.0 smolnet protocol crates appeared on crates.io:

| Crate | Version | Release date | Downloads (as of audit) |
|---|---|---|---|
| `gemini-protocol` | 0.1.2 | 2026-08-06 | 103 |
| `scroll-protocol` | 0.1.0 | 2026-08-06 | 51 |
| `text-protocol` | 0.1.0 | 2026-08-06 | 14 |
| `spartan-protocol` | 0.1.1 | 2026-07-11 | 221 |
| `nex-protocol` | 0.1.1 | 2026-07-11 | 220 |
| `gopher-protocol` | 0.1.2 | 2026-08-06 | 102 |
| `scorpion-protocol` | 0.1.0 | 2026-08-08 | 13 |
| `kepler-protocol` | 0.1.0 | 2026-08-05 | 13 |
| `guppy-protocol` | 0.1.1 | 2026-07-11 | 223 |
| `titanite` (Titan) | 0.3.2 | 2025-02-24 | 4512 |

All released within a 4-week window, all from what appears to be a single coordinated author (based on release cadence and naming convention). The user knows the author and trusts them, but does not control the crates.

### Risk assessment of depending directly

Depending directly on a 0.1.0 crate with <250 downloads each is high-risk:

1. **Maintenance risk:** If the author loses interest, the crate is abandoned. We have no control.
2. **Breaking changes:** A 0.1.0 → 0.2.0 bump can break our usage with no warning.
3. **Quality risk:** With <250 downloads, real-world usage is untested. Bugs are likely.
4. **Auditability:** We can't fix bugs without forking anyway; depending directly means every fix is a PR to upstream that may or may not be merged.

### User decision

User selected "Third-party, fork-vendor" during planning: *"Not mine but I trust the author. Fork-vendor into the Bean repo so we control maintenance; cite upstream."*

## Decision

**Fork-vendor all 10 crates into `crates-vendored/` in the Hypernext repo.**

Concretely:

1. Each crate's source is copied into `crates-vendored/<original-name>/`
2. Each crate is renamed to `hypernext-<protocol>` in its `Cargo.toml` to avoid crates.io collisions
3. Each crate's version is bumped to `<upstream-version>-hypernext.1` (e.g. `gemini-protocol 0.1.2` → `hypernext-gemini 0.1.2-hypernext.1`)
4. Each crate's `LICENSE` file is preserved from upstream
5. Each crate gets a `README.md` noting the upstream origin and version
6. Each crate gets a `HYPERNEXT_CHANGES.md` log of every modification we make (for upstream contribution later)
7. Each crate is added as a workspace member in the root `Cargo.toml`
8. The original upstream version is preserved as a git tag `vendor/<crate>/<version>` before any modifications, so we can rebase on future upstream releases

## Hardening plan

Each vendored crate is hardened to production-grade as part of Phase 2 (see `docs/phases/02-smolnet-protocols.md` §3.2). For each crate:

1. Read the upstream spec (Gemini, Gopher RFC 1436, etc.) — the crate may have spec drift
2. Audit the API for missing capabilities (TOFU support, cancellation, custom TLS config)
3. Add tests: unit tests for every public function, integration tests against mock servers, fixture files
4. Add doc comments to every public API
5. Document deviations from the spec in `HYPERNEXT_CHANGES.md`
6. Achieve ≥70% line coverage per vendored crate

## What this enables

- **Maintenance control:** We can fix bugs without waiting for upstream PRs.
- **Stable versions:** Our lockfile pins to our hardened fork; upstream breaking changes don't affect us.
- **Customization:** We can add Hypernext-specific features (SSRF-aware HTTP client injection, custom TLS config for TOFU) without contorting the upstream API.
- **Upstream contribution:** Every change is logged in `HYPERNEXT_CHANGES.md`; if the change is generally useful, we open a PR upstream with a clean diff.

## What this costs

- **Rebase burden:** When upstream releases 0.2.0, we have to rebase our changes onto it. This is manual work but infrequent (these crates don't release often).
- **Code duplication:** If a future Hypernext release (e.g. 2.0 Conversation) needs XMPP, we'll use the upstream `xmpp` crate directly (which is mature, v0.7.0, 15K downloads). Vendoring is only for the 0.1.0 smolnet crates.
- **Larger repo:** 10 vendored crates add ~50KLOC to the repo. Acceptable.

## Alternatives considered

### Option A: Depend directly (rejected)

Pro: No vendoring, no rebase burden.
Con: We have no control over maintenance; bugs require upstream PRs that may never merge. The user explicitly chose against this.

### Option B: Implement from scratch (rejected)

Pro: Full control; no upstream dependency.
Con: 10 protocols × ~1000 LOC each = 10K LOC of new code we have to write, test, and maintain. The vendored crates give us a starting point — even if we rewrite 50% of each, that's 5K LOC saved.

### Option C: Vendor without renaming (rejected)

Pro: Simpler Cargo.toml.
Con: Risks crates.io name collision if we ever publish; renaming is cheap insurance.

## Consequences

**Positive**

- Full maintenance control
- Stable versions, no surprise breakage
- Hypernext-specific features can be added
- Clean upstream contribution path

**Negative / accepted costs**

- Manual rebase when upstream releases
- 50KLOC added to repo
- We own the maintenance for the lifetime of Hypernext

**Non-conformance is a release blocker.** Any change that switches a vendored crate to a direct crates.io dependency without an explicit ADR update violates this decision.

## References

- crates.io pages for each crate (see table above)
- `docs/phases/02-smolnet-protocols.md` §3.1-3.2 (forking and hardening plan)
- `docs/references/crate-audit.md` (full audit results)
- Original Bean's protocol adapters in `internal/protocol/` (consult upstream for prior art; we diverge)

## Decision review

This ADR should be reviewed:
- After Phase 2 hardening completes (verify each vendored crate is production-grade)
- When upstream releases a new version (decide whether to rebase)
- Before 1.0 ships (verify all 10 crates pass their tests with ≥70% coverage)
