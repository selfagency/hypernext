# ADR 0003 — Authority Model: Single-Process Rust

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** Bean ADR 0001's "Go backend as authority, React frontend as presentation"
- **Related:** `0001-ui-framework-choice.md`, `0007-keychain-only-secrets.md`

## Context

The original Bean's ADR 0001 established a strict authority model: *"Go backend is the single authority for protocols, persistence, secrets, network policy, and publishing. The React/TypeScript frontend is presentation only: it renders typed Wails bindings and may keep state as a cache or view, but frontend state is never the source of truth."*

That authority model existed because Wails forces a Rust/JS IPC boundary — the frontend can't touch SQLite or the keychain directly even if it wanted to. The Wails binding layer was the chokepoint.

Hypernext doesn't have that boundary. The UI (Relm4 + GTK4) and the backend (protocol adapters, store, keychain) are all Rust code in the same process. There is no IPC. There are no bindings. There are no TypeScript types to keep in sync.

This changes the authority model fundamentally.

## Decision

**Hypernext is a single-process Rust application. All code — UI, protocol adapters, storage, keychain, HTTP client, PGP verification — runs in the same process and shares types directly. There is no IPC, no bindings, no frontend/backend split.**

Concretely:

- A UI component imports `hypernext_protocol::Dispatcher` and calls `dispatcher.fetch(url, &ctx).await` directly — no FFI, no serialization, no message-passing
- A UI component imports `hypernext_store::Store` and reads/writes SQLite directly
- A UI component imports `hypernext_keychain` and queries the OS keyring directly
- Shared state lives in Relm4's `Model` structs and `tokio::sync` primitives
- Errors propagate via `?` operator with `thiserror` types — no error translation across a boundary

## What this changes from the Wails version

| Aspect | Bean (Wails) | Hypernext |
|---|---|---|
| Frontend → Backend | Wails binding call (IPC, JSON serialization, async via JS promises) | Direct async Rust function call |
| Backend → Frontend | Frontend subscribes to events; backend emits | Direct Relm4 message-passing |
| State | React state on frontend; cache/view only | Relm4 `Model` structs; single source of truth |
| Errors | Go error → JSON → JS error → React error boundary | Rust `Error` via `?` operator |
| Types | Wails auto-generates TS from Go structs | Shared Rust types; no generation step |
| SQLite | Go-only; frontend never sees a handle | Any crate can hold a `rusqlite::Connection` (but only `hypernext-store` should, for clarity) |
| Keychain | Go-only; frontend queries via binding | Any crate can call `keyring::Entry::new` (but only `hypernext-keychain` should, for clarity) |

## Architectural invariants (still apply)

Even with the single-process model, these invariants from the original ADR still hold:

1. **The OS keychain is the only secret store.** API tokens, IndieAuth tokens, account credentials live in the keychain — never in SQLite, never in process memory longer than necessary, never in logs. (See `0007-keychain-only-secrets.md`.)

2. **No plaintext secret fallback.** No Base64-as-encryption, no SQLite/JSON/localStorage secret path. If the keychain is unavailable, the feature fails gracefully — never falls back to plaintext.

3. **SSRF defense at the HTTP layer.** Every outbound HTTP request goes through `FetchPolicy::check_url`. No bypassing even from within the same process. (See Phase 3 §3.1.)

4. **Explicit-confirmation for irreversible side effects.** Titan upload, Micropub publish, social crosspost — every action that writes to a remote system requires an explicit user gesture (button click with confirmation dialog), never implicit on navigation. (See Phase 2 §3.6, Phase 4 §3.7.)

5. **PGP verification before extraction.** Verification runs on raw response bytes, BEFORE any HTML extraction, markdown parsing, or rendering. (See Phase 2 §3.8.)

## What this enables

The single-process model eliminates entire categories of complexity that plagued the Wails version:

- **No god-object `app.go`.** The 2,491-line `app.go` from the Wails version existed because every feature needed a binding. In Hypernext, the same feature is just a Rust function in a crate, called directly.
- **No TypeScript type drift.** Wails auto-generates TS bindings from Go structs; if a struct changes, the bindings regenerate, but only on the next `task generate`. Stale bindings were a recurring source of bugs. Hypernext has one type system.
- **No frontend/backend error translation.** A `HypernextError::Storage(rusqlite::Error)` propagates directly to the UI, which can pattern-match on it for display. No error code munging across a JSON boundary.
- **No IPC overhead.** Async function calls in the same process are nanoseconds; Wails binding calls were milliseconds (JSON serialization + IPC).
- **No binding-parity tests.** The Wails version had `task generate` parity tests to verify bindings matched Go structs. Hypernext doesn't need them — there are no bindings.

## What this costs

- **All UI code is Rust.** A frontend developer who only knows React can't contribute to Hypernext UI. This narrows the contributor pool. (Acceptable: the project is currently single-maintainer.)
- **Hot reload is harder.** Wails had Vite hot reload for the React frontend. Hypernext has Relm4's `Subsecond` hot-patching for some changes, but full recompiles are slower than Vite. Mitigation: incremental compilation + `sccache` + cargo's `cargo-check` for fast type-only feedback.
- **Testing UI requires a display.** GTK tests need an X server (or `xvfb-run` on Linux). On macOS, the system display is used. In CI, this requires careful setup.

## Crate-level boundaries (preserved for clarity)

Even though everything is one process, we keep crate-level boundaries for code organization:

- `hypernext-store` — the only crate that opens SQLite connections
- `hypernext-keychain` — the only crate that calls `keyring::Entry`
- `hypernext-protocol` — the only crate that calls protocol adapters
- `hypernext-http` — the only crate that calls `reqwest` (other than the protocol adapters that need to fetch)
- `hypernext-pgp` — the only crate that calls `pgp::verify_*`
- `hypernext-ui` — the only crate that imports `relm4` and `gtk4`

These boundaries are enforced by `cargo-deny` configuration that forbids certain crates from depending on others (e.g. `hypernext-ui` may not depend on `rusqlite` directly — only via `hypernext-store`). (See `docs/references/0010-revision-control-and-ci.md`.)

## Consequences

**Positive**

- Simpler architecture; fewer moving parts
- One language, one type system, one error model
- No binding generation, no parity tests, no type drift
- Faster development for new features
- Easier testing — no mock bindings, just mock the trait

**Negative / accepted costs**

- All contributors need Rust proficiency
- Slower hot reload than Vite (but acceptable)
- Larger binary than a pure-Go app (GTK4 runtime + Rust stdlib + tokio + ...); target <60MB

**Non-conformance is a release blocker.** Any change that reintroduces an IPC layer, a separate frontend process, or a binding generation step violates this ADR and fails CI.

## References

- Bean's original ADR 0001: `docs/references/0001-bean-v1-architecture.md` (consult upstream; the rationale is still informative)
- Relm4 component model: <https://relm4.org/docs/stable/component.html>
- thiserror: <https://docs.rs/thiserror/latest/thiserror/>
- anyhow: <https://docs.rs/anyhow/latest/anyhow/>
- cargo-deny: <https://crates.io/crates/cargo-deny>
