# ADR 0009 — Error Propagation: thiserror + anyhow

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** None
- **Related:** `0003-authority-model.md`, `docs/phases/01-foundation-and-architecture.md` §2.6

## Context

Rust has multiple error-handling patterns:
- `Result<T, E>` with manual `From` impls (verbose but explicit)
- `thiserror` — derive `Error` and `From` for library error enums
- `anyhow` — boxed errors with context, for application-level code
- `eyre` — fork of `anyhow` with better hooks
- `snafu` — positional error enum DSL

Hypernext has both library code (the crates) and application code (the binary). Different layers need different patterns.

## Decision

**Use `thiserror` (v2.0) for library error enums, `anyhow` (v1.0) for application-level error handling. Never `eyre`, never `snafu`.**

### Library errors (`thiserror`)

Every `hypernext-*` crate (other than the binary) defines a `<Crate>Error` enum:

```rust
// crates/hypernext-store/src/error.rs
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Migration failed: {0}")]
    Migration(#[from] refinery::Error),

    #[error("sqlite-vec extension failed to load: {0}")]
    SqliteVec(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}
```

The top-level `hypernext-core/src/error.rs` defines a unified `HypernextError`:

```rust
#[derive(thiserror::Error, Debug)]
pub enum HypernextError {
    #[error("Storage error: {0}")]
    Storage(#[from] hypernext_store::StoreError),

    #[error("Keychain error: {0}")]
    Keychain(#[from] hypernext_keychain::KeychainError),

    #[error("Network error: {0}")]
    Network(#[from] hypernext_http::HttpError),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("PGP verification failed: {0}")]
    Pgp(#[from] hypernext_pgp::PgpError),

    #[error("URL parse error: {0}")]
    InvalidUrl(#[from] url::ParseError),

    #[error("Size limit exceeded: {0} bytes")]
    SizeLimitExceeded(usize),

    #[error("SSRF blocked: {0}")]
    SsrfBlocked(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Operation cancelled")]
    Cancelled,

    #[error("Feature not supported")]
    Unsupported,

    #[error("TOFU certificate changed for {host}")]
    TofuCertChanged { host: String },

    #[error("PGP key changed for {host}")]
    PgpKeyChanged { host: String },
}
```

### Application errors (`anyhow`)

The `hypernext-app` binary uses `anyhow::Result` for top-level error handling — main, CLI commands, setup:

```rust
fn main() -> anyhow::Result<()> {
    let app = setup_app()?;
    app.run()?;
    Ok(())
}

fn setup_app() -> anyhow::Result<App> {
    let store = Store::open(&data_dir()?).context("Failed to open store")?;
    let keychain = Keychain::new();
    let dispatcher = default_dispatcher(...);
    Ok(App { store, keychain, dispatcher })
}
```

`anyhow::Context::context()` adds human-readable context to wrapped errors. `anyhow::Result<T>` is `Result<T, anyhow::Error>` — works with `?` from any error type that implements `std::error::Error`.

### Error codes (for E2E test assertions)

Every error variant has a stable string code for E2E test assertions. The `Display` impl produces the code as a prefix:

- `STORAGE_MIGRATION_FAILED: <refinery error>`
- `SSRF_BLOCKED: <url>`
- `TOFU_CERT_CHANGED: <host>`
- `PGP_KEY_CHANGED: <host>`
- `CANCELLED`

E2E tests can assert via `expect(text).to_contain("TOFU_CERT_CHANGED:")` without depending on internal error types.

### Where errors should NOT be `anyhow`

Library crates (`hypernext-store`, `hypernext-protocol`, etc.) MUST NOT return `anyhow::Error` from their public API. `anyhow::Error` erases type information, making it impossible for callers to pattern-match on the error. Every library function returns `Result<T, SpecificError>`.

The application binary MAY use `anyhow::Result` for setup and CLI code where the error just gets logged and the app exits.

## Consequences

**Positive**

- Library errors are typed; callers can pattern-match
- Application errors get rich context via `anyhow::Context`
- Error codes are stable for E2E tests
- No `eyre` / `snafu` / `Box<dyn Error>` mess

**Negative / accepted costs**

- Every crate defines its own error enum — some boilerplate
- `From` impls must be written or derived (`#[from]`)
- Stable error codes must be maintained (no renaming without a major version bump)

**Non-conformance is a release blocker.** Any PR that returns `anyhow::Error` from a library crate's public API, or that changes a stable error code, is rejected.

## References

- thiserror: https://docs.rs/thiserror/latest/thiserror/
- anyhow: https://docs.rs/anyhow/latest/anyhow/
- The original Bean's `internal/errors/errors.go` (consult upstream — same idea, Go flavor)
- Rust API Guidelines on error handling: https://rust-lang.github.io/api-guidelines/interoperability.html#c-good-error
