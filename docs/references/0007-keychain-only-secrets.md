# ADR 0007 — Keychain-Only Secrets

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** None (carries forward Bean ADR 0001's keychain rule)
- **Related:** `0003-authority-model.md`, `docs/phases/01-foundation-and-architecture.md` §2.4

## Context

Hypernext handles secrets:

- IndieAuth tokens (per-website)
- Micropub tokens (per-endpoint)
- ATProto app passwords (per-account)
- Mastodon OAuth tokens
- Nostr private keys (per-identity)
- Matrix access tokens
- Solid OIDC tokens
- WebSub hub secrets
- PGP key passphrases (if any)
- Tor client auth keys
- Sync ECDH private keys

These secrets must never be stored in plaintext. The Wails version had a hard-won lesson: an early "Base64-as-encryption" fallback was identified and removed during the incognito hardening audit. We will not repeat that mistake.

## Decision

**The OS keychain is the only secret store. Hypernext uses the `keyring` crate (v4.1.6) for cross-platform access. There is no plaintext fallback, no Base64-as-encryption, no SQLite/JSON/localStorage secret path.**

### Implementation

- `hypernext-keychain` crate wraps the `keyring` crate
- Service name: `com.selfagency.hypernext`
- Account name convention: `<feature>.<id>` e.g. `indieauth.https://example.com`, `micropub.https://blog.example.com/micropub`, `solid.https://pod.example.com/profile/card#me`
- API:
  - `set(secret: &Secret, value: &str) -> Result<(), KeychainError>`
  - `get(secret: &Secret) -> Result<String, KeychainError>` (returns `NotFound` if missing)
  - `delete(secret: &Secret) -> Result<(), KeychainError>`
  - `exists(secret: &Secret) -> bool`

### What this means in practice

- The UI never sees a token's value. The UI sees `exists()` (true/false) and `set()` (writes a value the UI gets from a user input or an OAuth callback).
- Tokens are read at call time — never cached in process memory longer than necessary. A protocol adapter that needs a token reads it from the keychain, uses it for the request, and lets the `String` go out of scope.
- Incognito windows never read the keychain. If a feature requires a secret and the window is incognito, the feature is disabled (button greyed out with tooltip).
- Destructive secret-delete operations (`ResetSettings`, `LogoutAccount`) require explicit confirmation in the UI, not just a button press.

### What this rules out

- ❌ Storing tokens in `settings` table (even if "encrypted" with a hardcoded key)
- ❌ Caching tokens in `tokio::sync::RwLock<String>` for the lifetime of the app — read per-use
- ❌ Logging token values even at `trace` level
- ❌ Passing token values to debug views (DebugView shows token presence, never the value)
- ❌ Writing tokens to fixture files in tests — tests use `keyring::set_mock_backend()` instead

## Consequences

### Positive

- Secrets cannot leak to SQLite, logs, or debug views because there is no path that carries them there
- OS-managed access control (macOS Keychain Access prompts, Windows Credential Manager, Linux Secret Service)
- Auditable: a user can open Keychain Access.app and see exactly what Hypernext has stored
- GDPR Art. 5/6/9 compliance is trivially satisfied — secrets are local, encrypted at rest by the OS, never transmitted

### Negative / accepted costs

- macOS keychain prompts on first use (annoying but correct). User must authorize once per secret.
- CI testing requires `security unlock-keychain` or a test keychain — documented in `docs/references/keychain-testing.md`
- Some platforms (Linux without `gnome-keyring` or `kwallet`) have no keychain — Hypernext fails gracefully (the feature is unavailable, not silently broken)
- `tokio::task::spawn_blocking` is required for keychain calls (the `keyring` crate is sync). Minor overhead.

**Non-conformance is a release blocker.** Any change that introduces a plaintext secret path, a Base64 fallback, or a SQLite-based secret store violates this ADR and fails CI.

## Cross-references

- The original Bean's ADR 0001 §4 (consult upstream)
- The original Bean's `docs/plans/2026-08-03-incognito-hardening/logs/keychain-audit.md` (consult upstream — the audit that found 6 ungated secret-write bindings)

## References

- `keyring` crate: <https://crates.io/crates/keyring> (v4.1.6)
- keyring docs: <https://docs.rs/keyring/latest/keyring/>
- macOS Keychain Services: <https://developer.apple.com/documentation/security/keychain_services>
- Windows Credential Manager: <https://learn.microsoft.com/en-us/windows/win32/secauthn/credential-manager>
- Linux Secret Service API: <https://specifications.freedesktop.org/secret-service/>
