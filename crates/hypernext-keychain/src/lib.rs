//! OS keychain integration for Hypernext (ADR 0007).
//!
//! The OS keychain is the ONLY secret store. There is no plaintext fallback,
//! no Base64-as-encryption, no SQLite/JSON/localStorage secret path.
//!
//! Service name: `com.selfagency.hypernext`
//! Account namespace: `<feature>.<id>` e.g. `micropub.https://example.com`

mod error;

pub use error::KeychainError;

/// The keychain service name for all Hypernext secrets (ADR 0007).
pub const SERVICE: &str = "com.selfagency.hypernext";

/// A named secret in the OS keychain.
///
/// `service` is fixed to [`SERVICE`]; `account` follows the `<feature>.<id>`
/// convention, e.g. `micropub.https://example.com`.
#[derive(Debug)]
pub struct Secret {
    service: &'static str,
    account: String,
}

impl Secret {
    /// Create a secret for the given feature and id.
    ///
    /// Returns `Err(KeychainError::InvalidInput)` if `account` is empty.
    pub fn new(feature: &str, id: &str) -> Result<Self, KeychainError> {
        if feature.is_empty() || id.is_empty() {
            return Err(KeychainError::InvalidInput);
        }
        let account = format!("{feature}.{id}");
        Ok(Self {
            service: SERVICE,
            account,
        })
    }
}

/// Store `value` for `secret`, replacing any existing value.
pub fn set(secret: &Secret, value: &str) -> Result<(), KeychainError> {
    let entry = keyring_core::Entry::new(secret.service, &secret.account)?;
    entry.set_password(value)?;
    Ok(())
}

/// Read the value stored for `secret`.
///
/// Returns `Err(KeychainError::NotFound)` if no secret is stored.
pub fn get(secret: &Secret) -> Result<String, KeychainError> {
    let entry = keyring_core::Entry::new(secret.service, &secret.account)?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring_core::Error::NoEntry) => Err(KeychainError::NotFound),
        Err(e) => Err(KeychainError::Keyring(e)),
    }
}

/// Delete the secret stored for `secret`.
///
/// Deleting a missing secret is a no-op (returns `Ok`).
pub fn delete(secret: &Secret) -> Result<(), KeychainError> {
    let entry = keyring_core::Entry::new(secret.service, &secret.account)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(KeychainError::Keyring(e)),
    }
}

/// Whether a secret is currently stored for `secret`.
pub fn exists(secret: &Secret) -> bool {
    get(secret).is_ok()
}

/// Ensure a default credential store is installed (once), then return it.
///
/// If a store is already set (e.g. the in-memory mock installed by tests via
/// `keyring_core::set_default_store`), it is used as-is. Otherwise the real
/// platform store is initialized through keyring v1's one-time init (macOS
/// Keychain, Windows Credential Manager, Linux Secret Service), which sets the
/// default store as a side effect.
///
/// Keyring v1's `Entry::new` is permanently gated on that one-time platform
/// init result: on headless Linux the Secret Service init fails and is cached,
/// so every later `keyring::Entry::new` returns `NoDefaultStore` even after a
/// mock store is set. This crate therefore operates through the ungated
/// `keyring_core::Entry`, which always reads the current default store.
pub fn ensure_default_store() -> Result<(), KeychainError> {
    if keyring_core::get_default_store().is_some() {
        return Ok(());
    }
    // keyring v1's store_status() installs the real platform store into
    // keyring_core's DEFAULT_STORE as a side effect.
    let _ = keyring::Entry::store_status();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    /// Install the in-memory mock store once for all tests (ADR 0007: tests
    /// use the mock backend, never the real keychain).
    ///
    /// The mock is set directly via `keyring_core::set_default_store`. We do
    /// NOT call `keyring::Entry::store_status()` first: that would trigger
    /// keyring v1's one-time platform init, which fails on headless Linux and
    /// caches a `NoDefaultStore` result that permanently blocks all later
    /// `keyring::Entry::new` calls. The operations in this crate read the
    /// store through the ungated `keyring_core::Entry`, so setting the mock
    /// here is sufficient and platform-independent.
    static INIT: Once = Once::new();

    fn init_mock() {
        INIT.call_once(|| {
            keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
        });
    }

    fn secret(feature: &str, id: &str) -> Secret {
        init_mock();
        Secret::new(feature, id).unwrap()
    }

    #[test]
    fn set_get_round_trip() {
        let s = secret("test", "roundtrip");
        set(&s, "hunter2").unwrap();
        assert_eq!(get(&s).unwrap(), "hunter2");
        delete(&s).unwrap();
    }

    #[test]
    fn get_missing_returns_not_found() {
        let s = secret("test", "missing");
        delete(&s).unwrap(); // ensure clean
        match get(&s) {
            Err(KeychainError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn delete_missing_is_noop() {
        let s = secret("test", "delete-missing");
        delete(&s).unwrap(); // no-op, must not error
        assert!(!exists(&s));
    }

    #[test]
    fn exists_false_after_delete() {
        let s = secret("test", "exists-after-delete");
        set(&s, "value").unwrap();
        assert!(exists(&s));
        delete(&s).unwrap();
        assert!(!exists(&s));
    }

    #[test]
    fn set_overwrites_existing() {
        let s = secret("test", "overwrite");
        set(&s, "first").unwrap();
        set(&s, "second").unwrap();
        assert_eq!(get(&s).unwrap(), "second");
        delete(&s).unwrap();
    }

    #[test]
    fn empty_account_is_invalid() {
        match Secret::new("", "") {
            Err(KeychainError::InvalidInput) => {}
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn account_namespace_is_feature_dot_id() {
        let s = Secret::new("micropub", "https://example.com").unwrap();
        assert_eq!(s.account, "micropub.https://example.com");
        assert_eq!(s.service, SERVICE);
    }
}
