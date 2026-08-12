# Protocol Crate API Audit (p2-t-audit)

> Task: p2-t-audit — audit the API fitness of all 12 smolnet protocol crates BEFORE the adapters are built on them. De-risks R1 (0.1.0 crates have fundamental API gaps).
> Method: read each crate's source at the pinned version from the cargo registry (`~/.cargo/registry/src/index.crates.io-*/`), not just docs.rs — these are fresh 0.1.0 crates and the source is authoritative.
> Date: 2026-08-12. Status: complete. (10 crates initial + finger/dict added 2026-08-12.)

## Summary verdict

| Crate | Verdict |
|---|---|
| gemini-protocol 0.1.2 | **Ready to wrap** — TOFU built-in, proper errors, tokio |
| scroll-protocol 0.1.0 | **Ready to wrap** — TOFU via gemini, proper errors, tokio |
| spartan-protocol 0.1.1 | **Ready to wrap** — plaintext, proper errors, tokio, has timeout+max_body |
| nex-protocol 0.1.1 | **Ready to wrap** — plaintext, proper errors, tokio, has timeout+max_body |
| gopher-protocol 0.1.2 | **Ready to wrap** — proper errors, tokio, accept-any TLS (no TOFU convention) |
| guppy-protocol 0.1.1 | **Ready to wrap** — proper errors, tokio, has timeout. **NOTE: it is smolweb-over-UDP, NOT Molerat (see discrepancy below)** |
| scorpion-protocol 0.1.0 | **Ready to wrap** — BEST TLS injection (`connect_with` verifier), proper errors, tokio |
| kepler-protocol 0.1.0 | **Ready to wrap** — proper errors, tokio, accept-any TLS (needs TOFU wrap) |
| titanite 0.3.2 | **Needs full wrapping** — pure wire codec, no network, no async, anyhow errors |
| text-protocol 0.1.0 | **Ready to wrap** — proper errors, tokio, accept-any TLS (needs TOFU wrap) |
| finger-protocol 0.1.1 | **Ready to wrap** — Finger raw-TCP client + WebFinger URL-builder/JRD-parser (no HTTP stack; adapter owns the HTTPS GET), proper errors, tokio |
| dict-protocol 0.1.0 | **Ready to wrap** — command-loop Session (not one-shot); `Session::over(any_async_stream)` lets adapter inject TLS+SSRF; proper errors, tokio |

**No crate requires an upstream PR to be usable.** Every gap (cancellation, SSRF, TOFU for some) is wrappable in the adapter. Optional upstream PRs are listed per-crate below.

---

## Per-crate audit

Legend: ✅ = present / clean, ⚠️ = present but needs adapter work, ❌ = absent (adapter must supply), N/A = not applicable.

### gemini-protocol 0.1.2

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw `tokio::net::TcpStream` + rustls. SSRF must be a pre-connect adapter check. |
| Custom TLS config | ⚠️ | TOFU built-in via `set_trust_store(Arc<dyn TofuStore>)` (process-wide) + `tofu_connect` pinning. No per-connection `ClientConfig` injection, but Hypernext's TOFU need is met by installing a durable `TofuStore`. |
| Error types | ✅ | `enum ClientError { BadUrl, Connect, Io, Protocol, CertificateChanged }` — proper enum, `Display` + `Error`. |
| Cancellation | ❌ | No token. `fetch_url` reads to EOF. Adapter must wrap in `tokio::select!` with `CancellationToken`. |
| Response → PageDoc | ✅ | `Response { status, code, meta, body }` + `gemtext::parse` → `Vec<GemLine>`. Clean: status→PageDoc handling, body→gemtext→`Block`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Genuine** — uses let-chains (`if let ... && let Some(...)`, client.rs:263,278), stabilized in 1.88. |

**Adapter work:** install durable `TofuStore` at startup; wrap fetch in cancel-select; pre-connect SSRF check; map `ClientError` → `Error`; gemtext → `Block`.

