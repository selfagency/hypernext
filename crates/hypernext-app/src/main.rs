//! Hypernext Phase 1 spike (task t0): prove a minimal Relm4 + GTK4 window
//! opens on macOS and that the gvsbuild bundling path is viable.
//!
//! This is a proof-of-concept only. The final app shell is task t8.

use gtk::prelude::*;
use relm4::prelude::*;

/// Application model. Empty for the spike; state is added in t8.
struct AppModel;

/// Root component: a single `gtk::ApplicationWindow`.
#[relm4::component]
impl SimpleComponent for AppModel {
    type Init = ();
    type Input = ();
    type Output = ();

    view! {
        gtk::ApplicationWindow {
            set_title: Some("Hypernext"),
            set_default_size: (1024, 768),

            // Allow the close to proceed (return Propagation::Proceed).
            // RelmApp quits cleanly when the last top-level window is
            // destroyed.
            connect_close_request => |_| gtk::glib::Propagation::Proceed,
        }
    }

    fn init(
        _init: Self::Init,
        _root: Self::Root,
        _sender: ComponentSender<Self>,
    ) -> ComponentParts<Self> {
        let model = AppModel;
        let widgets = view_output!();
        ComponentParts { model, widgets }
    }
}

fn main() {
    let app = RelmApp::new("com.selfagency.hypernext");
    app.run::<AppModel>(());
}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert!(true);
    }
}
