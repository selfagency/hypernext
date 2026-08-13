# Phase 3 — HTTP Reader Mode & Raw Mode Webview

> Phase 3 of the Hypernext 1.0 Hypertext release.
> Prerequisites: Phase 2 complete (protocols, dispatcher, Block → GTK rendering, PGP).
> Estimated duration: 5 weeks (single maintainer, AI-assisted)
> TDD requirement: Yes — same three layers as Phase 1-2.

---

## 1. Goal

Implement HTTP/HTTPS browsing with two modes:

- **Reader mode (default):** Fetch via `reqwest`, extract readable content with `legible` (a Rust port of Readability.js), parse metadata, apply adblock rules for tracker blocking, render `Vec<Block>` natively via GTK widgets. No JavaScript execution. No remote CSS. This is what 90% of HTTP browsing uses.
- **Raw mode (opt-in per origin):** Embed a platform webview widget (WebKitGTK on Linux, WKWebView on macOS, WebView2 on Windows) inside the Hypernext window. Full JS/CSS/HTML execution with policy controls (scripts, storage, popups, downloads, cross-origin requests). This is for sites that genuinely need interactive rendering.

When Phase 3 ships, typing `https://example.com` in the location bar fetches and renders the page in reader mode. Toggling "Raw" in the toolbar switches to the embedded webview for the same URL. The preference is saved per-origin in bookmarks or settings.

---

## 2. Architecture

```text
┌─────────────────────────────────────────────────────┐
│ hypernext-ui (Phase 4)                              │
│  - location bar "https://example.com"               │
│  - web mode toggle (Reader / Raw)                   │
│  - document view (reader mode: GTK widgets)         │
│  - raw view (raw mode: embedded webview widget)     │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│ hypernext-webmode                                    │
│  - enum WebMode { Reader, Raw }                     │
│  - fn resolve_mode(url) -> WebMode                  │
│  - fn set_mode_pref(origin, mode)                   │
│  - policy: scripts, storage, popups, downloads,    │
│            cross-origin                              │
└────────────┬────────────────────────────────────────┘
             │
       ┌─────┴─────┐
       ▼           ▼
┌──────────┐  ┌─────────────────────┐
│ Reader   │  │ Raw-mode webview     │
│ pipeline │  │ (embedded widget)    │
│          │  │ - WebKitGTK on Linux  │
│ - fetch  │  │ - WKWebView on macOS  │
│ - PGP    │  │ - WebView2 on Win    │
│ - legible│  │ - policy applied     │
│ - adblock│  │ - CDP for testing    │
│ - render │  │                      │
└──────────┘  └─────────────────────┘
```

---

## 3. Sub-tasks

### 3.1 HTTP fetch + SSRF policy (Week 1)

**References to consult:**

- reqwest docs: <https://docs.rs/reqwest/latest/reqwest/> — read "Making a GET request", "Custom Client", "Redirection"
- reqwest redirect policy: <https://docs.rs/reqwest/latest/reqwest/redirect/struct.Policy.html>
- SSRF defense patterns: <https://owasp.org/www-community/attacks/Server_Side_Request_Forgery>
- The original Bean's `internal/httpclient/policy.go` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-http/src/policy.rs`:
  - `pub struct FetchPolicy { max_redirects, max_response_size, timeout, block_private_network, allowed_schemes }`
  - `pub fn check_url(url: &Url, policy: &FetchPolicy) -> Result<(), Error>` — validates scheme (only `http`, `https`); if `block_private_network` is on, rejects RFC 1918 / loopback / link-local IPs
  - Resolves DNS and checks the resolved IP (not just the hostname) to defeat DNS-rebinding SSRF
  - Redirects: each hop is re-validated by `check_url`; redirect chain is recorded
- [ ] In `crates/hypernext-http/src/client.rs`:
  - `pub fn build_client(policy: &FetchPolicy) -> reqwest::Client`
  - Configures redirect policy to `Policy::custom` that calls `check_url` per hop
  - Sets `reqwest::Client::builder().timeout(policy.timeout)`
  - Configures SOCKS5 support via the `socks` feature for Tor integration (used in Phase 5 Confidential release)
- [ ] **Size limit:** enforced via a streaming reader that aborts at `max_response_size`. The original Bean had a `ReadAll` overflow bug — we use a bounded `tokio::io::AsyncRead` wrapper.

