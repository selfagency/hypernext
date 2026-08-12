# Hypernext — Build Plan Overview

> An all-protocol internet client for viewing, interacting, and creating on the small web and smolnet.

**Status:** Draft for review
**Date:** 2026-08-11
**Owner:** Daniel / Selfagency
**Replaces:** All prior Bean plans (`docs/2026-08-06-MASTER-PLAN.md`, `docs/references/bean-v1-prd.md`, `docs/references/bean-v1-plan.md`, every per-feature plan in `docs/plans/`). The Go/Wails codebase is **reference material only** — no code carries over.

---

## 1. Why a rewrite

The Wails version of Bean reached v1.0 status per its own gate (`task check` green, 80% coverage, 11 URI handlers, Fallow clean) and is still **a total bust**. Three independent root causes made it unworkable as a foundation:

**1. The webview-as-app-chrome architecture was the problem, not the solution.** The React + shadcn + Tailwind frontend accumulated 80+ integration tests and 24 e2e suites — testing infrastructure consumed more effort than product features. Every protocol needed a Wails binding + a TypeScript type + a React component, which is what grew `app.go` into a 2,491-line / 129-method god-object that took three remediation passes (Wave 2 service extraction, Master Plan Phase 2.2) to make tractable. The webview that was supposed to give us "rich UI" instead became a bottleneck that multiplied every feature's surface area by three.

**2. The protocol surface was wrong.** Most of what Bean renders is not HTML. Gemini emits gemtext. Gopher emits menus. Finger emits structured text. Spartan, Nex, Text, Scroll, Molerat, Scorpion — all structured text or simple document trees. Spinning up a V8 engine to draw a paragraph is overhead no user benefits from. The webview should be a surgical tool for raw HTTP, not the entire app shell.

**3. Scope outpaced one maintainer.** 50+ internal Go packages, 12+ protocols, chat/email/usenet/IndieWeb/sync/editor all attempted in one release cycle. Even with AI assistance, this is multi-year work compressed into a "ship v1" deadline. The result is that no single subsystem ever got the depth it needed — every plan's "## Status" header contradicted the actual code state, and the 2026-08-06 master plan exists primarily to triage the gap.

A rewrite lets us correct all three at the architectural level rather than continuing to patch around them.

---

## 2. Architectural pivot

| Aspect | Bean v1 (Wails) | Hypernext |
|---|---|---|
| Language | Go + TypeScript | Rust (stable, 1.83+ MSRV) |
| App shell | Wails v3 + system webview + React | **Relm4 + GTK4 (native widgets, no webview)** |
| Raw HTTP | Webview with policy | One embedded `WebKitGTK`/`WKWebView`/`WebView2` widget, raw-mode tabs only |
| Reader HTTP | Defuddle extraction rendered as React blocks | `legible` extraction rendered as GTK widgets from `Block` tree |
| Authority model | "Go backend is authority, React is presentation" | Single Rust process; no IPC, no bindings, no type sync |
| Persistence | SQLite via `modernc.org/sqlite` | SQLite via `rusqlite` (`bundled` + `modernsqlite` features) |
| Vector search | Not implemented | `sqlite-vec` extension |
| Secrets | `zalando/go-keyring` | `keyring` crate v4.1.6 |
| Async runtime | Go goroutines | `tokio` v1.53 |
| Testing | Go `testing` + Vitest (frontend) | `cargo test` (unit/integration) + Playwright (E2E, drives webview via CDP) |
| Build | `wails3 build` | `cargo build` + `cargo-bundle` |
| Target OS (v1.0) | macOS primary, Linux/Windows secondary | macOS primary; Linux/Windows later releases |

### Why Relm4 + GTK4 instead of Dioxus / Iced / Tauri / Slint

The user explicitly requested a UI that "isn't itself web rendered." Four options were evaluated; see `docs/references/0001-ui-framework-choice.md` for the full ADR. Summary:

