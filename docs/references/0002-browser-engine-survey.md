# ADR 0002 — Browser Engine Survey: Platform Webviews via Embedded Widget

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner:** Daniel / Selfagency
- **Supersedes:** Bean's Wails v3 raw-mode webview (whole-app-shell webview)
- **Related:** `0001-ui-framework-choice.md`, `0003-authority-model.md`

## Context

The user originally requested "stable rust browser engine" as part of the rewrite. The intent was: don't depend on platform webviews (WebView2/WKWebView/WebKitGTK) the way Wails does.

Research was conducted to determine if a Rust-native browser engine is production-viable today. Findings:

### Servo

- Current version: v0.4.0 (released 2026-08-04, crates.io)
- Self-description in README: *"A prototype web browser engine written in the Rust language"* (emphasis on "prototype")
- Tauri team, who actually tried to ship Servo via the Verso wrapper, describes the embedding API as *"relatively easy to embed compared to other browsers, but the APIs are still way too low level and it's quite daunting to use"*
- MSRV: 1.88.0
- Web platform features: HTML5, CSS3, JS/WASM (SpiderMonkey), WebGL, WebGPU — confirmed
- Service Workers, IndexedDB: **not confirmed** in any source
- Production desktop apps shipping Servo as engine: **zero confirmed** (the "Made with Servo" list consists entirely of browsers/demos, no commercial/production products)
- Binary size impact: significant (tens of MB) — exact figure not found
- Active maintenance: very active (last commit Aug 11 2026, monthly releases)

### Verso

- Was a standalone browser built on top of Servo as a library
- Started Jan 2024 by Wu TaiFung (`wusyong`, Tauri maintainer)
- **ARCHIVED Oct 8, 2025** — *"This repository was archived by the owner. Verso is currently no longer maintained."*
- Reason: "unable to keep pace with [Servo's] updates due to limited manpower and funding"
- Several Verso contributions were upstreamed back into Servo

### wry

