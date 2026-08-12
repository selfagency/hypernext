# Phase 2 — Smolnet Protocol Adapters

> Phase 2 of the Hypernext 1.0 Hypertext release.
> Prerequisites: Phase 1 complete (workspace, store, keychain, types, CI).
> Estimated duration: 8 weeks (single maintainer, AI-assisted)
> TDD requirement: Yes — every protocol has unit + integration tests; protocol-specific E2E tests come in Phase 5.

---

## 1. Goal

Implement the protocol adapters that make Hypernext a usable smolnet browser: Gemini, Gopher, Finger, Spartan, Nex, Text, Scroll, Molerat, Scorpion, Kepler, Titan (write), PGP verification, and the protocol dispatcher that routes URLs to them. When Phase 2 ships, you can type `gemini://geminiprotocol.net` in the location bar and a real page renders. You can also upload via `titan://` and verify PGP-signed pages.

The single most important outcome of this phase: every protocol adapter returns a `PageDoc` (defined in Phase 1) through the same `Protocol` trait. UI code never knows what protocol it's rendering.

---

## 2. Architecture overview

```text
                    ┌─────────────────────────┐
                    │   hypernext-ui (Phase 4)│
                    │   - location bar        │
                    │   - tab list            │
                    │   - document view       │
                    └────────────┬────────────┘
                                 │ fetch(url)
                                 ▼
                    ┌─────────────────────────┐
                    │   hypernext-protocol     │
                    │   - Protocol trait      │
                    │   - Dispatcher          │
                    │   - normalize_address   │
                    │   - redirect handling   │
                    └────────────┬────────────┘
                                 │ dispatch
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │   gemini     │ │    gopher    │ │    finger    │
        │  (direct)   │ │  (direct)   │ │  (direct)   │
        └──────────────┘ └──────────────┘ └──────────────┘
                ▲                ▲                ▲
                │                │                │
                └────────────────┼────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   hypernext-pgp         │
                    │   - verify(bytes, key)  │
                    │   - key lookup (finger, │
                    │     keys.openpgp.org)   │
                    │   - TOFU pin store      │
                    └─────────────────────────┘
```

---

## 3. Sub-tasks

### 3.1 Add the 0.1.0 smolnet protocol crates as direct dependencies (Week 1)

Per the user's decision (see `docs/references/0006-smolnet-protocol-crates.md`), the fresh 0.1.0 protocol crates (`gemini-protocol`, `scroll-protocol`, `text-protocol`, `spartan-protocol`, `nex-protocol`, `gopher-protocol`, `scorpion-protocol`, `kepler-protocol`, `guppy-protocol`, `titanite`) are used directly from crates.io, pinned in the workspace lockfile. We do not vendor them; upstream breaking changes are handled via the normal dependency-update workflow.

**Action items:**

- [ ] Add each crate to the root `Cargo.toml` `[workspace.dependencies]` block with a pinned version:
  - `gemini-protocol` v0.1.2 — <https://crates.io/crates/gemini-protocol>
  - `scroll-protocol` v0.1.0 — <https://crates.io/crates/scroll-protocol>
  - `text-protocol` v0.1.0 — <https://crates.io/crates/text-protocol>
  - `spartan-protocol` v0.1.1 — <https://crates.io/crates/spartan-protocol>
  - `nex-protocol` v0.1.1 — <https://crates.io/crates/nex-protocol>
  - `gopher-protocol` v0.1.2 — <https://crates.io/crates/gopher-protocol>
  - `scorpion-protocol` v0.1.0 — <https://crates.io/crates/scorpion-protocol>
  - `kepler-protocol` v0.1.0 — <https://crates.io/crates/kepler-protocol>
  - `guppy-protocol` v0.1.1 — <https://crates.io/crates/guppy-protocol>
  - `titanite` v0.3.2 — <https://crates.io/crates/titanite> (Titan — note this is more mature than the others)
- [ ] Run `cargo add` for each crate in the consuming crate (`hypernext-protocol`), pinning the version
- [ ] Verify the lockfile pins the exact resolved versions (`cargo tree -p <crate>`)
- [ ] Confirm no surprise transitive dependencies via `cargo tree`

**TDD gate:**