- **Relm4 + GTK4** — Native widgets, mature, complex desktop UI patterns (split panes, command palettes, hovercards, tree sidebars) all standard. Cross-platform but macOS/Windows require bundling GTK runtime (~30MB overhead). Best fit for the complex multi-pane layout Hypernext needs.
- **Iced** — Pure Rust, no GTK dependency, smaller binary. But fewer widgets, weaker a11y story, more custom code for complex layouts. Rejected for v1.
- **Slint** — Declarative DSL adds friction for AI agents writing code; better suited to kiosks. Rejected.
- **Dioxus desktop** — Would put us back in webview-as-app-chrome territory (same architecture that made Wails painful). Rejected.

### Why not "stable Rust browser engine"

The user asked for "stable rust browser engine." After research (`docs/references/0002-browser-engine-survey.md`):

- **Servo v0.4.0** self-describes as "prototype" in its own README. Tauri team (who tried to ship it via Verso) calls the embedding API "daunting." Zero production desktop apps ship Servo today.
- **Verso** (the ergonomic Servo wrapper) was archived Oct 8, 2025.
- **wry v0.56.0** (used by Dioxus desktop) does not yet support Servo as a backend — only "architectural preparation" for it.
- **Dioxus Native / Blitz** is explicitly "work in progress" and can't render modern HTTP sites.

A true Rust-native browser engine is not production-viable in 2026. The honest architecture is: native Rust UI for everything except raw HTTP, where we embed one platform webview surgically. This is actually *better* than the Wails approach because the webview is one widget among many, not the entire app.

---

## 3. Release dimensions

Hypernext ships in **dimension-named releases**, not feature-parity releases. Each dimension is a coherent capability area that ships when ready. This is the antidote to scope explosion: instead of "everything before v1," each release is a real product on its own.

| Release | Codename | Theme | Protocols / Capabilities | Target |
|---|---|---|---|---|
| **1.0** | Hypertext | The readable web | HTTP reader, Gemini, Gopher, Finger, Spartan, Nex, Text, Scroll, Molerat, Scorpion, Kepler, Titan upload, PGP verify, IndieAuth, WebFinger | ~6 months |
| **1.1** | Feeds | Subscribe and read | RSS, Atom, JSON Feed, Microsub, WebSub, Salmention, ActivityPub read-only, ATProto read-only, Nostr read-only | +2 months |
| **1.2** | Distributed | Peer-to-peer | IPFS, IPNS, Iroh, BitTorrent (librqbit), remoteStorage, Solid pod, ATProto write, Nostr write, Mastodon write | +3 months |
| **2.0** | Conversation | Real-time chat | IRC (`irc` crate), Matrix (`matrix-sdk`), XMPP (`xmpp` v0.7.0), WebRTC DataChannel (`webrtc`), MUC, MAM, OMEMO (Matrix), OTR (`otrr` if hardened) | +4 months |
| **3.0** | Workshop | Files and editing | SSH (`russh`), Telnet (`libmudtelnet-rs`), Mosh (`libmoshpit`), Eternal Terminal (`etr`), FTP, SFTP, ZMODEM, MUD/BBS profiles, built-in LSP editor (`tower-lsp`), userscripts | +3 months |
| **4.0** | Correspondence | Email and news | IMAP (`async-imap`), SMTP (`lettre`), MIME (`mail-parser`), GnuPG integration, NNTP, NZB/PAR2, Bayes spam | +3 months |
| **5.0** | Confidential | Privacy hardening | Onion routing via Arti, per-tab SOCKS5 webview, DoH (`hickory-resolver`), Privacy Shield (adblock rules + anti-fingerprinting), Capture consent coordinator | +2 months |
| **6.0** | Sync | Multi-device | Encrypted instance-to-instance sync over WebRTC, ECDH pairing, conflict resolution | +2 months |

