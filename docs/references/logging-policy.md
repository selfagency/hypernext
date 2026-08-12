# Logging Policy

Applies to all crates in the Hypernext workspace. Every log line written from
Hypernext code must comply.

## Framework

- `tracing` 0.1 + `tracing-subscriber` 0.3, initialized once in
  `crates/hypernext-app/src/logging.rs` via `init_tracing()`.
- Subscriber is set up at app startup in `main.rs`, before the app shell runs.
  Task t8 (shell) calls `init_tracing()` — keep the init as a single separable
  function.

## Runtime configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `RUST_LOG` | Level filter (e.g. `debug`, `hypernext_app=debug`) | `info` |
| `HYPERNEXT_LOG_FORMAT` | Set to `json` for structured JSON output | plain text |

- Output goes to **stderr** by default; structured JSON when
  `HYPERNEXT_LOG_FORMAT=json`.
- `RUST_LOG` uses `tracing-subscriber`'s `EnvFilter` syntax, so both global
  levels and per-module filters (`crate_name=debug`) are supported.

## Log levels

| Level | Use for |
|-------|---------|
| `error` | User-visible failures, panics, unrecoverable conditions |
| `warn` | Recoverable failures (e.g. falling back to a default) |
| `info` | App lifecycle: started, opened URL, shutdown, first-run migrations |
| `debug` | Per-protocol request/response summaries (off by default) |
| `trace` | Byte-level detail, full payload dumps (off by default) |

`debug` and `trace` are **off by default**. Only enable them during
development or targeted debugging.

## Secrets (MANDATORY)

**Never log secrets.** This includes, but is not limited to:

- passwords and passphrases
- API keys, tokens, session cookies
- private keys and their material
- IndieAuth / Micropub / Solid credentials
- any value that would let an attacker impersonate the user

Rules:

1. Do not pass a secret to `tracing::info!`, `debug!`, `warn!`, `error!`,
   `tracing::field`, or any `Display`/`Debug` formatting that reaches the log.
2. Wrap any secret you must reference in a log line with the redaction helper:

   ```rust
   tracing::info!(auth = tracing::field::display(Redacted(token)), "sending request");
   ```

   `Redacted<T>` (in `crates/hypernext-app/src/logging.rs`) renders as
   `<redacted>` no matter what it wraps. It never prints the underlying value.
3. Do not `Debug`-print a struct that contains secret fields. If a struct holds
   a secret, implement `Display`/`Debug` manually to redact that field, or log
   it via `Redacted`.
4. Treat URLs as sensitive when they carry credentials
   (`https://user:pass@host/...`) — redact the userinfo component.

## Hygiene

- Use structured fields (`tracing::info!(field = value, "...")`) rather than
  string interpolation when the value is data, so JSON output stays parseable.
- Keep messages terse and stable; downstream tooling may match on them.
- Prefer `?`/error propagation; log at the point a failure becomes
  user-relevant, not at every layer of the stack.