### scroll-protocol 0.1.0

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw TCP + TLS. SSRF = adapter pre-check. |
| Custom TLS config | ⚠️ | Rides `gemini_protocol::tofu_connect` — TOFU via gemini's shared `TofuStore`. No injection, but TOFU met via gemini store. |
| Error types | ✅ | `enum ClientError` (mirrors gemini's) — proper enum, `Display` + `Error`. |
| Cancellation | ❌ | No token. Adapter must wrap in cancel-select. |
| Response → PageDoc | ✅ | `Response { header: Header, body }` + `scrolltext::parse`. Header carries author/published/modified → maps to `Metadata`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — no 1.88 feature used; real floor is edition 2024 (1.85). Inherits 1.88 from smolweb workspace. |

**Adapter work:** install gemini `TofuStore`; wrap in cancel-select; SSRF pre-check; scrolltext → `Block`.

### text-protocol 0.1.0

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw TCP + TLS. SSRF = adapter pre-check. |
| Custom TLS config | ❌ | `fetch_tls` uses internal `AcceptAny` verifier, no injection. TLS is stated as "confidentiality, not peer authentication" (by design). Adapter must add TOFU if desired. |
| Error types | ✅ | `enum ClientError { BadUrl, Connect, Io, Protocol }` — proper enum. |
| Cancellation | ❌ | No token. Adapter must wrap in cancel-select. |
| Response → PageDoc | ✅ | `Response { header, body }` + `parse_body` → `Vec<Line>`. Simple: text→`Block::Paragraph` (preformatted), `=>` links→`Block::Link`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — no 1.88 feature; real floor edition 2024 (1.85). |

**Adapter work:** wrap in cancel-select; SSRF pre-check; optional TOFU (adapter-side pinning verifier); text → `Block`.

### finger-protocol 0.1.1 (Finger + WebFinger)

Two protocols behind two features (both on by default): Finger (RFC 1288, `client` feature, raw TCP port 79) and WebFinger (RFC 7033, `webfinger` feature, HTTPS).

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | ⚠️ | **Finger** has no reqwest — raw `TcpStream::connect((host, port))` (client.rs:84). SSRF = adapter pre-check. **WebFinger** deliberately has NO HTTP stack (lib.rs:26-29): it exposes only `request_url()` (well-known URI builder) + `parse()` (JRD JSON parser); the HTTPS GET is the caller's job. Adapter owns the WebFinger GET via its HTTP client (reqwest) → routes through `FetchPolicy::check_url`. |
| Custom TLS config | N/A | Finger is plaintext (no TLS). WebFinger's TLS is the adapter's HTTP client's concern (TOFU/pinning applied there if needed). |
| Error types | ✅ | Finger `enum ClientError { BadUrl, Connect, Io }` — proper enum, `Display` + `Error`. WebFinger `parse` returns `serde_json::Error`. No `Box<dyn Error>`. |
| Cancellation | ❌ | `fetch` reads to EOF (client.rs:91-95). Adapter must wrap in `tokio::select!` with `CancellationToken`. |
| Response → PageDoc | ✅ | Finger `Response { body: Vec<u8> }` — free-form text (RFC 1288 has no structure) → `Block::Paragraph` (preformatted). WebFinger `Jrd { subject, aliases, properties, links }` + `Link { rel, href, ... }` → map `links` to `Block::Link`, subject/aliases → `Metadata`. 404/missing subject → adapter `Error`. |
| Async runtime | ✅ | tokio exclusively (client feature). |
| rust-version | 1.88 | **Declared only** — edition 2024; no 1.88-specific feature; real floor 1.85. |

**Adapter work:** Finger — pre-connect SSRF check on resolved IP, wrap in cancel-select, map `Response.body` → `Block`. WebFinger — adapter owns the HTTPS GET via reqwest (SSRF at `FetchPolicy`), sets `Accept: application/jrd+json`, calls `request_url()` + `parse()`, maps JRD links → `Block::Link`. WebFinger feature flag: `finger-protocol` `webfinger` feature must be enabled (default on) to expose `Jrd`/`request_url`/`parse`. Optional TOFU for Finger plaintext not applicable; for WebFinger HTTPS, adapter's HTTP client TLS policy applies.

### dict-protocol 0.1.0 (DICT, command loop)

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | ⚠️ | No reqwest. `Session<TcpStream>::connect(host, port)` does its own `TcpStream::connect` (client.rs:69) → SSRF = adapter pre-check. **Key escape hatch:** `Session::over(stream)` is transport-independent, accepting ANY `AsyncRead + AsyncWrite + Unpin` (client.rs:76-84) — adapter can inject an SSRF-checked and/or TLS-wrapped stream before `over()`. |
| Custom TLS config | ✅ | Via `Session::over` — DICT rides an encrypted carrier (client.rs:82-84). Adapter wraps its own TLS stream (pinning/TOFU verifier) and passes it to `over()`. No `dicts://` in the crate; adapter adds TLS entirely. |
| Error types | ✅ | `enum ClientError { Connect, Io, Protocol, Refused { code, text } }` — proper enum, `Display` + `Error`, carries server refusal code. |
| Cancellation | ❌ | No token. Adapter must wrap each `Session` command in `tokio::select!` (or time out reads). `MAX_LINE` cap (1024) bounds command length; no read timeout in crate. |
| Response → PageDoc | ⚠️ | **Command-loop, not one-shot fetch.** `define(db, word)` → `Vec<Definition { word, database, database_description, text: Vec<String> }>`; `matches()` → `Vec<Match>`; `databases()`/`strategies()` → listings. Adapter maps `Definition.text` → `Block::Paragraph`, `Match` → `Block::Link`. No match is an empty vector (552 is an answer, client.rs:23-24,148-150). |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — edition 2024; no 1.88-specific feature; real floor 1.85. |

**Adapter work (command-loop shape):** DictAdapter holds an open `Session` across a tab/query lifetime rather than a one-shot fetch — connect (SSRF-checked host) → `define`/`matches` → map results to `PageDoc`, `QUIT` on drop. Because the crate exposes `Session::over`, the adapter can (a) pre-check SSRF, (b) wrap the stream in TLS (TOFU if required) before `over()`. Wrap each command in cancel-select. No-match (552) → empty `PageDoc`, not an error. This is the only adapter in the set whose fetch is a stateful multi-command session, not a single request/response.

### spartan-protocol 0.1.1

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Plaintext TCP. SSRF = adapter pre-check. |
| Custom TLS config | N/A | Plaintext protocol, no TLS. |
| Error types | ✅ | `enum ClientError { BadUrl, Io, Timeout, Protocol, BodyTooLarge }` — proper enum. |
| Cancellation | ⚠️ | No token, but has per-step `tokio::time::timeout` (connect/write/read) + `max_body` cap. Adapter still wraps in cancel-select for cooperative cancel. |
| Response → PageDoc | ✅ | `Response { status, meta, body }` + `submit` for `=:` prompt flow. Body is gemtext → `Block`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | — | Not declared (no `rust-version` key). Builds on 1.83. |

**Adapter work:** wrap in cancel-select; SSRF pre-check; gemtext → `Block`; `submit` for input prompts.

### nex-protocol 0.1.1

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Plaintext TCP. SSRF = adapter pre-check. |
| Custom TLS config | N/A | Plaintext protocol, no TLS. |
| Error types | ✅ | `enum ClientError { BadUrl, Io, Timeout, BodyTooLarge }` — proper enum. |
| Cancellation | ⚠️ | No token, but has per-step timeout + `max_body`. Adapter wraps in cancel-select. |
| Response → PageDoc | ⚠️ | `fetch` returns raw `Vec<u8>` (no status). Adapter must parse via `listing` module → `Block::Link`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | — | Not declared. Builds on 1.83. |

**Adapter work:** wrap in cancel-select; SSRF pre-check; parse raw bytes → `Block::Link`.

### gopher-protocol 0.1.2

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw TCP + TLS. SSRF = adapter pre-check. |
| Custom TLS config | ❌ | `gophers://` uses internal `AcceptAny` verifier, no injection. No TOFU convention in gopherspace (documented). Adapter adds TOFU if desired. |
| Error types | ✅ | `enum ClientError { BadUrl, Connect, Io, BadPlusHeader, PlusError }` — proper enum. |
| Cancellation | ❌ | No token, no timeout. Reads to EOF. Adapter must wrap in cancel-select. |
| Response → PageDoc | ✅ | `Response { mime, body }` + `menu::parse` + Gopher+ (`fetch_plus`, `fetch_attributes`). mime→route to menu parser→`Block::Link`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — no 1.88 feature; real floor edition 2024 (1.85). |

**Adapter work:** wrap in cancel-select; SSRF pre-check; optional TOFU; menu → `Block::Link`.

### guppy-protocol 0.1.1 (Molerat)

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. UDP (`tokio::net::UdpSocket`). SSRF = adapter pre-check. |
| Custom TLS config | N/A | UDP protocol, no TLS. |
| Error types | ✅ | `enum ClientError { BadUrl, RequestTooLong, Io, Timeout, Protocol, BodyTooLarge }` — proper enum. |
| Cancellation | ⚠️ | No token, but has overall `timeout` + retransmit. Adapter wraps in cancel-select. |
| Response → PageDoc | ✅ | `GuppyResponse` enum (`Success{mime,body}`, `Prompt`, `Redirect`, `Error`). Body is gemtext → `Block`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | — | Not declared. Builds on 1.83. |

**Adapter work:** wrap in cancel-select; SSRF pre-check; gemtext → `Block`.

### scorpion-protocol 0.1.0

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw TCP + TLS. SSRF = adapter pre-check. |
| Custom TLS config | ✅ | **Best in set.** `tls::connect_with(url, verifier)` takes any `rustls::ServerCertVerifier`. Adapter supplies a pinning verifier directly. Also `base_config(verifier)` + `accept_any_verifier()`. |
| Error types | ✅ | `enum ClientError { Io, Response, Url, BodyTooLarge, Truncated }` — proper enum, `source()` impl. |
| Cancellation | ❌ | No token. Adapter must wrap in cancel-select. |
| Response → PageDoc | ⚠️ | `Response { header, body }` + `document` module. Binary blocks → `Block::Raw`; text per type. Adapter maps. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — no 1.88 feature; real floor edition 2024 (1.85). |

**Adapter work:** supply pinning verifier via `connect_with`; wrap in cancel-select; SSRF pre-check; binary blocks → `Block::Raw`.

### kepler-protocol 0.1.0

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | No reqwest. Raw TCP + TLS. SSRF = adapter pre-check. |
| Custom TLS config | ❌ | `keplers://` uses internal `AcceptAny` verifier, no injection. Adapter adds TOFU. |
| Error types | ✅ | `enum ClientError { BadUrl, Connect, Io, Protocol }` — proper enum. |
| Cancellation | ❌ | No token. Adapter must wrap in cancel-select. |
| Response → PageDoc | ✅ | `Response { header, body }` + cache info (`cache()`, `mime()`). Body gemtext → `Block`. Cache model maps to `from_cache`. |
| Async runtime | ✅ | tokio exclusively. |
| rust-version | 1.88 | **Declared only** — no 1.88 feature; real floor edition 2024 (1.85). |

**Adapter work:** wrap in cancel-select; SSRF pre-check; TOFU (adapter-side pinning verifier); gemtext → `Block`.

### titanite 0.3.2

| Criterion | Status | Detail |
|---|---|---|
| Injectable client | N/A | **No network at all.** Pure wire-format codec (request/response parse + serialize). |
| Custom TLS config | N/A | No TLS. Adapter does all networking + TLS + TOFU. |
| Error types | ❌ | Uses `anyhow::Result` (`bail!`) in public API — violates ADR 0009 (thiserror for libraries). Adapter must map anyhow → `Error`. |
| Cancellation | N/A | Sync codec, no I/O. Adapter's network layer handles cancellation. |
| Response → PageDoc | ⚠️ | `Response` enum (wire codec: `Certificate`, `Failure`, `Input`, `Redirect`, `Success`). Adapter does the network + maps to `PageDoc`. |
| Async runtime | N/A | **Synchronous** — no async, no tokio. Not a runtime violation (it's a codec, not a runtime user). |
| rust-version | — | Not declared. Builds on 1.83. |

**Adapter work:** **full wrapping** — adapter owns the TCP/TLS connection, TOFU, cancellation, size limits, and maps `anyhow` errors → `Error`. Titanite only provides the request/response wire format. This is the heaviest wrap of the set.

---

## ⚠️ Protocol identity discrepancy (guppy ≠ Molerat)

The phase doc (`02-smolnet-protocols.md` §3.2) and worklog t2 label `guppy-protocol` as "Molerat (guppy://), TLS, mtxt/gemtext rendering, TOFU". **This is wrong.** The `guppy-protocol` crate is dimkr's **smolweb-over-UDP** protocol (UDP port 6775, chunking/ack/retransmit) — a different protocol from jcs's **Molerat** (TLS, mtxt).

- `guppy-protocol` crate: `guppy://` over UDP, no TLS, no TOFU. (src/lib.rs:3-6)
- Molerat (jcs): TLS, mtxt/gemtext, TOFU — **no crate in this set implements it**.

**Impact:** if Hypernext 1.0 must support Molerat, a crate is missing (needs a first-party adapter or a different crate). If `guppy://` (UDP) is the intended protocol, the phase doc's Molerat notes (TLS/TOFU/mtxt) are inapplicable and the adapter is plaintext-UDP. **Resolve which protocol is in scope before building the guppy adapter.**

---

## Cross-cutting adapter requirements (apply to ALL 12)

1. **SSRF pre-check (all).** None route through `reqwest::Client`; all do their own DNS via `TcpStream::connect((host, port))` / `UdpSocket`. The adapter MUST resolve the host and check the target IP against `FetchPolicy::block_private_network` BEFORE calling the crate's fetch. This is the SSRF defense point for smolnet protocols (invariant #8).
2. **Cancellation (all).** None accept a `CancellationToken`. Adapter wraps each fetch in `tokio::select!` with the token; dropping the future cancels the underlying I/O. spartan/nex/guppy already have internal timeouts; gemini/scroll/text/gopher/scorpion/kepler/finger read to EOF with no timeout, and dict's `Session` commands do too — the cancel-select is mandatory for these.
3. **TOFU (gemini, scroll, text, gopher, kepler).** gemini + scroll have built-in TOFU (via `TofuStore`). text/gopher/kepler use accept-any TLS with no injection — adapter supplies a pinning verifier if TOFU is required. scorpion already exposes `connect_with(verifier)`.
4. **Error mapping (all).** Every crate's `ClientError` is a proper enum; adapter maps to `hypernext_core::Error`. titanite's `anyhow` is the only exception.

---

## Rust-version assessment (the 1.88 flag)

**Finding: the 1.88 declaration is NOT purely cosmetic — it is a real MSRV conflict with Hypernext's 1.83.**

- All 8 flagged crates (gemini, scroll, text, gopher, scorpion, kepler, finger, dict) use **edition 2024**, which requires **Rust ≥ 1.85**. This alone breaks Hypernext MSRV 1.83.
- **gemini-protocol additionally uses let-chains** (`if let ... && let Some(...)`, client.rs:263,278), stabilized in **Rust 1.88**. So gemini genuinely requires 1.88.
- The other 7 (scroll, text, gopher, scorpion, kepler, finger, dict) use **no 1.88-specific feature** — their real floor is 1.85 (edition 2024). They inherit the 1.88 declaration from the smolweb workspace's conservative `rust-version.workspace = true`.
- The 4 unflagged crates (spartan, nex, guppy, titanite) declare no `rust-version` and build on 1.83.

**Is it a blocker?** Yes, for MSRV 1.83. Edition 2024 alone forces ≥1.85, and gemini forces ≥1.88.

**Recommendation:** raise Hypernext MSRV to **1.88** (single coherent target that covers gemini's let-chains and all 8 crates' edition 2024). This is a documented decision, not silent drift. Update:

- `Cargo.toml` `[workspace.package] rust-version = "1.88"`
- CI toolchain pin to 1.88+ (local 1.97.1 already builds fine)
- `AGENTS.md` §1 "Rust 1.83+" → 1.88+

Do NOT patch the 5 crates to edition 2021 to preserve 1.83 — that is upstream work for zero benefit; 1.88 is a reasonable MSRV for a 2026 project.

---

## Upstream PR candidates (optional, none blocking)

| Crate | PR idea | Priority |
|---|---|---|
| gemini/scroll/text/gopher/kepler | Add `connect_with(verifier)`-style TLS injection (scorpion already has it); dict already has the equivalent via `Session::over` | Low — adapter can supply verifier |
| all 9 smolweb crates | Accept a `CancellationToken` in `fetch` (finger + dict too) | Low — adapter cancel-select works |
| titanite | Replace `anyhow` with a `thiserror` enum in public API (ADR 0009) | Medium — adapter maps it anyway |
| smolweb workspace | Lower `rust-version` to 1.85 for the 5 non-gemini crates | Low — Hypernext targets 1.88 anyway |

---

## References

- Phase doc: `docs/phases/02-smolnet-protocols.md` §3.2 (hardening requirements)
- `PageDoc`/`Block`/`Metadata`: `crates/hypernext-core/src/types.rs`
- ADR 0006 (direct deps), ADR 0008 (tokio), ADR 0009 (thiserror/anyhow)
- Crate sources: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/<crate>-<version>/`
