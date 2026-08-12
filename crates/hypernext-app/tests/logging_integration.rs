//! Integration tests: spawn the built `hypernext-app` binary with `--log-probe`,
//! capture stderr, and verify the tracing subscriber emits the expected lines.
//!
//! `--log-probe` is a hidden self-test path in `main.rs` that emits one line at
//! every level and exits, so these tests don't need the GTK main loop.

use std::process::Command;

/// Path to the compiled binary, exposed by cargo at runtime for integration
/// tests of a package that ships a binary target.
fn bin() -> String {
    std::env::var("CARGO_BIN_EXE_hypernext-app").expect("CARGO_BIN_EXE_hypernext-app set by cargo")
}

#[test]
fn default_format_emits_info_but_not_debug_to_stderr() {
    let out = Command::new(bin()).arg("--log-probe").output().unwrap();
    assert!(out.status.success());
    let stderr = String::from_utf8(out.stderr).unwrap();
    assert!(stderr.contains("probe error"));
    assert!(stderr.contains("probe warn"));
    assert!(stderr.contains("probe info"));
    assert!(!stderr.contains("probe debug"));
    assert!(stderr.contains("<redacted>"));
    assert!(!stderr.contains("sup3rs3cret"));
}

#[test]
fn json_format_when_requested() {
    let out = Command::new(bin())
        .arg("--log-probe")
        .env("HYPERNEXT_LOG_FORMAT", "json")
        .output()
        .unwrap();
    assert!(out.status.success());
    let stderr = String::from_utf8(out.stderr).unwrap();
    assert!(stderr.contains("\"message\":\"probe info\""));
    assert!(stderr.contains("\"level\":\"INFO\""));
}

#[test]
fn rust_log_debug_enables_debug_lines_in_subprocess() {
    let out = Command::new(bin())
        .arg("--log-probe")
        .env("RUST_LOG", "debug")
        .output()
        .unwrap();
    assert!(out.status.success());
    let stderr = String::from_utf8(out.stderr).unwrap();
    assert!(stderr.contains("probe debug"));
}
