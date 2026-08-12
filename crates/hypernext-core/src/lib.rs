//! Hypernext core: shared types and the unified error type (ADR 0009).

pub mod error;
pub mod types;

pub use error::{HypernextError, ParseError};
pub use types::{
    Block, DebugInfo, HttpRequestDebug, HttpResponseDebug, Metadata, PageDoc, PgpInfo,
    PgpKeySource, PgpStatus, RedirectHop, Span, SpanRun, SpanStyle, TimingDebug, TlsDebug,
};
