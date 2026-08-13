//! `hypernext-http`: HTTP fetch policy and client core.
//!
//! Provides SSRF-defense URL validation ([`policy`]), a policy-bound
//! [`reqwest::Client`] builder ([`client`]), and a bounded streaming reader
//! that aborts past `max_response_size` (no ReadAll overflow).

pub mod adblock;
pub mod client;
pub mod error;
pub mod extract;
pub mod policy;

pub use adblock::{AdblockEngine, FilterListSource, strip_matching};
pub use client::{BoundedReader, build_client, fetch_body};
pub use error::Error;
pub use extract::{
    extract_doc, extract_doc_filtered, fetch_and_extract, fetch_and_extract_filtered,
};
pub use policy::{FetchPolicy, SystemDns, check_url, check_url_with_resolver};
