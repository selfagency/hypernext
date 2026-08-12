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

**Positive**

- App shell is native GTK4 — no V8/JavaScriptCore overhead for 90% of UI
- Smaller attack surface: only raw-mode tabs execute remote JS, and only when user opts in
- Mature, production-tested rendering for raw-mode HTTP (WebKit on macOS is the same engine Safari uses)
- No contribution burden to Servo or Verso
- macOS WKWebView has best-in-class rendering fidelity for the platform

**Negative / accepted costs**

- Platform webviews differ across platforms: WKWebView ≠ WebView2 ≠ WebKitGTK — features and behavior vary
- macOS: WKWebView doesn't natively embed in GTK4; requires a spike (see Phase 3 §3.4) — may require using `gtk::Socket` for native view embedding, or falling back to a separate-window raw mode
- WebView2 on Windows requires the Edge runtime to be installed (it usually is, but not always)
- WebKitGTK on Linux has different CSS rendering than WKWebView — same URL may render slightly differently across platforms

**Non-conformance is a release blocker.** If Phase 3 spike reveals that the embedded webview widget cannot be cleanly integrated with GTK4 on macOS, fall back to one of:

- **Fallback A:** Raw mode opens in a separate native window (not in-tab) — worse UX but ships
- **Fallback B:** Drop raw mode from 1.0 entirely; document as 1.1 follow-on. Reduces 1.0 scope.

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
