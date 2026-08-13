//! Logging and tracing infrastructure.
//!
//! Wires `tracing` + `tracing-subscriber` for the app: reads `RUST_LOG`
//! (default `info`), writes to stderr, and emits structured JSON when
//! `HYPERNEXT_LOG_FORMAT=json`. Also provides the [`Redacted`] wrapper so
//! secrets are never written to the log.
//!
//! Log levels (see `docs/references/logging-policy.md`):
//! - `error`: user-visible failures, panics
//! - `warn`: recoverable failures (e.g. fallback to a default)
//! - `info`: app lifecycle (started, opened URL, ...)
//! - `debug`: per-protocol request/response (off by default)
//! - `trace`: byte-level (off by default)

use tracing_subscriber::EnvFilter;

/// Default filter when `RUST_LOG` is unset or unparseable.
const DEFAULT_LOG_LEVEL: &str = "info";

/// Wraps a secret so its `Display` impl renders `<redacted>`.
///
/// Use with `tracing::field::display(Redacted(secret))` to log a value
/// without leaking it. See `docs/references/logging-policy.md`.
#[derive(Debug, Clone, Copy)]
pub struct Redacted<T>(pub T);

impl<T> std::fmt::Display for Redacted<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<redacted>")
    }
}

/// Build the `EnvFilter` from `RUST_LOG`, falling back to [`DEFAULT_LOG_LEVEL`].
pub(crate) fn env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_LEVEL))
}

/// Install the global tracing subscriber.
///
/// - Writes to stderr by default; structured JSON if `HYPERNEXT_LOG_FORMAT=json`.
/// - Level comes from `RUST_LOG` (default `info`).
///
/// Called once at app startup (see `main`). Kept as a single separable function
/// so task t8 can call it without conflict.
pub fn init_tracing() {
    let fmt = tracing_subscriber::fmt()
        .with_env_filter(env_filter())
        .with_writer(std::io::stderr);
    if std::env::var("HYPERNEXT_LOG_FORMAT").as_deref() == Ok("json") {
        fmt.json().init();
    } else {
        fmt.init();
    }
}

/// Emit one line at every level, then let the caller exit.
///
/// Exposed for the integration test (`tests/logging_integration.rs`), which
/// spawns the binary with `--log-probe` and inspects stderr. Not part of the
/// real app flow.
pub fn log_probe() {
    tracing::error!("probe error");
    tracing::warn!("probe warn");
    tracing::info!("probe info");
    tracing::debug!("probe debug");
    tracing::trace!("probe trace");
    // Redaction demo: the secret value must never reach the log.
    let secret = "sup3rs3cret";
    tracing::info!(
        token = tracing::field::display(Redacted(secret)),
        "probe redacted"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes env mutation + filter build so parallel tests don't race.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn redacted_displays_as_redacted() {
        let secret = Redacted("hunter2-super-secret");
        let rendered = format!("{}", tracing::field::display(&secret));
        assert_eq!(rendered, "<redacted>");
        // The secret value itself never appears.
        assert!(!rendered.contains("hunter2"));
    }

    #[test]
    fn rust_log_debug_enables_debug_events() {
        let _guard = ENV_LOCK.lock().unwrap();
        // edition-2024: std::env::set_var is safe-only on the main thread, so
        // on other threads it is unsafe; test-only, serialized by ENV_LOCK.
        unsafe { std::env::set_var("RUST_LOG", "debug") };
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            assert!(tracing::enabled!(tracing::Level::DEBUG));
            assert!(!tracing::enabled!(tracing::Level::TRACE));
        });
    }

    #[test]
    fn default_filter_is_info_not_debug() {
        let _guard = ENV_LOCK.lock().unwrap();
        // edition-2024: std::env::remove_var is unsafe off the main thread.
        unsafe { std::env::remove_var("RUST_LOG") };
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            assert!(tracing::enabled!(tracing::Level::INFO));
            assert!(!tracing::enabled!(tracing::Level::DEBUG));
        });
    }
}
