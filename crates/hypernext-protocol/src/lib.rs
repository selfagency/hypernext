//! Hypernext protocol layer.
//!
//! Home of the `Protocol` trait, the `Dispatcher`, and the per-protocol adapters
//! that wrap the smolnet protocol crates (ADR 0006). Each adapter returns a
//! `hypernext_core::PageDoc` through the shared `Protocol` trait so UI code never
//! knows which protocol it is rendering (Phase 2, `docs/phases/02-smolnet-protocols.md`).

pub mod adapters;
pub mod dispatcher;

pub use adapters::{
    DictAdapter, FingerAdapter, GeminiAdapter, GopherAdapter, GuppyAdapter, KeplerAdapter,
    NexAdapter, ScorpionAdapter, ScrollAdapter, SpartanAdapter, TextAdapter, TitanAdapter,
    WebFingerAdapter,
};
pub use dispatcher::{
    Capabilities, Dispatcher, FetchContext, FetchPolicy, Protocol, PublishPayload, PublishResult,
    DEFAULT_SCHEME, RECOGNIZED_SCHEMES, SCHEME_HINTS,
};
