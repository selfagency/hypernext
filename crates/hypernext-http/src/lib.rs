//! `hypernext-http`: HTTP fetch policy and client core.
//!
//! Provides SSRF-defense URL validation ([`policy`]), a policy-bound
//! [`reqwest::Client`] builder ([`client`]), and a bounded streaming reader
//! that aborts past `max_response_size` (no ReadAll overflow).

pub mod client;
pub mod error;
pub mod extract;
pub mod policy;

pub use client::{build_client, fetch_body, BoundedReader};
pub use error::Error;
pub use extract::{extract_doc, fetch_and_extract};
pub use policy::{check_url, check_url_with_resolver, FetchPolicy, SystemDns};
