# Testing the Keychain in CI

The `hypernext-keychain` crate wraps the OS keychain via the `keyring` crate
(ADR 0007). This document explains how its tests run in CI and how to handle
the macOS keychain permission prompt.

## How the unit tests avoid the real keychain

Per ADR 0007, tests **never** touch the real keychain and never write secrets
to fixture files. They use `keyring`'s in-memory mock store:

```rust
// Order matters: trigger keyring's one-time v1 store init (which installs the
// real platform store), then override with the mock store.
let _ = keyring::Entry::store_status();
keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
```

- `keyring::Entry::store_status()` forces the crate's `LazyLock` to run once,
  installing the platform store.
- `keyring_core::set_default_store(...)` then replaces it with the in-memory
  mock store, so all subsequent `Entry::new` calls hit the mock.
- The mock store is process-local and non-persistent; each test run starts
  clean. Tests use a `std::sync::Once` to install the mock exactly once.

Because the mock store is used, the unit tests are **platform-independent and
hermetic** — they do not require a keychain, a GUI session, or any permission
prompt. They run identically on macOS, Linux, and Windows CI runners.

## macOS: the first-run permission prompt

The macOS Keychain (Keychain Services) may prompt for permission the first
time a process accesses it. This only matters for **manual / integration**
testing against the real keychain — the unit tests above never trigger it.

If you run a real-keychain smoke test on a fresh macOS machine or CI runner:

1. **Unlock the login keychain** so the process can access it non-interactively:

   ```sh
   security unlock-keychain -p "$KEYCHAIN_PASSWORD" ~/Library/Keychains/login.keychain-db
   ```

   In CI, store the keychain password in a secret (e.g. GitHub Actions
   `secrets.KEYCHAIN_PASSWORD`).

2. **Accept the prompt once and cache the authorization.** The first access
   may still show a GUI prompt. On a headless CI runner there is no GUI, so
   either:
   - pre-authorize the test binary with `security authorizationdb` rules, or
   - run the smoke test once interactively on a machine with a GUI, accept the
     prompt, and rely on the cached authorization for subsequent runs.

3. **Keep the keychain unlocked for the job** (macOS may re-lock it):

   ```sh
   security set-keychain-settings -l ~/Library/Keychains/login.keychain-db
   ```

## CI recommendation

- **Unit tests** (`cargo test -p hypernext-keychain`): run on every PR. They
  use the mock store and need no keychain setup.
- **Real-keychain smoke test** (optional, manual or nightly): run on a macOS
  runner with the keychain unlocked as above. If a test hangs on a permission
  prompt, mark it `#[ignore]` with a comment explaining why (per AGENTS.md
  §13.3 — do not delete flaky tests).

## Gates

All checks must pass before commit:

```sh
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
cargo deny check
```