**Releases are additive.** 1.1 ships after 1.0 ships. 1.2 ships after 1.1. The total Hypernext roadmap is roughly 24-30 months from start to 6.0, but each release is independently shippable.

### Why these splits

- **1.0 Hypertext is the foundation.** Every protocol here is read-only or single-action (Titan upload with explicit confirmation). No persistent connections, no streaming, no chat presence. A maintainer can ship this alone.
- **1.1 Feeds builds on 1.0.** Subscriptions and read-state are the natural second step; the protocol adapters are similar to 1.0's.
- **1.2 Distributed is "the small web grows up."** Adds IPFS/ATProto/Nostr write capabilities. Splitting from 1.1 because write paths need consent flows that read paths don't.
- **2.0 Conversation is the first persistent-connection release.** Chat protocols have very different UX from browsing; they deserve their own release. XMPP is here because the `xmpp` v0.7.0 crate is healthy — no need to write from scratch.
- **3.0 Workshop is everything terminal + editing.** These are power-user features that share a common terminal emulator widget (`alacritty_terminal`).
- **4.0 Correspondence is email + Usenet.** Both are "slow messaging" with threading and large local caches.
- **5.0 Confidential is the privacy release.** Onion routing, DoH, anti-fingerprinting — these are cross-cutting and benefit from having a stable app to layer onto.
- **6.0 Sync is last because it requires every prior capability to be stable before adding cross-instance replication.**

---

## 4. TDD requirements — non-negotiable

Every phase, every release, every feature ships with three layers of tests. No exceptions.

### 4.1 Unit tests (`cargo test`)

- Pure-function tests for parsers, normalizers, type conversions
- Run on every commit; <30 seconds total
- Use `pretty_assertions` for readable diff output
- Use `rstest` for parametric tables
- Mock external interfaces with `mockall`
- Target **80% line coverage minimum** per crate, enforced via `cargo-tarpaulin` in CI

### 4.2 Integration tests (`tests/` directory per crate)

- Test module boundaries: a protocol crate's `tests/` directory exercises its public API end-to-end against in-process mock servers
- Use `wiremock` for HTTP-based protocols, `tokio::net::TcpListener` for raw TCP protocols
- Every protocol adapter has a `fixtures/` directory of real captured responses (PGP-signed, includes edge cases)
- Target **70% line coverage minimum** at the integration level

### 4.3 End-to-end tests (Playwright)

- Drive the running Hypernext app via Playwright through CDP
- Tests live in `e2e/` at the repo root, separate from unit/integration tests
- Each release ships with a journey suite:
  - 1.0: 12 journey suites (one per protocol + shell + tabs + bookmarks + settings + PGP)
  - Each journey = visible assertion + side-effect assertion (database / keychain state)
- Target: every PRD acceptance criterion has at least one E2E test
- CI runs E2E against the bundled macOS app on every release tag

### 4.4 Manual release gate

- Before tagging a release, manually verify:
  - macOS .app launches cold < 2 seconds
  - Memory < 150MB idle
  - Binary < 60MB (GTK runtime + app)
  - URI scheme handlers register correctly
  - No panics in a 30-minute smoke test
- Documented in `docs/references/release-checklist.md`

### 4.5 AI-agent guidance (CRITICAL)

Most code in this plan will be written by AI agents. The plan must **explicitly guide agents to look up library docs**, not assume they know API shapes. Every phase doc contains a **"References to consult before writing code"** section that lists:

- Exact crate name and version
- URL of the crate's docs.rs page
- URL of the crate's repository README
- Specific API entry points the agent will need
- Specific gotchas or breaking changes documented in the crate's CHANGELOG

If an agent encounters a crate API that doesn't match what the phase doc describes, the agent MUST stop and update the phase doc before proceeding. This is non-negotiable — silent API drift is what made the Wails version's docs unreliable.

---

## 5. Phase structure (within 1.0 Hypertext)