- Current version: v0.56.0 (Jul 30 2026)
- Default backends: WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux)
- **Servo backend: NOT yet supported.** The README states the recent refactor of the default backend "was added in preparation of other ports like cef and servo" — i.e., Servo is a stated future direction, not a working backend
- No `servo` feature flag in wry today
- Tauri maintainers (FabianLars, July 12 2026 discussion #15235) confirm the blocker is **funding/workforce, not technical interest**: *"we always loved servo and wanted to have it in tauri. what's missing is funding … the long term investment to try to keep up with servo's velocity is even worse."*

### Dioxus Native / Blitz

- Experimental renderer shipped in Dioxus 0.7
- Release blog explicitly calls it *"the first-ever version of Dioxus Native"*, *"Blitz is still considered a 'work in progress'… we have not focused on performance"*
- Cannot run JavaScript — eliminates it for raw-mode HTTP rendering
- Uses Stylo (CSS engine shared by Firefox and Servo) — but only the CSS layer, not the JS engine

## Decision

**Use platform webviews (WebKitGTK on Linux, WKWebView on macOS, WebView2 on Windows) embedded as a single widget, exclusively for raw-mode HTTP tabs. Everything else in Hypernext is native GTK4 widgets.**

This means:

1. Hypernext's app shell is GTK4 native widgets — no webview
2. The reader-mode HTTP path fetches via `reqwest`, extracts via `legible`, renders as GTK widgets from `Vec<Block>` — no webview
3. The raw-mode HTTP path embeds one platform webview widget per raw-mode tab — used surgically, only when the user opts into raw mode for a specific origin
4. Servo embedding is deferred to a future release — see §"Future direction" below

### Why platform webviews and not Servo

- Servo self-describes as "prototype" — shipping a production app on a prototype engine is irresponsible for a 1.0
- No production desktop app ships Servo today — there is no precedent to learn from
- The Verso wrapper that made Servo ergonomic is archived
- wry doesn't yet support Servo as a backend — there is no plug-in path
- Even if we embedded Servo directly via its low-level API, we'd be the first production user; the integration cost is unknown and likely months of work
- The user's actual goal (avoid the Wails-style webview-as-app-chrome) is achieved by using native GTK widgets for the app shell; the surgical use of platform webviews for raw-mode HTTP is a different architecture than Wails

## Consequences

### Positive

- App shell is native GTK4 — no V8/JavaScriptCore overhead for 90% of UI
- Smaller attack surface: only raw-mode tabs execute remote JS, and only when user opts in
- Mature, production-tested rendering for raw-mode HTTP (WebKit on macOS is the same engine Safari uses)
- No contribution burden to Servo or Verso
- macOS WKWebView has best-in-class rendering fidelity for the platform

### Negative / accepted costs

- Platform webviews differ across platforms: WKWebView ≠ WebView2 ≠ WebKitGTK — features and behavior vary
- macOS: WKWebView doesn't natively embed in GTK4; requires a spike (see Phase 3 §3.4) — may require using `gtk::Socket` for native view embedding, or falling back to a separate-window raw mode
- WebView2 on Windows requires the Edge runtime to be installed (it usually is, but not always)
- WebKitGTK on Linux has different CSS rendering than WKWebView — same URL may render slightly differently across platforms

**Non-conformance is a release blocker.** If Phase 3 spike reveals that the embedded webview widget cannot be cleanly integrated with GTK4 on macOS, fall back to one of:

- **Fallback A:** Raw mode opens in a separate native window (not in-tab) — worse UX but ships
- **Fallback B:** Drop raw mode from 1.0 entirely; document as 1.1 follow-on. Reduces 1.0 scope.

## SPIKE outcome (p3-t4, 2026-08-12)

### Decision: Fallback A on macOS — separate native WKWebView window

The Phase 3 raw-mode spike (task p3-t4) reached an unambiguous conclusion:
**a `WKWebView` cannot be embedded *inside* a GTK4 tab on macOS.** The two
in-window options named in the phase doc are both impossible:

- **(a) `GtkSocket` embedding a native NSView — impossible.** `GtkSocket`/`GtkPlug`
  existed in GTK3 and were *X11-only*; they were removed in GTK4. There is no
  `gtk::nsview_to_widget` (that name does not exist in the gtk4 crate) and no
  per-widget foreign-view injection slot at all. GTK4 renders the entire widget
  tree through a single `GdkMacosView` (NSView); a second NSView cannot be
  parented into it. Confirmed by inspecting gtk4 0.9.7 + gtk4-sys (no quartz /
  socket / nsview APIs).
- **(b) `wry` wrapping WKWebView in a `gtk::Widget` — impossible on macOS.**
  `wry`'s GTK embedding (`WebViewBuilderExtUnix::build_gtk` / `new_gtk`) is
  **Linux/Unix only**. On macOS, `wry` builds a `WKWebView` that needs a native
  `NSWindow`/`NSView` parent (`HasWindowHandle` / `build_as_child`) — there is
  no path from a GTK-rendered window to a hostable NSView parent.
- **(c) Separate native window for raw mode — CHOSEN (Fallback A).** The raw-mode
  tab owns a separate native `NSWindow` hosting the `WKWebView`; the GTK tab
  hosts a placeholder widget and the window is positioned alongside it (Phase 4).
  Worse UX than in-tab, but ships raw mode in 1.0 (avoids Fallback B's scope cut).

### Second finding: Linux webkit6 was blocked by the gtk4 version pin (resolved)

A second spike finding initially blocked the Linux embedded widget:
**`webkit6` 0.6.x requires gtk4 0.11** (`gtk = "^0.11"`), while Hypernext pinned
gtk4 0.9. Cargo forbids two `gtk4-sys` copies in one graph (both link `gtk-4`), so
`webkit6` could not be added while the workspace pinned gtk4 0.9.

**Resolved** in the gtk4/relm4 0.11 + MSRV 1.93 + edition 2024 workspace upgrade
(plan 20260812-phase3-http-rawmode; an approved MSRV/edition contract change —
see worklog). The workspace now pins gtk4 0.11 and relm4 0.11, so `webkit6 0.6`
is enabled: `hypernext-webmode` declares it as the Linux raw-webview backend and
`RawWebViewLinux` hosts a real `webkit6::WebView` (which is a `gtk4::Widget`) in-
tab.

### Manual macOS test checklist (validated locally, not in CI)

The macOS webview is **not** exercised by CI (macos job is build-only; the test
job is ubuntu/xvfb). Manual verification on a macOS host:

1. `cargo test -p hypernext-webmode` on macOS — policy unit tests pass.
2. Instantiate `RawWebView::new(WebviewPolicy::standard())` on the GTK main
   thread — the companion `NSWindow` appears with the `WKWebView`.
3. `load_url("https://example.com")` — page renders; `https://example.com`
   loads in the window.
4. `set_policy(&WebviewPolicy::default())` — scripts disabled: a page with JS
   does not run scripts.
5. New-window (`window.open`) is suppressed (no UIDelegate).
6. Download link does not auto-download (Phase 4 confirmation hook pending).
7. Close the tab — the companion window is torn down with the `RawWebView`.

### Library-lookup results (objc2-web-kit 0.3.2)

- **objc2-web-kit 0.3.2** — MIT, active, the canonical WKWebView Rust binding.
  Verified API from the downloaded source: `WKWebViewConfiguration::new(mtm)`,
  `WKWebView::alloc(mtm)` + `initWithFrame_configuration(alloc, frame, &config)`,
  `NSURL::URLWithString`, `NSURLRequest::requestWithURL`, `NSWindow::new(mtm)`,
  `NSWindowStyleMask::{Titled,Closable,Resizable,Miniaturizable}`.
  Feature-gated per-class; pinned in workspace `[workspace.dependencies]`.
- **webkit6 0.6.x** — Linux WebKitGTK backend; requires gtk4 0.11, now pinned
  (resolved above). License MIT. Enabled in `hypernext-webmode` (Linux target).
- **wry** — rejected for macOS embedding (Linux-only `build_gtk`); not added.
- **webview2-com 0.39** — Windows-only; post-1.0 target; pinned in workspace.

### Phase-doc correction

Phase-doc 3.4 references `gtk4::nsview_to_widget` and `GtkSocket`, neither of
which exists in GTK4 (section 3.4 Implementation + the spike note). These were
corrected (see the phase doc diff in this change set); the spike note is
superseded by this ADR section.

## Future direction

A future Hypernext release (e.g. 5.0 Confidential or later) may revisit Servo embedding if:

1. Servo self-description changes from "prototype" to "stable"
2. wry ships a Servo backend (then Dioxus desktop could use it too, simplifying our path)
3. OR a production Rust app ships with embedded Servo, proving the integration pattern
4. AND we have 4-8 weeks of maintainer budget for a research spike

Until then, this ADR is final.

## References

### Servo

- Servo repo: <https://github.com/servo/servo>
- Servo on crates.io: <https://crates.io/crates/servo> (v0.4.0)
- Servo blog: <https://servo.org/blog/>
- Made with Servo: <https://servo.org/made-with>

### Verso (archived)

- Verso repo: <https://github.com/versotile-org/verso> (archived Oct 8 2025)
- Verso announcement: <https://wusyong.github.io/posts/verso-0-1>
- Tauri-Verso integration blog: <https://v2.tauri.app/blog/tauri-verso-integration>

### wry

- wry repo: <https://github.com/tauri-apps/wry>
- wry CHANGELOG: <https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md>
- Tauri funding discussion: <https://github.com/orgs/tauri-apps/discussions/15235>

### Platform webviews

- macOS WKWebView: <https://developer.apple.com/documentation/webkit/wkwebview>
- objc2-web-kit: <https://docs.rs/objc2-web-kit/latest/objc2_web_kit/>
- Linux WebKitGTK: <https://webkitgtk.org/reference/webkit2gtk/stable/>
- webkit6 crate: <https://crates.io/crates/webkit6>
- Windows WebView2: <https://learn.microsoft.com/en-us/microsoft-edge/webview2/>

## Decision review

This ADR should be reviewed:

- After Phase 3 spike completes (verify embedded webview integration works on macOS)
- After 1.0 ships (verify raw mode is actually used and worth the complexity)
- When Servo v1.0 is released (revisit the Servo embedding question)
