//! Per-protocol adapters wrapping the smolnet protocol crates (ADR 0006).
//!
//! Each adapter implements [`crate::Protocol`] and returns a
//! `hypernext_core::PageDoc` so UI code never knows which protocol it renders.

pub mod finger;
pub mod gemini;
pub mod webfinger;

pub use finger::FingerAdapter;
pub use gemini::GeminiAdapter;
pub use webfinger::WebFingerAdapter;