The 1.0 release itself is broken into 5 internal phases. Each phase is a TDD cycle: write failing tests → implement → tests pass → refactor.

| Phase | Theme | What ships | Weeks |
|---|---|---|---|
| [Phase 1](phases/01-foundation-and-architecture.md) | Foundation & architecture | Cargo workspace, Relm4 shell, SQLite migrations, keyring, error types, logging, CI skeleton | 4 |
| [Phase 2](phases/02-smolnet-protocols.md) | Smolnet protocol adapters | Gemini, Gopher, Finger, Spartan, Nex, Text, Scroll, Molerat, Scorpion, Kepler, Titan upload, PGP verify | 8 |
| [Phase 3](phases/03-http-reader-and-raw-mode.md) | HTTP reader + raw mode | `legible` extraction, metadata, adblock rules, embedded webview widget for raw mode | 5 |
| [Phase 4](phases/04-browser-shell-and-persistence.md) | Browser shell + persistence | Tabs, history, bookmarks, settings, sidebar, location bar, web mode toggle, IndieAuth, WebFinger | 6 |
| [Phase 5](phases/05-release-1.0-gate.md) | Release 1.0 gate | E2E journey suites, packaging, URI handlers, release checklist | 3 |

**Total 1.0 timeline: ~26 weeks (6 months).** Aggressive but achievable for one maintainer with AI assistance, because the scope is bounded — no chat, no email, no sync in 1.0.

### Phase docs for releases 1.1 → 6.0

Each subsequent release has its own phase doc following the same TDD structure (sub-tasks, exit criteria, risk register, library references, AI-agent instructions). All seven future-release phase docs are written and ready for review:

| Release | Phase doc | Est. duration |
|---|---|---|
| 1.1 Feeds | [`phases/1.1-feeds.md`](phases/1.1-feeds.md) | 8 weeks |
| 1.2 Distributed | [`phases/1.2-distributed.md`](phases/1.2-distributed.md) | 12 weeks |
| 2.0 Conversation | [`phases/2.0-conversation.md`](phases/2.0-conversation.md) | 16 weeks |
| 3.0 Workshop | [`phases/3.0-workshop.md`](phases/3.0-workshop.md) | 12 weeks |
| 4.0 Correspondence | [`phases/4.0-correspondence.md`](phases/4.0-correspondence.md) | 12 weeks |
| 5.0 Confidential | [`phases/5.0-confidential.md`](phases/5.0-confidential.md) | 8 weeks |
| 6.0 Sync | [`phases/6.0-sync.md`](phases/6.0-sync.md) | 8 weeks |

**Total Hypernext roadmap: ~110 weeks (~27 months)** from start of 1.0 to end of 6.0. Each release is independently shippable; the dimension structure means a release can be delayed or skipped without blocking later ones.

Each future-release phase doc is written to be self-sufficient: a maintainer (human or AI agent) can read it without needing to re-read the 1.0 phase docs to understand the architecture, ADRs, or testing discipline. The phase doc references back to specific ADRs and prior-phase patterns where they apply.

---

## 6. Architectural decisions to record

The following ADRs live in `docs/references/` and must be read before writing any code:

| ADR | Decision | Status |
|---|---|---|
| `0001-ui-framework-choice.md` | Relm4 + GTK4 over Dioxus / Iced / Tauri / Slint | Accepted |
| `0002-browser-engine-survey.md` | Platform webviews via embedded widget; Servo deferred | Accepted |
| `0003-authority-model.md` | Single-process Rust; no IPC, no bindings | Accepted |
| `0004-storage-strategy.md` | rusqlite + sqlite-vec + refinery migrations | Accepted |
| `0005-tdd-discipline.md` | Unit + integration + E2E layers, coverage gates | Accepted |
| `0006-smolnet-protocol-crates.md` | Direct crates.io deps for the 0.1.0 protocol crates, pinned in lockfile | Accepted |
| `0007-keychain-only-secrets.md` | `keyring` crate; no plaintext fallback ever | Accepted |
| `0008-async-runtime.md` | tokio exclusively; no async-std mixing | Accepted |
| `0009-error-propagation.md` | `thiserror` for library errors, `anyhow` for app-level | Accepted |
| `0010-revision-control-and-ci.md` | Conventional commits, GitHub Actions matrix, no `--no-verify` | Accepted |