- Each crate resolves and builds with `cargo build -p hypernext-protocol`
- `cargo metadata --format-version=1` shows all 10 crates as dependencies of `hypernext-protocol`
- `cargo tree -p hypernext-protocol` lists all 10 crates at their pinned versions

### 3.2 Harden each protocol adapter (Weeks 1-4, in parallel with 3.3-3.6)

Each direct dependency is 0.1.0 — fresh, possibly incomplete. We harden our adapters around them to production-grade:

**For each crate, do the following (track per-crate progress in `worklog.md`):**

1. **Read the upstream README + spec.** Each protocol has a spec (Gemini, Gopher RFC 1436, Spartan, Nex, Text, Scroll, Molerat, Scorpion, Kepler, Titan). Read the spec in full before touching the code. See §5.1 for URLs.
2. **Audit the crate's API.** Does it expose:
   - `async fn fetch(url: &Url) -> Result<ProtocolResponse, Error>`?
   - A way to inject our `reqwest::Client` (so SSRF policy applies)?
   - A way to inject a custom TLS config (for TOFU)?
   - Proper error types (not `Box<dyn Error>`)?
3. **Add tests.** Each crate needs at least:
   - Unit tests for every public function
   - Integration tests against an in-process mock server (`tokio::net::TcpListener` for plaintext protocols, `tokio-rustls` for TLS protocols)
   - Fixture files in `tests/fixtures/` — real captured responses for happy path, malformed, edge cases
   - Coverage ≥70% line
4. **Add doc comments** to every public API. Doc tests (`cargo test --doc`) must pass.
5. **Document deviations** from the spec in `worklog.md`. Any deviation must have a written rationale.
6. **If the crate is missing a capability** (TOFU, cancellation, custom TLS config), open an upstream PR or wrap it in our adapter — do not fork the crate preemptively.

**Per-protocol notes:**

| Protocol | Spec URL | Notes |
|---|---|---|
| Gemini | <https://geminiprotocol.net/> | TLS with TOFU; gemtext format; status codes 1x-6x; client certs |
| Gopher | <https://www.rfc-editor.org/rfc/rfc1436> | RFC 1436; Gopher+ attributes; RFC 4266 URLs |
| Spartan | <https://portal.mozest.com/protocol/spartan> | Plaintext TCP; `=:selector\tquery` for input; no TLS |
| Nex | <https://nightfall.city/nex/> | Plaintext TCP; `=>` link lines |
| Text | <https://textprotocol.org/> | Plain TCP + TLS; minimal status codes; text/plain |
| Scroll | <https://scrollprotocol.com/> | TLS; scrolltext format; UDC classification |
| Molerat | <https://github.com/jcs/molerat> | TLS; mtxt/gemtext rendering; TOFU |
| Scorpion | <https://github.com/jcs/scorpion> | 4 subprotocols (receive, send, interactive, meta); binary block format |
| Kepler | (in gemrendr README; cite upstream) | Gemini's shape + cache model with declared body lengths |
| Titan | <https://community.gemini-protocol.com/protocol/titan> | Upload via TLS; size limits; progress/cancel |
| Finger | <https://www.rfc-editor.org/rfc/rfc1288> | RFC 1288; `/W` verbose; structured Plan section |
| WebFinger | <https://www.rfc-editor.org/rfc/rfc7033> | RFC 7033; `/.well-known/webfinger`; rel links |

### 3.3 The `Protocol` trait and dispatcher (Week 2)

Define the protocol trait in `hypernext-protocol`. Every adapter (direct dependency or first-party) implements it.

**References to consult before writing code:**

- Rust API Guidelines on traits: <https://rust-lang.github.io/api-guidelines/interoperability.html>
- The original Bean's `internal/protocol/types.go` and `internal/protocol/dispatch.go` (consult upstream, DO NOT copy)
- async-trait crate (if needed for async traits): <https://docs.rs/async-trait/latest/async_trait/> — note: Rust 1.75+ has native async traits, so we don't need this

**Implementation:**

