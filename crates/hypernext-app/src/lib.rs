//! Hypernext application shell (Phase 1, task t8).
//!
//! The GTK4 + Relm4 app shell: a single `gtk::ApplicationWindow` with a header
//! bar and a placeholder body label. State is added in later phases.
//!
//! The shell lives in the library target so integration tests (`tests/`) can
//! launch it in-process via [`RelmApp`] and assert on the window. The binary
//! target (`main.rs`) is a thin entry point that wires up logging and calls
//! [`run`].

pub mod logging;
pub mod startup;

use gtk::prelude::*;
use relm4::prelude::*;

/// Application model. Empty in Phase 1; state is added in later phases.
pub struct AppModel;

/// Internal message used only by the smoke-probe self-test path.
#[derive(Debug)]
pub struct SmokeProbe;

/// Root component: a single `gtk::ApplicationWindow`.
#[relm4::component(pub)]
impl SimpleComponent for AppModel {
    type Init = ();
    type Input = SmokeProbe;
    type Output = ();

    view! {
        gtk::ApplicationWindow {
            set_title: Some("Hypernext"),
            set_default_size: (1024, 768),

            // Allow the close to proceed (return Propagation::Proceed).
            // RelmApp quits cleanly when the last top-level window is
            // destroyed.
            connect_close_request => |_| gtk::glib::Propagation::Proceed,

            // No HeaderBar: on macOS the native title bar (with traffic
            // lights) is the only chrome. Adding a gtk::HeaderBar would render
            // a second title bar with duplicate close/minimize/fullscreen
            // buttons. When Linux/Windows support lands, add a HeaderBar
            // conditionally (not on macOS).
            gtk::Label {
                set_label: "Hypernext 1.0 (in development)",
                set_vexpand: true,
                set_valign: gtk::Align::Center,
            }
        }
    }

    fn init(
        _init: Self::Init,
        _root: Self::Root,
        sender: ComponentSender<Self>,
    ) -> ComponentParts<Self> {
        let model = AppModel;
        let widgets = view_output!();
        // The smoke-probe path sends a message so `update` runs after the
        // window is added to the app (during startup), where it can assert the
        // title and quit. Mirrors relm4's own `shutdown_after_quit` test.
        if std::env::args().any(|a| a == "--smoke-probe") {
            sender.input(SmokeProbe);
        }
        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Self::Input, _sender: ComponentSender<Self>) {
        match msg {
            SmokeProbe => {
                let app = relm4::main_application();
                let window = app.windows().first().expect("window should exist").clone();
                assert_eq!(window.title().as_deref(), Some("Hypernext"));
                app.quit();
            }
        }
    }
}

/// Run the Hypernext application shell.
///
/// Runs startup wiring (SQLite store + keychain) then creates the `RelmApp`
/// and blocks until the window is closed. Returns `Err` (via the `From<...>
/// for HypernextError` impls / anyhow) if startup fails.
pub fn run() -> anyhow::Result<()> {
    startup::startup()?;
    run_with_args(Vec::new());
    Ok(())
}

/// Run the app shell with explicit argv (filtered before GTK parses it).
fn run_with_args(args: Vec<String>) {
    let app = RelmApp::new("com.selfagency.hypernext").with_args(args);
    app.run::<AppModel>(());
}

/// Run the app shell in smoke-probe mode.
///
/// Hidden self-test path used by `tests/smoke.rs` (subprocess mode): opens the
/// window, asserts the title, then quits so the process exits cleanly with
/// code 0. Runs on the main thread (as `main` does), so it is safe on macOS
/// where GTK must be initialized on the main thread. The `--smoke-probe` flag
/// is stripped from argv so GTK does not reject it as an unknown option; the
/// probe message is sent from `init` (gated on the flag).
pub fn run_smoke_probe() {
    let args: Vec<String> = std::env::args().filter(|a| a != "--smoke-probe").collect();
    run_with_args(args);
}
