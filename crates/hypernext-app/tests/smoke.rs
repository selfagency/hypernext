//! Smoke test: launch the app shell, assert the window title, and quit cleanly.
//!
//! Requires a display. On Linux CI run under `xvfb-run`; on macOS the system
//! display is used. See `docs/references/gtk-testing.md`.
//!
//! Two modes:
//! - `window_opens_with_title_and_quits_cleanly` (in-process, `#[ignore]`):
//!   GTK on macOS must be initialized on the main thread, but the test harness
//!   runs tests on a spawned thread, so `RelmApp::new()` panics. Kept as the
//!   canonical in-process form for platforms where the harness runs on the
//!   main thread (e.g. Linux under xvfb); run with `cargo test -- --ignored`.
//! - `binary_exits_cleanly` (subprocess): spawns the built binary with
//!   `--smoke-probe`, which opens the window, asserts the title, and quits.
//!   Runs on the main thread, so it is the cross-platform CI gate.

use std::process::Command;

use gtk::glib;
use gtk::prelude::*;
use hypernext_app::AppModel;
use relm4::prelude::*;

/// Path to the compiled binary, exposed by cargo at runtime for integration
/// tests of a package that ships a binary target.
fn bin() -> String {
    std::env::var("CARGO_BIN_EXE_hypernext-app").expect("CARGO_BIN_EXE_hypernext-app set by cargo")
}

/// In-process launch: assert the window title, then quit.
///
/// `#[ignore]` because GTK on macOS must be initialized on the main thread,
/// but the test harness runs tests on a spawned thread (panics with
/// "Attempted to initialize GTK on OSX from non-main thread"). Run explicitly
/// with `cargo test -- --ignored` on a platform where the harness runs on the
/// main thread.
#[test]
#[ignore = "GTK on macOS must init on the main thread; test harness runs on a spawned thread"]
fn window_opens_with_title_and_quits_cleanly() {
    let app = RelmApp::new("com.selfagency.hypernext.test");

    // Schedule an idle callback: once the main loop runs, the window exists.
    // Assert the title, then quit so `run()` returns and the process exits 0.
    glib::idle_add_local(move || {
        let app = relm4::main_application();
        let window = app.active_window().expect("window should exist");
        assert_eq!(window.title().as_deref(), Some("Hypernext"));
        app.quit();
        glib::ControlFlow::Break
    });

    app.run::<AppModel>(());
}

/// Subprocess launch: the binary opens the window, asserts the title, and
/// quits. Verifies the process exits cleanly with code 0.
#[test]
fn binary_exits_cleanly() {
    let out = Command::new(bin()).arg("--smoke-probe").output().unwrap();
    assert!(
        out.status.success(),
        "binary should exit 0, got {:?}",
        out.status
    );
}