```rust
// crates/hypernext-protocol/src/lib.rs

use async_trait::async_trait;  // Only if we need dyn-dispatchable async traits; otherwise use Rust 1.75+ native async traits
use hypernext_core::{PageDoc, Error};
use url::Url;

#[async_trait::async_trait]
pub trait Protocol: Send + Sync {
    /// The URI scheme this protocol handles, e.g. "gemini", "gopher".
    fn scheme(&self) -> &'static str;

    /// Capabilities this protocol supports. Used for UI hints.
    fn capabilities(&self) -> Capabilities;

    /// Fetch a URL and return a normalized PageDoc.
    ///
    /// Implementations MUST:
    /// - Honor the provided cancellation token
    /// - Apply SSRF policy via the injected HTTP client (for protocols that route through HTTP)
    /// - Apply size and time limits
    /// - Return `Error::Cancelled` if the token fires
    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, Error>;

    /// Optional: publish/upload capability (Titan, Micropub, ATProto write, etc.)
    /// Default implementation returns `Error::Unsupported`.
    async fn publish(&self, _url: &Url, _payload: &PublishPayload, _ctx: &FetchContext) -> Result<PublishResult, Error> {
        Err(Error::Unsupported)
    }
}

pub struct Capabilities {
    pub supports_fetch: bool,
    pub supports_publish: bool,
    pub supports_streaming: bool,    // For protocols like WebRTC, IRC
    pub supports_interactive: bool, // For SSH, Telnet, MUD
    pub needs_tls: bool,
    pub needs_tofu: bool,
}

pub struct FetchContext<'a> {
    pub http_client: &'a reqwest::Client,
    pub cancel: tokio_util::sync::CancellationToken,
    pub incognito: bool,
    pub policy: &'a FetchPolicy,
    pub keychain: &'a hypernext_keychain::Keychain,
    pub store: &'a hypernext_store::Store,
}

pub struct FetchPolicy {
    pub max_redirects: u32,
    pub max_response_size: usize,
    pub timeout: std::time::Duration,
    pub block_private_network: bool,  // SSRF defense
}

pub struct Dispatcher {
    protocols: std::collections::HashMap<&'static str, Box<dyn Protocol>>,
}

impl Dispatcher {
    pub fn new() -> Self;
    pub fn register(&mut self, protocol: Box<dyn Protocol>);
    pub async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, Error>;
    pub fn normalize_address(&self, input: &str) -> Result<Url, Error>;
}
```

**TDD gate:**

Unit tests (`crates/hypernext-protocol/src/dispatcher.rs::tests`):

- `normalize_address("geminiprotocol.net")` → `gemini://geminiprotocol.net/`
- `normalize_address("https://example.com")` → unchanged
- `normalize_address("feed:https://blog.example.com/rss")` → `https://blog.example.com/rss` (feed: is a hint, not a protocol)
- `normalize_address("example.com:1965/")` is treated as a URL, not a host:port (ambiguous case — document the rule)
- Dispatcher returns `Error::UnknownScheme` for unregistered schemes
- Dispatcher follows up to 5 redirects (configurable), returns `Error::TooManyRedirects` after

### 3.4 Gemini adapter (Week 2-3)

**References to consult:**

- Gemini spec: <https://geminiprotocol.net/> — read all sections
- Gemini certificate TOFU: <https://geminiprotocol.net/docs/protocol-documentation%20draft%20-%20Appendix%201.gmi>
- gemtext format: <https://geminiprotocol.net/docs/gemtext.gmi>
- The `gemini-protocol` crate API (see docs.rs for the pinned version)
- rustls docs (for TLS): <https://docs.rs/rustls/latest/rustls/>
- tokio-rustls: <https://docs.rs/tokio-rustls/latest/tokio_rustls/>

**Implementation:**