**TDD gate:**

Unit tests:

- `check_url("https://example.com")` with default policy → Ok
- `check_url("http://127.0.0.1/x")` with `block_private_network=true` → `SsrfBlocked`
- `check_url("http://192.168.1.1/x")` with `block_private_network=true` → `SsrfBlocked`
- `check_url("http://10.0.0.1/x")` with `block_private_network=true` → `SsrfBlocked`
- `check_url("file:///etc/passwd")` → `SsrfBlocked` (scheme not allowed)
- `check_url("ftp://example.com")` → `SsrfBlocked`
- DNS rebinding: a hostname that resolves to `127.0.0.1` is blocked (use a mock resolver)
- Redirect to disallowed host → blocked at the redirect hop

Integration tests:

- Spin up `wiremock` server, fetch 100MB response with `max_response_size=10MB` → `SizeLimitExceeded` after 10MB
- Spin up `wiremock` server returning 301 to `127.0.0.1` → blocked
- Spin up `wiremock` with 6 chained redirects → 6th redirect fails

### 3.2 HTML parsing + readability extraction (Week 1-2)

**References to consult:**

- `legible` crate: <https://crates.io/crates/legible> (v0.5.1 — Rust port of Readability.js) — read the README and docs.rs page in full
- `scraper` crate: <https://docs.rs/scraper/latest/scraper/>
- `html5ever` (used by scraper): <https://docs.rs/html5ever/latest/html5ever/>
- `lol_html` (streaming rewriter, alternative): <https://docs.rs/lol_html/latest/lol_html/>
- Readability.js original: <https://github.com/mozilla/readability> — for algorithm reference
- The original Bean's `internal/protocol/http.go` (consult upstream — they used `go-shiori/go-readability`)

**Implementation:**

