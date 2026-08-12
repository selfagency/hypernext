//! Hypernext protocol layer.
//!
//! Home of the `Protocol` trait, the `Dispatcher`, and the per-protocol adapters
//! that wrap the smolnet protocol crates (ADR 0006). Each adapter returns a
//! `hypernext_core::PageDoc` through the shared `Protocol` trait so UI code never
//! knows which protocol it is rendering (Phase 2, `docs/phases/02-smolnet-protocols.md`).
//!
//! This crate currently only carries the 10 smolnet protocol crate dependencies
//! (task p2-t1). The `Protocol` trait and dispatcher are added in later Phase 2 tasks.
