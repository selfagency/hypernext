# ADR 0008 — Async Runtime: tokio Exclusively

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** None
- **Related:** `0003-authority-model.md`

## Context

Rust has multiple async runtimes: `tokio`, `async-std`, `smol`, `glommio`, `embassy-async`. Mixing them in one project causes integration pain (different executors, different IO drivers, different timer implementations).

Hypernext's chosen dependencies strongly prefer tokio:

- `reqwest` (HTTP client) — tokio-native
- `russh` (SSH) — tokio
- `async-imap` (IMAP) — tokio
- `matrix-sdk` — tokio
- `xmpp` v0.7.0 — built on `tokio-xmpp`
- `arti` (Tor) — tokio
- `webrtc` — tokio
- `wiremock` (test HTTP) — tokio
- `keyring` is sync; called via `tokio::task::spawn_blocking`

## Decision

**Hypernext uses `tokio` (v1.53, with the `full` feature) as its exclusive async runtime. No `async-std`, no `smol`, no other executors.**

### Concretely

- `Cargo.toml` workspace deps include `tokio = { version = "1.53", features = ["full"] }`
- `hypernext-app/src/main.rs` uses `#[tokio::main]` for the entry point
- Every async function returns `impl Future<Output = ...>` or `Pin<Box<dyn Future<...>>>`; runtime-agnostic futures are NOT required because we always run on tokio
- `tokio::task::spawn_blocking` is used for sync-heavy operations: SQLite queries (`rusqlite`), keychain calls (`keyring`), PGP verification (`pgp` crate)
- `tokio_util::sync::CancellationToken` is the standard cancellation primitive (not `tokio::sync::Notify` or `futures::Stream` cancel)
- `tokio::sync::RwLock` and `tokio::sync::Mutex` for shared state; never `std::sync::Mutex` across an `.await` (would block the runtime)
- `tracing` is used for structured logging (not `log`); `tracing-subscriber` with `env-filter` and `json` features

### Why "full" features

The `full` feature of tokio includes:

- `rt-multi-thread` — multi-threaded executor (required for our concurrent protocol loads)
- `rt` — single-threaded fallback (used in some tests)
- `macros` — `#[tokio::main]`, `tokio::select!`
- `net` — TCP/UDP/Unix listeners
- `io-util`, `io-std` — `AsyncReadExt`, `AsyncWriteExt`
- `time` — timeouts, intervals
- `process` — spawning subprocesses (for future external editor, et, etc.)
- `signal` — Ctrl-C handling
- `sync` — channels, `RwLock`, `Mutex`, `Semaphore`, `CancellationToken`

The binary-size cost of `full` is acceptable (~2MB). The alternative — cherry-picking features — leads to feature creep and broken builds when a new feature needs an unselected sub-feature.

## Consequences

### Positive

- One runtime, one mental model, one set of primitives
- All dependencies integrate cleanly (no adapter layers)
- `tokio::select!` for cancellation is consistent across the codebase
- Mature ecosystem; `tokio-console` for debugging, `tokio-stream` for stream utilities

### Negative / accepted costs

- `async-std` and `smol` ecosystem crates are off-limits. If a future dependency only supports `async-std`, we either find a `tokio` alternative or write a small adapter (rare).
- Some crates (e.g. `pgp` for PGP verification) are sync. We always wrap them in `spawn_blocking`. Documented in the crate's docs.

**Non-conformance is a release blocker.** Any PR that introduces a non-tokio async runtime, or that uses `async-std`-only APIs, is rejected.

## References

- tokio: <https://docs.rs/tokio/latest/tokio/>
- tokio tutorial: <https://tokio.rs/tokio/tutorial>
- tokio::task::spawn_blocking: <https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html>
- tokio_util::sync::CancellationToken: <https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html>
- tracing: <https://docs.rs/tracing/latest/tracing/>
- tracing-subscriber: <https://docs.rs/tracing-subscriber/latest/tracing_subscriber/>