- [ ] In `crates/hypernext-http/src/extract.rs`:
  - `pub async fn fetch_and_extract(url: &Url, client: &reqwest::Client, policy: &FetchPolicy) -> Result<PageDoc, Error>`
  - Pipeline:
    1. `reqwest` GET with policy-bound client
    2. Capture raw bytes
    3. **PGP verify** raw bytes (Phase 2's `hypernext-pgp`) — runs BEFORE extraction, per the verification boundary invariant
    4. If signed and valid: continue; if invalid: return `Error::PgpInvalid`
    5. Detect content type from `Content-Type` header; if missing, sniff first 512 bytes
    6. If HTML: `legible::parse(&html, Some(url), None)` → readable content + metadata
    7. If markdown: `comrak::markdown_to_html` then `legible::parse` on the rendered HTML

> **API correction (library-lookup protocol step 5, p3-t2):** legible 0.5.1's real entry
> point is `legible::parse(&str, Option<&str base_url>, Option<Options>) -> Result<Article, legible::Error>`,
> returning an `Article` struct with `title`, `byline`, `site_name`, `published_time`,
> `content` (HTML fragment), `markdown_content` (CommonMark), and `text_content`. There
> is **no `legible::extract` function**. Blocks are built by parsing `Article.markdown_content`
> with the `comrak` AST (`comrak::parse_document`) — this reuses the already-audited
> comrak dep and avoids a second HTML pass. legible already extracts JSON-LD internally
> but does not expose it on `Article`, so JSON-LD is parsed from the raw bytes separately.

    8. If feed: hand off to `feed-rs` (Phase 1.1)
    9. If text/plain: wrap in `Block::Paragraph` with `preformatted: true`
    10. If image/video/audio/binary: `Block::Raw`
    11. Build `Vec<Block>` from extracted content
    12. Build `Metadata` from `<meta>` tags, JSON-LD, OG/Twitter cards, microformats (h-card, h-entry — parsed with `scraper`, NOT the `microformats` crate: that crate is **LGPL-3.0**, rejected by library-lookup-protocol's license allowlist)
    13. Build `DebugInfo` with timing, headers, redirect chain, parser decisions
    14. Return `PageDoc`

**TDD gate:**

Unit tests:

- Fixture: `tests/fixtures/http/simple-article.html` → expected `PageDoc` with title, paragraphs, no images stripped
- Fixture: `tests/fixtures/http/article-with-ads.html` → ads stripped, main content preserved
- Fixture: `tests/fixtures/http/feed.html` (HTML page that is actually a feed) → routed to feed-rs
- Fixture: `tests/fixtures/http/markdown.html` (HTML labeled as markdown) → comrak parse then extract
- Fixture: `tests/fixtures/http/empty-body.html` → `PageDoc` with empty blocks, not an error
- Fixture: `tests/fixtures/http/missing-metadata.html` → `Metadata` with all `None` fields
- Microformats: fixture with h-card → parsed into `Metadata.author`
- JSON-LD: fixture with `<script type="application/ld+json">` → parsed into `Metadata.json_ld`

Integration tests:

- Spin up `wiremock` returning a real article HTML → assert extraction matches expected `PageDoc`
- Same with a 5MB HTML page → assert size limit enforced
- Same with redirect to another article → assert final URL in `PageDoc.final_url`

### 3.3 Ad filtering (Week 2)

**References to consult:**

- `adblock` crate: <https://crates.io/crates/adblock> (v0.13.2 — Brave's Rust adblock crate) — read README + docs.rs
- Brave's adblock-rust docs: <https://github.com/brave/adblock-rust>
- EasyList format: <https://adblockplus.org/filters>
- Cosmetic filtering reference: <https://help.eyeo.com/en/adblockplus/how-to-write-filters#elemhide>

**Implementation:**

- [ ] In `crates/hypernext-http/src/adblock.rs`:
  - `pub struct AdblockEngine { engine: adblock::Engine }`
  - `pub fn new() -> Self` — loads EasyList + EasyPrivacy from bundled assets (download at build time, never at runtime)
  - `pub fn should_block(url: &Url, source_origin: &Url, resource_type: adblock::request::RequestType) -> bool`
    (API correction p3-t3: `adblock` 0.13.2 exposes `RequestType`, not `ResourceType`; re-exported as `hypernext_http::adblock::RequestType`)
  - `pub fn cosmetic_rules_for(domain: &str) -> Vec<String>` — CSS selectors to hide
  - Apply cosmetic rules in `extract.rs`: strip matching elements from the HTML tree before `legible::parse` (correction p3-t3: the API is `legible::parse`, not `legible::extract`; generic `##.foo` rules need the page's classes/ids via `cosmetic_rules_for_document(url, html)`),
- [ ] Filter list subscription: a `FilterListSource` enum (`Bundled`, `Url(url)`, `File(path)`); defaults to `Bundled` EasyList + EasyPrivacy
- [ ] User can toggle adblock on/off per origin (stored in settings)
- [ ] Never apply adblock in incognito (raw-mode only — see §3.5)

**TDD gate:**

Unit tests:

- `should_block` for a known tracker URL → true
- `should_block` for a known non-tracker URL → false
- Cosmetic rules for `example.com` → list of selectors
- Empty EasyList (edge case) → engine initializes with no rules

Integration tests:

- Spin up `wiremock` serving a page with `<img src="https://doubleclick.net/...">` → image is not requested
- Same with a tracker script → script not executed (in raw mode)
- Cosmetic hiding: `<div class="ad-banner">` is removed from extracted `PageDoc`

### 3.4 Raw-mode webview widget (Week 3-4)

This is the only place a webview exists in Hypernext. It's an embedded widget — one per raw-mode tab — using the platform's native webview.

**References to consult (per platform):**

- macOS WKWebView: <https://developer.apple.com/documentation/webkit/wkwebview>
- macOS via objc2: <https://docs.rs/objc2/latest/objc2/> and <https://docs.rs/objc2-web-kit/latest/objc2_web_kit/>
- Linux WebKitGTK: <https://webkitgtk.org/reference/webkit2gtk/stable/>
- Linux via webkit6 crate: <https://crates.io/crates/webkit6> (or webkit4-rs depending on GTK version)
- Windows WebView2: <https://learn.microsoft.com/en-us/microsoft-edge/webview2/>
- Windows via windows-rs: <https://github.com/microsoft/windows-rs>
- Tauri's webview approach (reference): <https://v2.tauri.app/concept/webview/>
- wry's platform detection (reference): <https://github.com/tauri-apps/wry>

**Implementation:**

- [ ] In `crates/hypernext-webmode/src/raw_widget.rs`:
  - A platform-conditional module: `#[cfg(target_os = "macos")] mod macos;` etc.
  - macOS: use `objc2-web-kit`'s `WKWebView`.
    - **SPIKE (p3-t4, resolved 2026-08-12):** GTK4 cannot host a foreign NSView.
      `GtkSocket`/`GtkPlug` were removed in GTK4 and were X11-only; there is no
      `gtk4::nsview_to_widget`; `wry`'s `build_gtk` is Linux-only. **Decision:
      Fallback A — macOS raw mode uses a separate native `NSWindow` hosting the
      `WKWebView`** (the GTK tab hosts a placeholder widget). See
      `docs/references/0002-browser-engine-survey.md` §SPIKE outcome.
  - Linux: use `webkit6` crate's `WebView` directly as a `gtk::Widget`.
    - **BLOCKED (spike finding):** `webkit6` 0.6 requires gtk4 0.11; Hypernext
      pins gtk4 0.9 (only one `gtk4-sys` may link `gtk-4`). Deferred until the
      workspace upgrades gtk4 to 0.11; `hypernext-webmode` ships a gtk4-only
      placeholder on Linux until then.
  - Windows: use `webview2-com` via `windows` crate, embedded in a `gtk::Widget` via Win32 HWND parenting
- [ ] `pub struct RawWebView { widget: gtk::Widget, ... }`
- [ ] `pub fn new() -> Self`
- [ ] `pub fn load_url(&self, url: &Url)` — navigates the webview
- [ ] `pub fn set_policy(&self, policy: &WebviewPolicy)` — configures:
  - `allow_scripts: bool` (default false in incognito, true otherwise)
  - `allow_storage: bool` (default false in incognito)
  - `allow_popups: bool` (default false)
  - `allow_downloads: bool` (default true with explicit user confirmation)
  - `allow_cross_origin: bool` (default false; CORS strict)
- [ ] Connect to navigation events: `load_changed`, `load_failed`, `decide_policy` (intercept new-window requests, redirect requests)
- [ ] Connect to `decide_policy` for downloads: prompt user, never auto-accept
- [ ] Connect to `create` for new-window requests: open in new tab in Hypernext (not a separate webview window)

**TDD gate:**

Unit tests:

- `WebviewPolicy::default()` returns incognito-safe defaults
- `RawWebView::new()` returns a widget (testable only on a real display — see `docs/references/gtk-testing.md`)

Integration tests (require a display — `xvfb-run` on CI Linux):

- Load `https://example.com` in raw mode → `load_changed` fires with `FINISHED`
- Block a popup window → `create` returns `None` (no new webview)
- Block a download → `decide_policy` for download returns `Reject`
- Adblock in raw mode: a tracker URL is intercepted via `decide_policy` (intercept the resource request, check against adblock engine, return `Reject` if matched)

**SPIKE for macOS WKWebView + GTK4 integration:**

**RESOLVED (p3-t4, 2026-08-12) — see `docs/references/0002-browser-engine-survey.md`
§SPIKE outcome.** Chosen approach: **Fallback A (separate native WKWebView
window)**. Options (a) `GtkSocket` and (b) `wry build_gtk` are impossible on
macOS (GtkSocket removed in GTK4; wry's GTK embedding is Linux-only). No
fallback decision remains open: Fallback A ships raw mode in 1.0 with a
documented worse-UX separate window. Fallback B (drop raw to 1.1) was** not**
selected.

### 3.5 Web mode toggle + per-origin persistence (Week 4)

**References to consult:**

- The original Bean's `internal/webmode/` package (consult upstream)
- Web mode toggle spec from the original PRD: `docs/references/bean-v1-prd.md` FR-8 (read for semantics, not for implementation)

**Implementation:**

- [ ] In `crates/hypernext-webmode/src/lib.rs`:
  - `pub enum WebMode { Reader, Raw }`
  - `pub fn resolve_mode(url: &Url, store: &Store) -> WebMode` — looks up the per-origin preference; defaults to `Reader`
  - `pub fn set_mode_pref(url: &Url, mode: WebMode, store: &Store) -> Result<(), Error>` — stores in `settings` table with key `webmode.<origin>`
  - For incognito windows: always returns `Reader` (raw mode disabled in incognito for safety; document this)
- [ ] Settings UI control (in Phase 4): a toggle in the toolbar showing current mode; click to flip and save

**TDD gate:**

Unit tests:

- `resolve_mode` for unknown origin → `Reader`
- `set_mode_pref("https://example.com", Raw)` then `resolve_mode("https://example.com/some/page")` → `Raw`
- Preference persists across DB re-open
- Incognito flag forces `Reader` regardless of saved preference
- `set_mode_pref("https://example.com", Reader)` clears the preference (no row, not a row with `Reader`)

### 3.6 Reader-mode rendering pipeline (Week 4)

Connect the reader-mode `PageDoc` to the GTK widget renderer from Phase 2 §3.10.

**Implementation:**

- [ ] In `crates/hypernext-ui/src/reader_view.rs`:
  - `pub fn render_page_doc(doc: &PageDoc) -> gtk::Widget`
  - Calls `document_view::render_blocks(&doc.blocks)` (from Phase 2)
  - Adds a metadata header at the top: title, author, date, PGP shield, share button, read-state toggle
  - Featured image: inserted at top if `metadata.featured_image` is set AND not already in content (deduplication)
  - Favicon: rendered in the location bar (Phase 4), not in the document

**TDD gate:**

- Render a fixture `PageDoc` → assert the widget tree matches expected
- Featured image deduplication: if the same URL appears in metadata and in a `Block::Image`, only render once
- Empty metadata: header renders with placeholders, not panics

### 3.7 Reader-mode HTTP integration with dispatcher (Week 5)

Wire HTTP into the dispatcher from Phase 2.

**Implementation:**

- [ ] In `crates/hypernext-protocol/src/adapters/http.rs`:
  - `pub struct HttpAdapter { client: reqwest::Client }`
  - Implements `Protocol::fetch`:
    1. `resolve_mode(url, store)` → `Reader` or `Raw`
    2. If `Reader`: call `hypernext_http::fetch_and_extract(url, client, policy)` → returns `PageDoc` ready for `ReaderView`
    3. If `Raw`: return a `PageDoc` with a special `Block::Raw { mime: "application/x-webview".into(), bytes: vec![] }` (semantically "this URL needs raw rendering"). The UI layer recognizes this and switches to `RawWebView` instead of `ReaderView`.
- [ ] Register `HttpAdapter` in `default_dispatcher`
- [ ] **PGP verification boundary invariant:** The HTTP adapter's `fetch` method calls `hypernext_pgp::verify_*` on the raw bytes BEFORE calling `legible::extract`. The order is enforced by a unit test asserting the call order via a tracing hook.

**TDD gate:**

Integration tests:

- `Dispatcher::fetch("https://example.com")` returns a `PageDoc` with blocks
- `Dispatcher::fetch` against a server returning PGP-signed HTML → verifies signature, includes `PgpInfo` in result
- `Dispatcher::fetch` against a server returning tampered PGP-signed HTML → `Error::PgpInvalid`
- Setting `webmode.example.com = Raw` → `Dispatcher::fetch("https://example.com")` returns the `Block::Raw` placeholder

---

## 4. Phase exit criteria (Phase 3 → Phase 4 gate)

- [ ] `hypernext-http` fetches HTTPS URLs with SSRF defense, size limits, redirect limits
- [ ] `legible` extraction produces correct `PageDoc` for 10+ fixture HTML files
- [ ] Ad filtering blocks known trackers in both reader mode (cosmetic) and raw mode (resource interception)
- [ ] Raw-mode webview widget works on macOS (or a documented fallback is in place)
- [ ] Web mode toggle persists per-origin; incognito forces reader mode
- [ ] PGP verification runs before extraction in every code path (verified by tracing hook)
- [ ] `Dispatcher::fetch("https://...")` returns a `PageDoc` ready for rendering
- [ ] `cargo test --workspace` passes with ≥65% overall coverage
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] No `--no-verify` in git history
- [ ] `worklog.md` up to date

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | macOS WKWebView cannot be embedded in GTK4 cleanly | High | High | Spike in week 3; if blocked, fallback to separate-window raw mode or drop raw mode from 1.0 |
| R2 | `legible` crate (0.5.1, fresh) has gaps vs Readability.js | Medium | Medium | Capture fixtures with edge cases; contribute fixes upstream; document deviations |
| R3 | `adblock` crate's cosmetic rules don't apply cleanly to extracted `Vec<Block>` (since we don't render HTML) | Medium | Medium | Apply cosmetic rules in `extract.rs` BEFORE `legible::extract` (strip matched elements from the HTML tree) |
| R4 | DNS rebinding SSRF defense slows down every request | Low | Low | Cache DNS results per-request; accept the latency cost |
| R5 | Cross-origin requests in raw mode leak data to trackers | Medium | High | Strict `allow_cross_origin: false` default; user opt-in per origin |
| R6 | Reader mode can't render JavaScript-rendered SPAs (e.g. Twitter, Reddit) | High | Low | Document as expected; user toggles to raw mode for such sites |

---

## 6. References

### HTTP / HTML

- reqwest: <https://docs.rs/reqwest/latest/reqwest/>
- legible: <https://crates.io/crates/legible>
- scraper: <https://docs.rs/scraper/latest/scraper/>
- html5ever: <https://docs.rs/html5ever/latest/html5ever/>
- lol_html: <https://docs.rs/lol_html/latest/lol_html/>
- Readability.js (reference algorithm): <https://github.com/mozilla/readability>
- comrak: <https://docs.rs/comrak/latest/comrak/>
- feed-rs: <https://docs.rs/feed-rs/latest/feed_rs/>
- microformats: <https://docs.rs/microformats/latest/microformats/>

### Ad filtering

- adblock crate: <https://crates.io/crates/adblock>
- Brave adblock-rust: <https://github.com/brave/adblock-rust>
- EasyList: <https://easylist.to/>

### Raw-mode webview

- macOS WKWebView: <https://developer.apple.com/documentation/webkit/wkwebview>
- objc2: <https://docs.rs/objc2/latest/objc2/>
- objc2-web-kit: <https://docs.rs/objc2-web-kit/latest/objc2_web_kit/>
- Linux WebKitGTK: <https://webkitgtk.org/reference/webkit2gtk/stable/>
- webkit6 crate: <https://crates.io/crates/webkit6>
- Windows WebView2: <https://learn.microsoft.com/en-us/microsoft-edge/webview2/>
- windows-rs: <https://github.com/microsoft/windows-rs>
- wry (reference): <https://github.com/tauri-apps/wry>
- Tauri webview concept: <https://v2.tauri.app/concept/webview/>

### SSRF / Security

- OWASP SSRF: <https://owasp.org/www-community/attacks/Server_Side_Request_Forgery>
- RFC 1918 (private networks): <https://www.rfc-editor.org/rfc/rfc1918>

### Original Bean reference

- `internal/protocol/http.go`
- `internal/httpclient/policy.go`
- `internal/webmode/`
- `internal/adblock/`
- `internal/readerproxy/`

---

## 7. AI-agent instructions for Phase 3

**Before writing code:**

1. Read every URL in §6 for the layer you're working on (HTTP / adblock / webview / etc.).
2. Read the original Bean's `internal/protocol/http.go` and `internal/webmode/` for prior art (consult upstream, do not copy).
3. Read the PGP verification boundary invariant in `docs/references/0007-keychain-only-secrets.md` and the Phase 2 PGP docs.
4. For the raw-mode webview widget: read `docs/references/0002-browser-engine-survey.md` ADR before starting the macOS spike.

**While writing code:**

1. **SSRF defense is mandatory.** Every outbound HTTP request goes through `FetchPolicy::check_url`. No exceptions. If you find a code path that bypasses it, that's a bug.
2. **Size limits are mandatory.** Use the bounded reader; never `Response::bytes()`.
3. **PGP verification before extraction.** This is the second time this invariant appears — it's that important.
4. **Raw-mode webview is the ONLY webview in the app.** Do not introduce webviews anywhere else.
5. **macOS WKWebView integration is a known risk.** Don't pretend it works; if it doesn't, propose a fallback and document.

**After writing code:**

1. Run `cargo test -p hypernext-http`, `cargo test -p hypernext-webmode`, `cargo test -p hypernext-protocol`.
2. Update `worklog.md`.
3. Conventional Commits: `feat(phase-3): add SSRF policy`, `test(phase-3): cover DNS rebinding`, `docs(phase-3): document raw-mode webview fallback`.