- [ ] In `crates/hypernext-protocol/src/adapters/gemini.rs`:
  - Wrap `gemini-protocol::Client` (the crate's public API)
  - Implement `Protocol::fetch` for `GeminiAdapter`
  - TOFU: on first TLS handshake, store the cert SHA-256 in `tofu_certs` table; on subsequent handshakes, compare and return `Error::TofuCertChanged` if mismatched
  - Status code handling: 1x input (return `PageDoc` with a prompt), 2x success, 3x redirect (follow up to max_redirects), 4x temporary failure, 5x permanent failure, 6x client cert required
  - Body parsing: `text/gemini` → gemtext → `Vec<Block>`; `text/plain` → single `Block::Paragraph`; `text/markdown` → comrak parse → `Vec<Block>`; other types → `Block::Raw`
- [ ] Handle client cert prompts: store cert in keychain per `gemini.<host>` account; never auto-send (require explicit user action)

**TDD gate:**

Unit tests:

- Parse all 6 status code classes correctly
- TOFU: first connection stores cert; second connection with same cert succeeds; second with different cert returns `TofuCertChanged`
- Redirect limit enforced
- gemtext → Block conversion matches fixture exactly (use `pretty_assertions::assert_eq!`)
- 10MB response size limit triggers `SizeLimitExceeded`

Integration tests (`crates/hypernext-protocol/tests/gemini.rs`):

- Spin up a local TLS server with `tokio-rustls` using a self-signed cert
- Server serves a fixed gemtext response
- Assert: `Dispatcher::fetch("gemini://localhost:<port>/")` returns the expected `PageDoc`
- Assert: re-fetching reuses the TOFU cert (no prompt to user)
- Assert: replacing the server's cert returns `TofuCertChanged`

### 3.5 Gopher, Spartan, Nex, Text, Scroll, Molerat, Scorpion, Kepler (Weeks 3-4)

Each of these is structurally similar: a TCP connection (some with TLS), a request line, a response body. Implement them as separate adapters but share a `TcpProtocolHelper` for the common plumbing.

**References to consult (per protocol — AI agent: read these in full before each adapter):**

- Gopher: <https://www.rfc-editor.org/rfc/rfc1436> + RFC 4266 (URLs) + Gopher+ spec
- Spartan: <https://portal.mozest.com/protocol/spartan>
- Nex: <https://nightfall.city/nex/>
- Text: <https://textprotocol.org/>
- Scroll: <https://scrollprotocol.com/>
- Molerat: <https://github.com/jcs/molerat> (read README + spec)
- Scorpion: <https://github.com/jcs/scorpion> (read README + spec)
- Kepler: read the `kepler-protocol` crate's README (no public spec URL found in audit; upstream README is authoritative)

**Implementation pattern (per adapter):**

1. Read the crate's API
2. Wrap it in a `Protocol::fetch` implementation in `crates/hypernext-protocol/src/adapters/<name>.rs`
3. Convert the protocol's native response format to `Vec<Block>`:
   - Gopher menu → `Vec<Block::Link>`
   - Spartan/Nex gemtext → gemtext parser (shared with Gemini)
   - Text protocol → `Block::Paragraph` with `SpanStyle::preformatted`
   - Scroll scrolltext → comrak-rendered scrolltext
   - Molerat mtxt → reuse Gemini's gemtext parser
   - Scorpion binary blocks → `Block::Raw` (binary) or text blocks per type
   - Kepler → reuse Gemini's gemtext parser (similar shape)
4. TOFU where applicable (Molerat, Scorpions over TLS, Kepler over TLS)
5. Tests

**TDD gate per adapter:**

- Unit tests: response parsing for happy path + 3 edge cases (malformed, empty, oversized)
- Integration tests: in-process mock server + fixture + assertion
- Each protocol has at least 5 fixture files in `tests/fixtures/<protocol>/`

### 3.6 Titan upload (Week 5)

Titan is the upload counterpart to Gemini — same TLS, same TOFU, but writes instead of reads.

**References to consult:**

- Titan spec: <https://community.gemini-protocol.com/protocol/titan>
- The `titanite` crate (more mature than the other 0.1.0 crates)

**Implementation:**

- [ ] In `crates/hypernext-protocol/src/adapters/titan.rs`:
  - Implement `Protocol::publish` for `TitanAdapter`
  - Upload request: `titan://host:port/path?mime=<mime>;size=<bytes>\r\n<bytes>`
  - Size limit: 100MB default, configurable
  - Progress callback: emit every 32KB uploaded
  - Cancellation: respect `FetchContext.cancel`
  - TOFU: reuse Gemini's `tofu_certs` table
- [ ] **Explicit confirmation gate (ethics B-09):** The `Protocol::publish` method must NEVER be called from navigation. Only the Titan upload dialog (UI in Phase 4) calls it. Document this invariant in `crates/hypernext-protocol/src/adapters/titan.rs` with a doc comment and an assertion-style test.
- [ ] Size limit enforced before upload begins (don't stream 1GB then fail at the end)
- [ ] MIME type sniffed if user doesn't specify; user can override

**TDD gate:**

Unit tests:

- Upload succeeds against an in-process Titan server
- Upload with size > limit fails before any bytes are sent
- Cancellation mid-upload returns `Error::Cancelled`
- TOFU cert change returns `TofuCertChanged` (no upload attempted)
- Invalid MIME returns `InvalidInput`

Integration tests:

- In-process Titan server receives expected bytes
- Progress callback fires at least once for a 1MB upload
- Server returns 5x status → propagates as `Error::ProtocolRejected`

### 3.7 Finger + WebFinger (Week 5)

**References to consult:**

- RFC 1288 (Finger): <https://www.rfc-editor.org/rfc/rfc1288>
- RFC 7033 (WebFinger): <https://www.rfc-editor.org/rfc/rfc7033>
- The crate (none — implement first-party; no good crate exists in audit)

**Implementation:**

- [ ] In `crates/hypernext-protocol/src/adapters/finger.rs`:
  - `finger://host/user[?verbose=true]` → TCP to port 79, send `/W user\r\n`, read response
  - Parse structured Finger responses: Plan section, PGP tail preservation (for PGP lookup), whitespace preservation for raw/unknown sections
  - Convert to `PageDoc` with `Block::Paragraph` (preformatted) for each section
- [ ] In `crates/hypernext-protocol/src/adapters/webfinger.rs`:
  - `https://host/.well-known/webfinger?resource=<url-encoded>`
  - Returns JSON with `subject`, `aliases`, `links` (rel/href/type)
  - Convert to `PageDoc` with `Block::Link` per link
  - Used by Solid, Mastodon, ATProto — must be a reusable building block, not a UI-facing protocol

**TDD gate:**

Unit tests:

- Finger: parse a fixture with Plan section
- Finger: parse a fixture with PGP block (preserve the armor)
- Finger: empty response (user not found) returns `Error::NotFound`
- WebFinger: parse JSON with multiple rel links
- WebFinger: 404 returns `Error::NotFound`
- WebFinger: missing `subject` field returns `Error::InvalidResponse`

Integration tests:

- In-process Finger server responds to `/W user` with fixture
- In-process HTTP server serves `.well-known/webfinger` JSON
- Both tested with valid + malformed + missing fixtures

### 3.8 PGP verification (Week 6)

**References to consult:**

- `pgp` crate docs: <https://docs.rs/pgp/latest/pgp/> — read "Getting Started" and "Verifying a message"
- `sequoia-openpgp` docs (alternative): <https://docs.sequoia-pgp.org/>
- Signed webpage pattern: <https://pouyacode.net/signing-webpages.html>
- GnuPG manual on clearsign: <https://www.gnupg.org/gph/en/manual/x135.html>
- The original Bean's `internal/pgp/` and `internal/solid/crypto.go` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-pgp/src/lib.rs`:
  - `pub fn verify_clearsign(bytes: &[u8], key: &PublicKey) -> Result<Verification, Error>`
  - `pub fn verify_detached(payload: &[u8], signature: &[u8], key: &PublicKey) -> Result<Verification, Error>`
  - `pub fn extract_clearsign_blocks(bytes: &[u8]) -> Vec<ClearsignBlock>` — find `-----BEGIN PGP SIGNED MESSAGE-----` blocks
  - `pub enum Verification { Valid, ValidUntrusted, Invalid, KeyChanged, ... }`
- [ ] Key lookup chain:
  1. Embedded key (from `link rel="signature"` or inline)
  2. Finger lookup (if URL is `finger://`)
  3. keys.openpgp.org lookup by email
  4. None → return `Unverified`
- [ ] TOFU key store: in `tofu_pgp_keys` table; on first successful verify, store `host → fingerprint`; on subsequent verifies, compare; mismatch → `KeyChanged`
- [ ] **Verification boundary (CRITICAL — ethics B-09):** PGP verification runs on the raw response bytes, BEFORE any extraction/parsing/rendering. The original Bean had a bug where `checkPGP` ran after extraction — we must NOT reproduce this. Document the invariant in `crates/hypernext-pgp/src/lib.rs` with a doc comment.

**TDD gate:**

Unit tests:

- Valid clearsign → `Valid`
- Tampered clearsign → `Invalid`
- Wrong key → `Unverified`
- Key rotation → first verify stores fingerprint; second with different key returns `KeyChanged`
- Inline HTML comment signature (Pouya Code pattern) extracts correctly
- Detached signature via `link rel="signature"` fetches and verifies

Integration tests:

- Generate test keys with the `pgp` crate
- Sign a fixture HTML page with clearsign, fetch via HTTP, verify
- Tamper with the bytes after signing, verify returns `Invalid`
- Extract → verify boundary test: assert verify is called BEFORE extraction (use a tracing hook to verify call order)

### 3.9 Protocol dispatcher wiring (Week 7)

Wire all adapters into the `Dispatcher`:

```rust
// crates/hypernext-protocol/src/registry.rs

pub fn default_dispatcher(http_client: &reqwest::Client, ...) -> Dispatcher {
    let mut d = Dispatcher::new();
    d.register(Box::new(adapters::GeminiAdapter::new()));
    d.register(Box::new(adapters::GopherAdapter::new()));
    d.register(Box::new(adapters::FingerAdapter::new()));
    d.register(Box::new(adapters::SpartanAdapter::new()));
    d.register(Box::new(adapters::NexAdapter::new()));
    d.register(Box::new(adapters::TextAdapter::new()));
    d.register(Box::new(adapters::ScrollAdapter::new()));
    d.register(Box::new(adapters::MoleratAdapter::new()));
    d.register(Box::new(adapters::ScorpionAdapter::new()));
    d.register(Box::new(adapters::KeplerAdapter::new()));
    d.register(Box::new(adapters::TitanAdapter::new()));      // publish only
    d.register(Box::new(adapters::WebFingerAdapter::new()));  // not user-facing; for other adapters
    d
}
```

**TDD gate:**

- `Dispatcher::fetch("gemini://...")` routes to `GeminiAdapter`
- `Dispatcher::fetch("gopher://...")` routes to `GopherAdapter`
- ... for every registered protocol
- Unknown scheme returns `Error::UnknownScheme`
- `Dispatcher::normalize_address("feed:https://...")` strips `feed:` and returns the URL
- `Dispatcher::normalize_address("rss://...")` strips `rss:` and returns the URL (feeds are HTTP)

### 3.10 Block → GTK widget rendering (Week 7-8)

Now the UI side: convert `Vec<Block>` into GTK widgets. This is in `hypernext-ui` but depends on `hypernext-core::Block` which was finalized in Phase 2.

**References to consult:**

- gtk4-rs widget reference: <https://gtk-rs.org/gtk4-rs/stable/latest/docs/>
- GtkLabel with markup: <https://docs.gtk.org/gtk4/class.Label.html> (Pango markup)
- GtkTextView for code blocks: <https://docs.gtk.org/gtk4/class.TextView.html>
- GtkListBox for link lists: <https://docs.gtk.org/gtk4/class.ListBox.html>
- Pango markup reference: <https://docs.gtk.org/Pango/pango_markup.html>

**Implementation:**

- [ ] In `crates/hypernext-ui/src/document_view.rs`:
  - `pub fn render_blocks(blocks: &[Block]) -> gtk::Widget`
  - For each `Block` variant, return the appropriate GTK widget:
    - `Heading` → `gtk::Label` with large font weight, Pango markup
    - `Paragraph` → `gtk::Label` with Pango markup (mixed styles via `SpanRun`)
    - `List` → `gtk::ListBox` with rows of labels
    - `Quote` → `gtk::Box` with CSS class `quote`
    - `Code` → `gtk::TextView` with monospace font, non-editable
    - `Image` → `gtk::Picture` loading from URL async
    - `Link` → `gtk::LinkButton` (or custom clickable label)
    - `Table` → `gtk::GridView` or `gtk::ColumnView`
    - `Separator` → `gtk::Separator`
    - `Raw` → render based on mime (image, video, audio, or "download" button)
  - Wrap all in a `gtk::Box` (vertical) with spacing
- [ ] CSS classes per block type, themeable via application CSS:
  - `.hypernext-heading-1`, `.hypernext-heading-2`, etc.
  - `.hypernext-paragraph`, `.hypernext-quote`, `.hypernext-code`
  - `.hypernext-link-visited`, `.hypernext-link-unvisited`

**TDD gate:**

Unit tests (with `gtk::test`-style init):

- `render_blocks(&[Block::Heading { level: 1, text: "Hi".into(), id: None }])` produces a `gtk::Label` with `"Hi"` and CSS class `hypernext-heading-1`
- `render_blocks(&[Block::Paragraph(...)])` produces a label with Pango markup containing the styled runs
- Empty `Vec<Block>` produces an empty `gtk::Box`

Integration tests:

- Render a representative fixture for each protocol (one Gemini page, one Gopher menu, etc.)
- Assert the resulting widget tree has the expected structure (CSS classes, label texts)

### 3.11 Spike: text selection across blocks (Week 8)

**Open question Q2 from the overview:** how do we render `Block` trees as GTK widgets without losing text selection across block boundaries?

HTML's selection model is global — you can drag-select across `<h1>`, `<p>`, `<li>` boundaries. GTK's selection model is per-widget — each `gtk::Label` has its own selection.

**Spike approach:**

1. Try `gtk::TextView` as the universal container (a single TextView, render the document as Pango-formatted text with custom tag objects). Pros: native cross-block selection. Cons: loses widget-level interactivity (links, images become inline tags, not buttons).
2. Try `gtk::FlowBox`/`gtk::ListBox` with `GtkEditable` label children — may not support cross-widget selection either.
3. Custom widget that maintains its own selection state and renders each block as a sub-widget, with mouse drag spanning multiple sub-widgets.
4. Accept the limitation: selection is per-block in v1; cross-block selection is a Phase 5+ improvement. Document as a known UX gap.

**Spike output:** a `docs/references/text-selection-strategy.md` ADR recording the chosen approach. Don't proceed with the rest of Phase 4's UI work until this is settled.

---

## 4. Phase exit criteria (Phase 2 → Phase 3 gate)

All of these must be true before Phase 3 starts:

- [ ] All 10 protocol crates resolve and build as direct dependencies of `hypernext-protocol` (`cargo build -p hypernext-protocol`)
- [ ] All 10 protocol adapters have ≥70% line coverage (verified by `cargo tarpaulin -p hypernext-protocol`)
- [ ] Each protocol adapter's deviations from upstream spec are documented in `worklog.md`
- [ ] `hypernext-protocol` crate's `Dispatcher::fetch` works for every registered protocol against local mock servers
- [ ] PGP verification works for: clearsign valid, clearsign tampered, detached signature, inline HTML comment signature, key rotation
- [ ] Titan upload respects the explicit-confirmation gate (verified by a test that asserts `publish` cannot be called from `fetch`)
- [ ] Block → GTK widget rendering produces the expected widget tree for fixtures of every protocol
- [ ] Text selection spike has a documented ADR (`docs/references/text-selection-strategy.md`)
- [ ] `cargo test --workspace` passes with ≥60% overall coverage
- [ ] `cargo clippy --workspace -- -D warnings` is clean
- [ ] `cargo deny check` is clean
- [ ] No `--no-verify` in git history
- [ ] `worklog.md` is up to date

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A 0.1.0 protocol crate has fundamental API gaps (e.g. no TOFU support, no cancellation) | High | Medium | Hardening in §3.2 catches this in week 1-2. If a crate is unsalvageable, wrap it in our adapter, open an upstream PR, or drop the protocol from 1.0 and ship in 1.1. |
| R2 | The `pgp` crate's API is hard to use for the verification boundary (verify-before-extract) | Medium | High | Use `sequoia-openpgp` as alternative; spike in week 6 to confirm API fit |
| R3 | Text selection across GTK widgets is impossible without a custom widget | High | Medium | Spike in week 8; if blocked, accept per-block selection for 1.0 and document the gap |
| R4 | Cross-protocol redirect handling has edge cases (e.g. Gemini → HTTP) | Medium | Medium | Documented in `FetchPolicy`; redirect chain records every hop in `DebugInfo` |
| R5 | An upstream 0.1.0 protocol crate releases 0.2.0 with breaking changes mid-phase | Low | Low | We depend directly; handle via the normal dependency-update workflow (bump version, fix breakage, commit) |
| R6 | SSRF defense blocks legitimate URLs (e.g. localhost for testing) | Medium | Low | `FetchPolicy::block_private_network` is configurable; tests use `localhost` with the flag off |

---

## 6. References

### Protocol specs (read in full before each adapter)

- Gemini: <https://geminiprotocol.net/>
- Gopher: <https://www.rfc-editor.org/rfc/rfc1436>
- Spartan: <https://portal.mozest.com/protocol/spartan>
- Nex: <https://nightfall.city/nex/>
- Text: <https://textprotocol.org/>
- Scroll: <https://scrollprotocol.com/>
- Molerat: <https://github.com/jcs/molerat>
- Scorpion: <https://github.com/jcs/scorpion>
- Kepler: see the `kepler-protocol` crate's README
- Titan: <https://community.gemini-protocol.com/protocol/titan>
- Finger: <https://www.rfc-editor.org/rfc/rfc1288>
- WebFinger: <https://www.rfc-editor.org/rfc/rfc7033>

### PGP

- `pgp` crate: <https://docs.rs/pgp/latest/pgp/>
- `sequoia-openpgp`: <https://docs.sequoia-pgp.org/>
- Signed webpage pattern: <https://pouyacode.net/signing-webpages.html>
- GnuPG clearsign: <https://www.gnupg.org/gph/en/manual/x135.html>

### TLS / Tokio

- rustls: <https://docs.rs/rustls/latest/rustls/>
- tokio-rustls: <https://docs.rs/tokio-rustls/latest/tokio_rustls/>
- tokio CancellationToken: <https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html>

### GTK rendering

- gtk4-rs widget reference: <https://gtk-rs.org/gtk4-rs/stable/latest/docs/>
- Pango markup: <https://docs.gtk.org/Pango/pango_markup.html>
- GtkListBox: <https://docs.gtk.org/gtk4/class.ListBox.html>
- GtkTextView: <https://docs.gtk.org/gtk4/class.TextView.html>

### Original Bean reference (consult, do not copy)

- `internal/protocol/types.go` — PageDoc model
- `internal/protocol/dispatch.go` — dispatcher pattern
- `internal/protocol/gemini.go` — Gemini adapter reference
- `internal/protocol/gopher.go` — Gopher adapter reference
- `internal/pgp/verify.go` — PGP verification reference
- `internal/solid/crypto.go` — ECDH / P256 reference (for later phases)

---

## 7. AI-agent instructions for Phase 2

**Before writing any code in Phase 2, you must:**

1. Read the spec for the protocol you're implementing. Every protocol has a public spec (URLs in §6.1). Do NOT assume you know the protocol from training data — specs evolve.
2. Read the crate's source code (from the pinned version in the lockfile, e.g. `~/.cargo/registry/src/` or the docs.rs source view). Understand what it already does before wrapping it.
3. Read `hypernext-core::Block` and `PageDoc` definitions (from Phase 1) so you know what shape to produce.
4. Read `hypernext-protocol::Protocol` trait (from §3.3 above).
5. Read `docs/references/0006-smolnet-protocol-crates.md` to understand the direct-dependency policy.

**While writing code:**

1. **Spec compliance is the test.** If the crate does X but the spec says Y, the spec wins. Document the deviation in `worklog.md` and consider upstreaming the fix.
2. **Every fixture is real.** Don't synthesize a fixture; capture one from a live server (with permission — use `geminiprotocol.net` for Gemini fixtures, etc.). Fixtures are how we catch spec drift.
3. **PGP verification runs before extraction.** This is invariant. If you find yourself calling `extract()` before `verify()`, STOP. You have a bug.
4. **Titan upload is never called from navigation.** If you find `publish()` reachable from `fetch()`, STOP. You have a bug.
5. **Tests use local mock servers.** No test ever makes a real network call. Use `tokio::net::TcpListener` and `tokio-rustls` for TLS protocols.
6. **TOFU is per-host.** Don't share TOFU state across protocols; Gemini certs and Molerat certs are separate stores.

**After writing code:**

1. Run `cargo test -p hypernext-protocol` (and the specific adapter's tests).
2. Both must be green before committing.
3. Update `worklog.md` with the Task ID and what you did.
4. Use Conventional Commits: `feat(phase-2): implement Gemini adapter`, `test(phase-2): add TOFU cert rotation test`, `docs(phase-2): document PGP verification boundary`.

**If a protocol is harder than expected:**

1. Don't push through. Document the blocker in `worklog.md` under `## Open questions`.
2. If the blocker is fundamental (e.g. the spec is ambiguous, the crate is broken), propose dropping the protocol from 1.0 and shipping it in 1.1. The plan supports this — better a smaller 1.0 than a stuck one.
