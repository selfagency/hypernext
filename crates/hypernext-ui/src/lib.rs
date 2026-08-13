//! Native GTK4 UI crate for Hypernext (Phase 3, task p3-t6).
//!
//! Renders a protocol-agnostic [`PageDoc`](hypernext_core::PageDoc) into a tree
//! of native GTK4 widgets for the reader-mode view:
//!
//! - [`document_view`] renders the document body (promoted Phase 2
//!   `spike_textview` approach: a single `GtkTextView` + tagged
//!   `GtkTextBuffer`, giving cross-block text selection) and wires link
//!   activation to a navigator callback.
//! - [`reader_view`] composes the full reader page: a metadata header (title,
//!   author, date, PGP shield, share, read-state) plus the document body, with
//!   featured-image deduplication and raw-webview dispatch.
//! - [`style`] applies the GtkTextTag styling (CSS-driven reader chrome).
//!
//! The GTK-facing widget assembly is display-gated and `#[ignore]`d in tests
//! (per ADR 0005 / `docs/references/gtk-testing.md`); all decision logic is
//! split out as pure, unit-testable functions.

pub mod document_view;
pub mod reader_view;
pub mod style;