---

## 7. Open questions / unresolved items

These are explicitly flagged for resolution during the relevant phase. The plan does not pretend they are answered.

| # | Question | Resolved in phase | Notes |
|---|---|---|---|
| Q1 | GTK4 widget styling for non-default themes (Catppuccin, Dracula, Nord) — does GTK4's CSS layer support the full palette swap, or do we need a custom theme engine? | Phase 1 spike | The Wails version used shadcn tokens; GTK uses a different theming model |
| Q2 | How do we render `Block` trees (Gemini gemtext, Gopher menus) as GTK widgets without losing text selection across block boundaries? | Phase 2 spike | The Wails version leaned on HTML's selection model |
| Q3 | Does the embedded `WebKitGTK` widget on macOS use the system `WKWebView` or its own bundled WebKit? Bundled = +30MB binary; system = tighter platform integration. | Phase 3 spike | Tauri has the same problem; we should follow their decision |
| Q4 | The `xmpp` crate v0.7.0 README says "Still very much WIP" — what's the actual API stability for the chat release (2.0)? Do we pin to 0.7.0 or follow HEAD? | Phase 2.0 (chat) | Need to revisit when chat release approaches |
| Q5 | Solid OIDC + DPoP requires a JSON-LD parser; do we use `microformats` v0.19.0 for everything or bring in `kuchiki` (stale) or hand-roll? | Phase 1.2 (distributed) | Defer until distributed release |
| Q6 | The `tower-lsp` crate is stale (Aug 2023). Do we use it, fork it, or write our own thin LSP client? | Phase 3.0 (workshop) | Defer until workshop release |
| Q7 | Ad filtering in raw mode: use `adblock` v0.13.2 (Brave's crate) directly, or layer a `cosmetic-rules` engine on top? | Phase 3 (1.0 HTTP) | Start with `adblock` directly; layer if needed |
| Q8 | macOS code signing + notarization: who owns the developer ID, what's the CI flow for notarization? | Phase 5 (release gate) | Block release until answered |

---

## 8. Non-goals (explicit)

To prevent scope creep, these are explicitly out of scope for Hypernext in any release:

- **Mobile platforms** (iOS, Android). GTK4 mobile support is experimental; Relm4 does not target mobile. If mobile becomes a goal, that's a different product.
- **Browser extensions** (WebExtensions API). The embedded raw-mode webview is not a full browser; we don't expose extension hooks.
- **Cloud sync of any user data.** All data stays local. The 6.0 Sync release is instance-to-instance over WebRTC, not cloud.
- **Telemetry or analytics of any kind.** Zero outbound traffic to our servers. Network goes only to user-requested URLs.
- **Full Micropub server.** Hypernext ships a Micropub client (publish to user's endpoint); it is not itself a Micropub server.
- **AI tagging of bookmarks via cloud LLMs.** Local Harper spellcheck only. If AI tagging is added later, it must use a local model.
- **Electron or Chromium as a runtime.** The webview widget for raw mode is the system platform webview only, never Electron.

---

## 9. How to read this plan

**If you're an AI agent writing code:**
1. Read this overview first.
2. Read `docs/references/0001-ui-framework-choice.md`, `0003-authority-model.md`, and `0005-tdd-discipline.md` before writing any UI code.
3. Read the specific phase doc for the feature you're implementing.
4. Read every "References to consult before writing code" entry in that phase.
5. If a library API doesn't match what the phase doc says, STOP and update the phase doc.
6. Read `docs/references/crate-audit.md` to verify crate health before adding any dependency.
7. Append your work to `worklog.md` (repo root) (Task ID + Agent + Work Log + Stage Summary, per the project rules).

**If you're a human reviewing:**
1. Start here.
2. Read the ADRs in `docs/references/`.
3. Read each phase doc in order.
4. Push back on anything that doesn't make sense. This is a draft for review, not a directive.

**If you're a future maintainer:**
1. Read this overview + the ADRs.
2. Read the worklog from the relevant Task ID.
3. Trust the tests, not the docs. Docs drift; tests don't.

---

## 10. Document index

### Overview (this file)
- `docs/overview.md`

### Phase docs (1.0 Hypertext)
- `docs/phases/01-foundation-and-architecture.md`
- `docs/phases/02-smolnet-protocols.md`
- `docs/phases/03-http-reader-and-raw-mode.md`
- `docs/phases/04-browser-shell-and-persistence.md`
- `docs/phases/05-release-1.0-gate.md`

### Future release phase docs (all written — same TDD structure as 1.0)
- `docs/phases/1.1-feeds.md` — RSS/Atom/JSON Feed, WebSub, Salmention, ATProto/Nostr/ActivityPub read-only
- `docs/phases/1.2-distributed.md` — IPFS/Iroh/BitTorrent, remoteStorage, Solid, ATProto/Nostr/Mastodon write, crosspost dialog
- `docs/phases/2.0-conversation.md` — IRC, Matrix (with E2EE), XMPP, WebRTC DataChannel chat
- `docs/phases/3.0-workshop.md` — SSH/Telnet/Mosh/ET, FTP/SFTP, ZMODEM, MUD/BBS, LSP editor, userscripts
- `docs/phases/4.0-correspondence.md` — IMAP/SMTP/MIME, GnuPG, NNTP, NZB/yEnc/PAR2, Bayes spam
- `docs/phases/5.0-confidential.md` — Arti Tor, per-tab SOCKS5, DoH, Privacy Shield, capture consent
- `docs/phases/6.0-sync.md` — WebRTC sync, ECDH pairing, Yjs CRDTs, conflict resolution

### References
- `docs/references/0001-ui-framework-choice.md`
- `docs/references/0002-browser-engine-survey.md`
- `docs/references/0003-authority-model.md`
- `docs/references/0004-storage-strategy.md`
- `docs/references/0005-tdd-discipline.md`
- `docs/references/0006-smolnet-protocol-crates.md`
- `docs/references/0007-keychain-only-secrets.md`
- `docs/references/0008-async-runtime.md`
- `docs/references/0009-error-propagation.md`
- `docs/references/0010-revision-control-and-ci.md`
- `docs/references/crate-audit.md`
- `docs/references/release-checklist.md` (to be written in Phase 5)
- `docs/references/library-lookup-protocol.md` — guide for AI agents on how to verify a crate before depending on it

### Source material (read-only references)
- The original Go/Wails Bean codebase: not copied into Hypernext; consulted via the upstream repo when needed
- Original docs (Bean v1 PRD, master plan, etc.): consulted when verifying feature semantics, never used as authority for the rewrite

---

## 11. Next steps for the maintainer

1. **Review this overview.** Push back on anything that doesn't match your vision. This is the cheapest moment to change direction.
2. **Confirm the dimension roadmap** in §3. If the release ordering is wrong, now is the time to fix it.
3. **Decide the repo location.** The plan assumes `selfagency/hypernext` (fresh repo); adjust if you want a different name or org.
4. **Confirm the macOS-first decision.** If Linux-first is better, Phase 1's GTK bundling story changes.
5. **Read `docs/references/0001-ui-framework-choice.md` and `0002-browser-engine-survey.md`.** These are the two riskiest ADRs; if you disagree with either, we re-architect before writing code.
6. **Once approved, Phase 1 begins.** Phase 1's first task is creating the cargo workspace skeleton and CI; everything else depends on it.
