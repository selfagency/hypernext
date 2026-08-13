# ADR 0006 — Smolnet Protocol Crates (Direct Dependencies)

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

**This decision was later reversed.** On review, the user decided to **use the crates directly** rather than vendor them. The fork-vendor approach added a ~50KLOC maintenance and rebase burden that outweighed the control benefit for a single-maintainer project. The crates are pinned in the lockfile; upstream breaking changes are handled via the normal dependency-update workflow.

## Decision

**Depend directly on the 10 smolnet protocol crates from crates.io, pinned in the workspace lockfile.**

Concretely:

1. Each crate is added to the root `Cargo.toml` `[workspace.dependencies]` block with a pinned version (e.g. `gemini-protocol = "0.1.2"`).
2. Each crate is used under its upstream name (no `hypernext-` rename, no vendored copy).
3. The lockfile (`Cargo.lock`) pins the exact resolved versions.
4. Upstream breaking changes are handled via the standard dependency-update workflow (bump version, fix breakage, commit).
5. If a crate becomes abandoned or unmaintainable, we fork it at that point — but only when the need is real, not preemptively.

## Hardening plan

Each direct dependency is hardened to production-grade as part of Phase 2 (see `docs/phases/02-smolnet-protocols.md` §3.2). For each crate:

1. Read the upstream spec (Gemini, Gopher RFC 1436, etc.) — the crate may have spec drift
2. Audit the API for missing capabilities (TOFU support, cancellation, custom TLS config)
3. Add tests: unit tests for every public function, integration tests against mock servers, fixture files
4. Add doc comments to every public API
5. Document deviations from the spec in `worklog.md`
6. Achieve ≥70% line coverage per protocol adapter

## What this enables

- **No rebase burden:** Upstream releases are handled by normal dependency updates, not manual fork rebases.
- **Smaller repo:** No 50KLOC of vendored code to maintain.
- **Simpler Cargo.toml:** No `hypernext-` renames or version-suffix gymnastics.
- **Upstream contribution:** If we find a bug, we open a PR upstream directly.

## What this costs

- **No maintenance control:** We depend on upstream's release cadence and responsiveness.
- **Breaking-change risk:** A 0.1.0 → 0.2.0 bump can break our usage; we handle it via dependency updates.
- **Quality risk:** With <250 downloads, real-world usage is untested; bugs are likely and we fix them via upstream PRs.

## Alternatives considered

### Option A: Fork-vendor (rejected)

Pro: Full maintenance control; stable versions; customization.
Con: ~50KLOC added to repo; manual rebase burden on every upstream release; we own maintenance for the lifetime of Hypernext. The user reversed this decision on review.

### Option B: Implement from scratch (rejected)

Pro: Full control; no upstream dependency.
Con: 10 protocols × ~1000 LOC each = 10K LOC of new code we have to write, test, and maintain. The crates give us a starting point — even if we rewrite 50% of each, that's 5K LOC saved.

## Consequences

### Positive

- No rebase burden
- Smaller repo
- Simpler dependency management

### Negative / accepted costs

- No maintenance control over upstream
- Breaking-change risk handled via dependency updates
- We own the maintenance of our adapters, not the crates

**Non-conformance is a release blocker.** Any change that switches a direct dependency to a vendored copy without an explicit ADR update violates this decision.

## References

- crates.io pages for each crate (see table above)
- `docs/phases/02-smolnet-protocols.md` §3.1-3.2 (dependency and hardening plan)
- `docs/references/crate-audit.md` (full audit results)
- Original Bean's protocol adapters in `internal/protocol/` (consult upstream for prior art; we diverge)

## Decision review

This ADR should be reviewed:

- After Phase 2 hardening completes (verify each protocol adapter is production-grade)
- When upstream releases a new version (decide whether to bump)
- Before 1.0 ships (verify all 10 protocol adapters pass their tests with ≥70% coverage)
