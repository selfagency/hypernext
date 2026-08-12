//! Hypernext binary entry point.
//!
//! Thin wrapper over the library shell (`hypernext_app::run`). Wires up
//! logging and keeps the hidden `--log-probe` self-test path used by
//! `tests/logging_integration.rs`.

use hypernext_app::logging;

fn main() {
    logging::init_tracing();

    // Hidden self-test path used by `tests/logging_integration.rs`.
    if std::env::args().any(|a| a == "--log-probe") {
        logging::log_probe();
        return;
    }

    // Hidden self-test path used by `tests/smoke.rs` (subprocess mode).
    // nosemgrep: args - test-only probe flag, not a security decision
    if std::env::args().any(|a| a == "--smoke-probe") {
        hypernext_app::run_smoke_probe();
        return;
    }

    hypernext_app::run().expect("app startup failed");
}
