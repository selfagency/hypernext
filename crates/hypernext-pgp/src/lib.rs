//! # hypernext-pgp — OpenPGP verification for smolnet content
//!
//! Verifies clearsign and detached PGP signatures, resolves signing keys
//! through a lookup chain (embedded → finger:// → keys.openpgp.org), and pins
//! signer fingerprints per host using a Trust-On-First-Use (TOFU) key store.
//!
//! ## CRITICAL INVARIANT — verification runs BEFORE extraction (ethics B-09)
//!
//! **PGP verification operates on the raw response bytes exactly as received
//! from the wire, and it MUST run before any extraction, parsing, or
//! rendering of the document.**
//!
//! The original Bean (Wails) had a bug where `checkPGP` ran *after* content
//! extraction — an attacker who could modify the post-extraction bytes (e.g.
//! by smuggling them past the parser) would bypass verification entirely. We
//! must NOT reproduce that bug.
//!
//! Concretely, the caller (a protocol adapter, Phase 2 t8) MUST:
//! 1. Receive the raw response bytes.
//! 2. Call [`verify_clearsign`] or [`verify_detached`] on those **raw bytes**
//!    *before* handing them to any HTML/gemtext/markdown parser.
//! 3. Only after verification do the extraction/parsing/rendering.
//! 4. Record the resulting [`Verification`] on the `PageDoc.signature`.
//!
//! [`extract_clearsign_blocks`] is the one allowed pre-verification pass: it
//! finds the armored block boundaries on the raw bytes so rpgp can be given
//! the exact block (rpgp rejects leading bytes). It does **not** decode the
//! document body.
//!
//! This invariant is enforced by an integration test that uses a tracing hook
//! to assert a `pgp.verify` event is emitted before a `content.extract` event.

pub mod error;
pub mod lookup;
pub mod tofu;
pub mod verify;

pub use error::PgpError;
pub use lookup::{KeyLookup, KeySource, ResolvedKey};
pub use tofu::{TofuStore, apply_tofu};
pub use verify::{
    ClearsignBlock, Verification, extract_clearsign_blocks, extract_signature_link,
    verify_clearsign, verify_detached,
};
