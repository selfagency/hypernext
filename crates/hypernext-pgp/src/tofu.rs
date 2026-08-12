//! Trust-On-First-Use (TOFU) key store for smolnet PGP-verified content.
//!
//! The Phase-1 `tofu_pgp_keys` table is keyed by fingerprint (fingerprint ->
//! armored key). PGP TOFU additionally pins a *signer fingerprint per host*
//! (V0002 `tofu_pgp_host_keys`): on first successful verify we store
//! `host -> fingerprint`; on later verifies we compare and report
//! [`Verification::KeyChanged`] on mismatch.
//!
//! This crate defines the minimal [`TofuStore`] trait so verification is
//! unit-testable without pulling `rusqlite` in here. The store crate
//! implements it against `tofu_pgp_host_keys` (wired in Phase 2 t8).

use crate::{PgpError, Verification};

/// Minimal host -> signing-key-fingerprint store.
pub trait TofuStore {
    /// Look up the pinned fingerprint for `host`, if any.
    fn pinned_fingerprint(&mut self, host: &str) -> Result<Option<String>, PgpError>;
    /// Store `host -> fingerprint` (first successful verify).
    fn store_fingerprint(&mut self, host: &str, fingerprint: &str) -> Result<(), PgpError>;
}

/// Apply TOFU pinning after a successful verify: on first contact store the
/// fingerprint; on later contact, return `KeyChanged` if it differs.
pub fn apply_tofu<S: TofuStore>(
    store: &mut S,
    host: &str,
    fingerprint: &str,
) -> Result<Verification, PgpError> {
    match store.pinned_fingerprint(host)? {
        Some(pinned) if pinned.eq_ignore_ascii_case(fingerprint) => Ok(Verification::Valid),
        Some(_) => {
            tracing::warn!(host, fingerprint, "PGP TOFU key rotation detected");
            Ok(Verification::KeyChanged)
        }
        None => {
            store.store_fingerprint(host, fingerprint)?;
            Ok(Verification::Valid)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemTofu {
        map: HashMap<String, String>,
    }

    impl TofuStore for MemTofu {
        fn pinned_fingerprint(&mut self, host: &str) -> Result<Option<String>, PgpError> {
            Ok(self.map.get(host).cloned())
        }
        fn store_fingerprint(&mut self, host: &str, fingerprint: &str) -> Result<(), PgpError> {
            self.map.insert(host.to_string(), fingerprint.to_string());
            Ok(())
        }
    }

    #[test]
    fn first_contact_stores_and_returns_valid() {
        let mut store = MemTofu::default();
        let r = apply_tofu(&mut store, "example.com", "AABB").unwrap();
        assert_eq!(r, Verification::Valid);
        assert_eq!(
            store.map.get("example.com").map(String::as_str),
            Some("AABB")
        );
    }

    #[test]
    fn same_fingerprint_returns_valid() {
        let mut store = MemTofu::default();
        apply_tofu(&mut store, "example.com", "AABB").unwrap();
        let r = apply_tofu(&mut store, "example.com", "AABB").unwrap();
        assert_eq!(r, Verification::Valid);
    }

    #[test]
    fn rotated_key_returns_key_changed() {
        let mut store = MemTofu::default();
        apply_tofu(&mut store, "example.com", "AABB").unwrap();
        let r = apply_tofu(&mut store, "example.com", "CCDD").unwrap();
        assert_eq!(r, Verification::KeyChanged);
        // The stored fingerprint is NOT overwritten on mismatch.
        assert_eq!(
            store.map.get("example.com").map(String::as_str),
            Some("AABB")
        );
    }
}
