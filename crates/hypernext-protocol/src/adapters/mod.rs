//! Per-protocol adapters wrapping the smolnet protocol crates (ADR 0006).
//!
//! Each adapter implements [`crate::Protocol`] and returns a
//! `hypernext_core::PageDoc` so UI code never knows which protocol it renders.

pub mod dict;
pub mod finger;
pub mod gemini;
pub mod gopher;
pub mod guppy;
pub mod http;
pub mod kepler;
pub mod molerat;
pub mod nex;
pub mod scorpion;
pub mod scroll;
pub mod spartan;
pub mod tcp_helper;
pub mod text;
pub mod titan;
pub mod tofu;
pub mod webfinger;

pub use dict::DictAdapter;
pub use finger::FingerAdapter;
pub use gemini::GeminiAdapter;
pub use gopher::GopherAdapter;
pub use guppy::GuppyAdapter;
pub use http::HttpAdapter;
pub use kepler::KeplerAdapter;
pub use molerat::MoleratAdapter;
pub use nex::NexAdapter;
pub use scorpion::ScorpionAdapter;
pub use scroll::ScrollAdapter;
pub use spartan::SpartanAdapter;
pub use text::TextAdapter;
pub use titan::TitanAdapter;
pub use webfinger::WebFingerAdapter;

use crate::dispatcher::Protocol;

/// Register every built-in adapter into a fresh [`Dispatcher`] and return it:
/// the default dispatcher (handoff h1). This unblocks ordinary `http`/`https`
/// fetches (the prefix-less `HttpAdapter` default), with WebFinger keeping the
/// `/.well-known/webfinger` https path via its longer path prefix.
pub fn default_dispatcher() -> crate::dispatcher::Dispatcher {
    let mut d = crate::dispatcher::Dispatcher::new();
    for protocol in all() {
        d.register(protocol);
    }
    d
}

/// Build every built-in adapter, ready to be handed to a `Dispatcher`.
///
/// Order is irrelevant; the `Dispatcher` routes by scheme (+path prefix).
/// Titans are registered even though `supports_fetch` is false — they handle
/// `publish`/upload only, and the Dispatcher is the only routing hub.
pub fn all() -> Vec<Box<dyn Protocol>> {
    vec![
        Box::new(GeminiAdapter::new()),
        Box::new(FingerAdapter::new()),
        Box::new(WebFingerAdapter::new()),
        Box::new(GopherAdapter::new()),
        Box::new(SpartanAdapter::new()),
        Box::new(NexAdapter::new()),
        Box::new(TextAdapter::new()),
        Box::new(ScrollAdapter::new()),
        Box::new(ScorpionAdapter::new()),
        Box::new(KeplerAdapter::new()),
        Box::new(MoleratAdapter::new()),
        Box::new(GuppyAdapter::new()),
        Box::new(DictAdapter::new()),
        Box::new(TitanAdapter::new()),
        // Raw-mode HTTP is handled by the webview (invariant #10); this adapter
        // drives reader-mode extraction + the raw-mode adblock interception.
        // One instance per scheme (http + https); both are prefix-less defaults.
        Box::new(HttpAdapter::new()),
        Box::new(HttpAdapter::with_scheme(
            hypernext_http::FetchPolicy::default(),
            "http",
        )),
    ]
}
