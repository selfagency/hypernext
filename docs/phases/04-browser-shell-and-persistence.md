# Phase 4 — Browser Shell & Persistence

> Phase 4 of the Hypernext 1.0 Hypertext release.
> Prerequisites: Phase 3 complete (HTTP, raw mode, adblock, PGP).
> Estimated duration: 6 weeks (single maintainer, AI-assisted)
> TDD requirement: Yes — three layers, same as before. E2E tests are heavier here because this phase ships the user-visible app.

---

## 1. Goal

Build the user-facing browser shell: tabs, windows, sidebar (tabs/bookmarks/history), location bar with unified search, navigation controls (back/forward/refresh/stop), keyboard shortcuts, settings dialog, IndieAuth login flow, WebFinger lookup, and all the persistence that ties them together. When Phase 4 ships, Hypernext is a usable browser — you can browse, bookmark, search history, log into IndieWeb sites, and configure the app.

This is the largest phase by UI surface area. It's also where the Wails version accumulated most of its complexity (80+ integration tests, 24 e2e suites). The Relm4 architecture should keep complexity bounded because there are no bindings to maintain.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ hypernext-app (binary)                                            │
│   main.rs                                                         │
│   - tokio runtime                                                 │
│   - RelmApp::new("com.selfagency.hypernext")                     │
│   - Initialize Store, Keychain, Dispatcher                       │
│   - Mount AppModel                                               │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ hypernext-ui                                                     │
│   AppModel (root Relm4 component)                                │
│   ├── WindowModel (per-window)                                   │
│   │   ├── HeaderBar (location bar, nav controls, mode toggle)   │
│   │   ├── SidebarModel                                           │
│   │   │   ├── Tabs view (open tabs + bookmarks unified)          │
│   │   │   ├── History view                                        │
│   │   │   └── Site Nav view (for HTTP sites with <nav>/sitemap)  │
│   │   ├── ContentArea                                             │
   │   │   ├── ReaderView (Phase 3)                              │
│   │   │   └── RawWebView (Phase 3)                              │
│   │   ├── FindBar (⌘F)                                          │
│   │   ├── SettingsDialog                                          │
│   │   ├── BookmarkDialog                                          │
│   │   ├── AuthorProfileDialog (contact cards)                   │
│   │   └── DebugView (⌘D)                                         │
│   └── IncognitoWindowModel (separate state)                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Sub-tasks

### 3.1 Window + tab lifecycle (Week 1-2)

**References to consult:**

- Relm4 worker/factory docs: https://relm4.org/docs/stable/factory.html — read in full
- Relm4 examples for tabs: https://github.com/Relm4/relm4/tree/main/examples — `tab_queue` and `factory_list` examples
- gtk4 `Notebook` widget: https://docs.gtk.org/gtk4/class.Notebook.html
- gtk4 `ApplicationWindow`: https://docs.gtk.org/gtk4/class.ApplicationWindow.html
- The original Bean's `frontend/src/lib/tabs.ts` and `frontend/src/components/browser-shell.tsx` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/window.rs`:
  - `struct WindowModel { tabs: FactoryVecDeque<TabModel>, active_tab: usize, ... }`
  - Messages: `OpenTab(Option<Url>)`, `CloseTab(usize)`, `SwitchTab(usize)`, `OpenUrlInNewTab(Url)`, `NewWindow`, `CloseWindow`
  - ⌘T → `OpenTab(None)` (blank tab + focus location bar)
  - ⌘W → `CloseTab(active)` (or `CloseWindow` if last tab)
  - ⌘N → `NewWindow`
  - ⇧⌘W → `CloseWindow`
- [ ] In `crates/hypernext-ui/src/tab.rs`:
  - `struct TabModel { url: Option<Url>, history: Vec<Url>, history_idx: usize, loading: bool, ... }`
  - Messages: `Navigate(Url)`, `Back`, `Forward`, `Refresh`, `Stop`, `LoadFinished(PageDoc)`, `LoadFailed(Error)`
  - **Load token pattern:** each navigation generates a unique `LoadToken`. If a new navigation supersedes an in-flight one, the old token is invalidated. The fetch result is dropped if its token doesn't match. This prevents the "stale fetch overwrites current tab" bug from the Wails version.
- [ ] In `crates/hypernext-ui/src/app.rs`:
  - `struct AppModel { windows: FactoryVecDeque<WindowModel>, ... }`
  - On startup: restore last session's windows + tabs (if setting enabled)
  - ⌘Q → quit, persisting current session

**TDD gate:**

Unit tests (with mock Dispatcher):
- `OpenTab(None)` adds a tab to the factory, switches active to it
- `CloseTab(0)` removes it, switches to next or closes window if last
- Load token: starting a new navigation before the old completes → old result is dropped
- Session restore: save 3 tabs, close app, reopen → 3 tabs restored

Integration tests:
- Launch app, send `OpenTab(Some("gemini://localhost"))` (mock), wait for `LoadFinished`, assert tab count
- Launch app, send `OpenTab` then `CloseTab`, assert tab count back to 0 → window closes

### 3.2 Location bar with unified search (Week 2)

**References to consult:**

- gtk4 `Entry` widget: https://docs.gtk.org/gtk4/class.Entry.html
- gtk4 `EntryCompletion`: https://docs.gtk.org/gtk4/class.EntryCompletion.html
- Original Bean's `frontend/src/components/command-bar.tsx` (consult upstream for command-bar semantics; we're using a simpler location bar in 1.0)
- Original Bean's `frontend/src/lib/command-bar-parser.ts` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/location_bar.rs`:
  - `struct LocationBarModel { input: String, completions: Vec<Completion>, selected: Option<usize> }`
  - `enum Completion { OpenTab(...), HistoryMatch(...), BookmarkMatch(...), ProtocolSuggestion(scheme) }`
  - On input change (debounced 200ms):
    1. If input is a URL (has scheme or contains `.`): suggest navigation
    2. Search bookmarks (FTS5 query) → top 5
    3. Search history (FTS5 query) → top 5
    4. Match open tabs (URL or title contains input) → top 3
    5. Protocol suggestions: typing `gem` suggests `gemini://`, etc.
  - Enter → `Navigate(normalize_address(input))` (uses `Dispatcher::normalize_address` from Phase 2)
  - Tab → complete to first suggestion (protocol completion or URL completion)
  - Esc → clear input
  - ⌘L → focus the location bar, select all
- [ ] **Enter supersedes active load (PRD N-09):** If a fetch is in flight when Enter is pressed, the new navigation cancels the old (load token from §3.1).

**TDD gate:**

Unit tests:
- Typing `geminiprotocol.net` → Enter → navigates to `gemini://geminiprotocol.net/`
- Typing `gem` → first suggestion is `gemini://`
- Tab completes the protocol suggestion
- Typing `example` → suggests bookmarks + history containing "example"
- Enter on a completion switches to that tab (if it's an `OpenTab` match)
- Enter always supersedes active load (verified by mock Dispatcher)

Integration tests:
- Real FTS5 query against in-memory SQLite with fixture bookmarks/history
- Type, debounce, assert completion list updates

### 3.3 Sidebar: tabs + bookmarks unified (Week 3)

The original PRD called for "Tabs | History | Bookmarks" as three sidebar tabs. The remediated design (PRD FR-4) collapses tabs + bookmarks into one unified saved-link model: a tab can be pinned/bookmarked, sorted into folders, reordered, and closed without deleting the saved bookmark. We follow the unified model.

**References to consult:**

- Relm4 `FactoryVecDeque` for list rendering: https://relm4.org/docs/stable/factory.html
- gtk4 `ListBox`: https://docs.gtk.org/gtk4/class.ListBox.html
- gtk4 `TreeModel` + `ColumnView` for folder trees: https://docs.gtk.org/gtk4/class.ColumnView.html
- The original Bean's `frontend/src/components/tab-sidebar.tsx` and `frontend/src/components/library/library-view.tsx` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/sidebar.rs`:
  - `struct SidebarModel { active_view: SidebarView, saved_links: Vec<SavedLink>, folders: Vec<Folder>, history: Vec<HistoryEntry> }`
  - `enum SidebarView { TabsBookmarks, History, SiteNav }`
  - `struct SavedLink { id, url, title, folder_id, pinned, ... }` — the unified record
  - ⌘S → toggle sidebar collapse
  - ⇧⌘F → focus sidebar search (searches whatever view is active)
- [ ] **SavedLink model (PRD N-02):** No separate `pin` and `bookmark` records. A `SavedLink` has `url/title/folder/order/pinned`. Closing a tab keeps the `SavedLink`; opening a URL that matches an existing `SavedLink` reuses it.
- [ ] Sortable folders (PRD N-03): create/rename/delete folders, reorder records within and across folders. Drag-drop is a 1.1 follow-on; v1 ships with context-menu move.
- [ ] History view (PRD N-07): most-recent-first, click to open, right-click to delete, clear-all. FTS5 search via the same `capture_fts` table used for bookmarks.
- [ ] Site Nav view (PRD N-07): for HTTP sites with `<nav>` element or `sitemap.xml`, render the nav tree in the sidebar. Uses `scraper` to extract `<nav>`, fetches `/sitemap.xml` if no `<nav>`.

**TDD gate:**

Unit tests:
- `SavedLink` with `pinned=true` survives tab close
- Creating a folder, adding 3 links, reordering → persists to DB
- History search: type "gemini" → only gemini entries appear
- Clear-all history: deletes all `browsing_history` rows
- Site Nav: parse a fixture HTML with `<nav>` → produces a tree of links

Integration tests:
- Launch app, open 3 tabs, close 1, assert the saved-link still appears in the sidebar
- Launch app, visit 5 URLs (mock), assert history list shows them in reverse chronological order

### 3.4 Navigation controls + favicon (Week 3)

**References to consult:**

- gtk4 `Button`: https://docs.gtk.org/gtk4/class.Button.html
- gtk4 `Image`: https://docs.gtk.org/gtk4/class.Image.html
- Original Bean's `frontend/src/components/nav-toolbar.tsx` (consult upstream)
- favicon extraction: parse `<link rel="icon">` and `<link rel="shortcut icon">` from HTML; fetch via the same SSRF-bounded HTTP client
- Protocol-colored fallback badge (PRD N-10): if no favicon, render a rounded square with the site initial, colored by protocol (Gemini = green, Gopher = blue, Finger = orange, etc.)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/nav_toolbar.rs`:
  - Back / Forward / Refresh / Stop / Home buttons
  - Refresh: if ⇧ held, clear cache for URL first (cache-bypassing reload)
  - Favicon: 16x16 `gtk::Image` in the location bar; falls back to protocol-colored badge
  - Progress bar: thin bar at the bottom of the location bar showing fetch progress (bytes received / total)

**TDD gate:**

Unit tests:
- Back button disabled when `history_idx == 0`
- Forward button disabled when at end of history
- Favicon URL extraction: fixture with `<link rel="icon" href="/favicon.ico">` → `https://example.com/favicon.ico`
- Favicon URL extraction: no `<link>` → fallback to `/favicon.ico`
- Protocol-colored badge: Gemini → green color code; Gopher → blue; etc. (exact codes in `theme.rs`)

### 3.5 Find-in-page (Week 4)

**References to consult:**

- gtk4 `SearchEntry`: https://docs.gtk.org/gtk4/class.SearchEntry.html
- gtk4 `TextIter` for searching in `TextView`: https://docs.gtk.org/gtk4/struct.TextIter.html
- Original Bean's `frontend/src/components/find-bar.tsx` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/find_bar.rs`:
  - ⌘F opens the find bar at the top of the content area
  - Search is over the rendered `gtk::TextView` (for code blocks) + labels (for paragraphs) — uses `gtk::Widget::activate_action("misc.find", ...)` if available, otherwise iterates the widget tree
  - Match highlighting via Pango attributes
  - Next/Previous (⌘G / ⇧⌘G), match count
  - Esc closes
  - If the Phase 2 text-selection spike (§3.11) revealed limitations in cross-block search, document find-in-page limitations in `docs/references/text-selection-strategy.md`

**TDD gate:**

Unit tests:
- Find "test" in a 3-paragraph document → 3 matches highlighted
- Find non-existent string → "No matches" indicator
- Next/Previous cycles correctly

### 3.6 Settings dialog (Week 4)

**References to consult:**

- Relm4 dialog patterns: https://relm4.org/docs/stable/component.html#dialogs
- gtk4 `PreferencesWindow` or custom `Dialog`: https://docs.gtk.org/gtk4/class.Dialog.html
- Original Bean's `frontend/src/components/settings/` (consult upstream — 12 categories)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/settings_dialog.rs`:
  - 1.0 settings categories (cut down from the Wails version's 12):
    1. **General** — homepage, session restore on/off
    2. **Reading** — font family, font size, line height, content max-width (40-80rem slider)
    3. **Browser** — raw mode default, adblock on/off, JS sandboxing (raw mode)
    4. **Privacy** — incognito default, clear on close, SSRF block private network
    5. **Network** — proxy settings, DoH (placeholder for Phase 5)
    6. **Advanced** — debug mode on/off, log level
  - Bulk `get_settings()` / `set_settings()` bindings store everything in the `settings` table as JSON
  - Secret keys (IndieAuth tokens, ATProto tokens, etc.) stored in keychain, not settings; UI shows "set" / "unset" status only

**TDD gate:**

Unit tests:
- Every settings key has a UI control (verified by static check)
- `set_settings({"reading.font_size": 18})` → `get_settings()["reading.font_size"] == 18`
- Secret keys: setting "indieauth.token" via `set_settings` is rejected (must use keychain API)

### 3.7 IndieAuth client (Week 5)

**References to consult:**

- IndieAuth spec: https://indieauth.spec.indieweb.org/ — read in full
- PKCE (RFC 7636): https://www.rfc-editor.org/rfc/rfc7636
- Loopback redirect: https://datatracker.ietf.org/doc/html/rfc8252#section-7.3
- Original Bean's `internal/auth/indieauth.go` and `internal/auth/pkce.go` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-indieauth/src/lib.rs`:
  - `pub async fn discover(website: &Url, http_client: &reqwest::Client) -> Result<IndieAuthEndpoints, Error>`
    - Fetches the website, parses `<link rel="authorization_endpoint">` and `<link rel="token_endpoint">` and `<link rel="indieauth-metadata">`
  - `pub fn generate_pkce() -> (Verifier, Challenge)`
    - Code verifier: 64 random URL-safe characters
    - Code challenge: SHA256(verifier) base64url
  - `pub fn build_auth_url(endpoint: &Url, redirect_uri: &Url, client_id: &Url, state: &str, challenge: &str, scope: &str) -> Url`
  - `pub async fn exchange_code(code: &str, verifier: &str, token_endpoint: &Url, client: &reqwest::Client) -> Result<TokenResponse, Error>`
  - **Loopback HTTP server (RFC 8252 §7.3):** bind a `tokio::net::TcpListener` on `127.0.0.1:0` (random port); the OS-assigned port becomes part of the redirect URI; listen for one request, extract the `code` param, return it
- [ ] Store the resulting token in the keychain with account `indieauth.<website>`
- [ ] UI (in Phase 4): a "Sign in with your website" dialog; opens system browser for the auth flow (we don't use the embedded webview — it's a third-party auth page, not our content)

**TDD gate:**

Unit tests:
- `discover` on a fixture HTML with the three `<link>` tags → returns correct endpoints
- `generate_pkce` produces a 64-char verifier and a 43-char base64url challenge
- `build_auth_url` includes all required params
- `exchange_code` against a mock token endpoint → returns token
- Loopback server: starts, accepts one request, extracts code, shuts down

Integration tests:
- Full flow against a mock IdP (wiremock):
  - Discover endpoints
  - Generate PKCE
  - Build auth URL
  - Mock user visit (curl to auth URL, mock IdP redirects to loopback)
  - Loopback catches the redirect, extracts code
  - Exchange code for token
  - Token stored in keychain
  - Verify token can be retrieved (but not its value — only presence)

### 3.8 WebFinger lookup (Week 5)

WebFinger was implemented as a protocol adapter in Phase 2 §3.7. Here we expose it as a UI building block: typing `@user@example.com` in the location bar triggers a WebFinger lookup and offers to navigate to the user's profile, blog, etc.

**References to consult:**

- RFC 7033: https://www.rfc-editor.org/rfc/rfc7033
- Original Bean's `internal/webfinger/webfinger.go` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/location_bar.rs`:
  - If input matches `^@[\w.]+@[\w.]+$` (acct format), do a WebFinger lookup on `https://<host>/.well-known/webfinger?resource=acct:<user>@<host>`
  - Display the resulting links (profile, blog, etc.) as completions
  - Enter on a completion navigates to the chosen URL

**TDD gate:**

Unit tests:
- `@user@example.com` triggers a WebFinger lookup
- WebFinger returns 3 links → all 3 appear as completions
- WebFinger returns 404 → no completions, input treated as raw string
- Acct without `@` prefix doesn't trigger lookup

### 3.9 Bookmark dialog + collections (Week 5-6)

**References to consult:**

- gtk4 `Dialog`: https://docs.gtk.org/gtk4/class.Dialog.html
- gtk4 `Entry`, `ComboBox`: https://docs.gtk.org/gtk4/class.Entry.html
- Original Bean's `frontend/src/components/bookmark-dialog.tsx` and `frontend/src/components/library/` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/bookmark_dialog.rs`:
  - ⌘B opens the dialog with current page pre-filled
  - Fields: title (editable), URL (read-only), folder (select/create), tags (multi-select), notes (textarea), mode preference (Reader/Raw/default)
  - Save → `SavedLink` record in DB; close dialog
  - "Save to collection" extends with: highlight a passage (text selection), preserve format (wayback/archivebox/singlefile — deferred to later release, document as TODO)
- [ ] Right-click on a `SavedLink` in the sidebar → edit dialog
- [ ] Delete: confirm dialog, then delete from `bookmarks` table

**TDD gate:**

Unit tests:
- Save a bookmark → `bookmarks` row with expected fields
- Edit a bookmark → row updated
- Delete a bookmark → row removed; if folder is now empty, optionally delete folder
- Tags: adding a tag creates `tags` row if not exists, links via `bookmark_tags`

### 3.10 Incognito windows (Week 6)

**References to consult:**

- Original Bean's `docs/plans/2026-08-03-incognito-hardening/` (consult upstream — 14 binding gates were the Wails version's solution; the single-process Rust version is simpler)
- Privacy plan: `docs/plans/privacy-plan.md` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/window.rs`:
  - `struct WindowModel { ..., is_incognito: bool }`
  - ⇧⌘N → opens a new incognito window
  - Incognito windows:
    - Use a separate in-memory SQLite database (`:memory:` URL) that's discarded when the window closes
    - Never write to `browsing_history`, `bookmarks`, `page_cache`
    - Disable Titan upload, IndieAuth login, bookmark save, history search (the buttons are greyed out with tooltips)
    - Force `WebMode::Reader` for all HTTP (raw mode disabled in incognito)
    - Disable WebSub, sync, capture (none exist in 1.0 anyway)
- [ ] Visual indicator: dark theme + "Incognito" badge in header bar

**TDD gate:**

Unit tests:
- Opening an incognito window uses an in-memory DB
- Visiting a URL in incognito → no rows in `browsing_history` (verified on the main DB)
- Closing the incognito window → in-memory DB is dropped (no trace)
- Raw mode toggle in incognito → disabled (button returns false)
- IndieAuth login in incognito → disabled (button returns false)

### 3.11 Keyboard shortcuts + a11y (Week 6)

**References to consult:**

- gtk4 `ShortcutController`: https://docs.gtk.org/gtk4/class.ShortcutController.html
- gtk4 `EventControllerKey`: https://docs.gtk.org/gtk4/class.EventControllerKey.html
- GTK4 a11y: https://docs.gtk.org/gtk4/iface.Accessible.html
- Original Bean's `frontend/src/lib/shortcuts.ts` (consult upstream)

**Implementation:**

- [ ] In `crates/hypernext-ui/src/shortcuts.rs`:
  - Register all shortcuts:
    - ⌘T → new tab + focus location bar
    - ⌘W → close tab
    - ⇧⌘W → close window
    - ⌘N → new window
    - ⇧⌘N → new incognito window
    - ⌘S → toggle sidebar
    - ⌘B → bookmark current page
    - ⌘D → toggle debug view
    - ⌘L → focus location bar
    - ⌘F → find in page
    - ⇧⌘F → focus sidebar search
    - ⌘R → refresh
    - ⇧⌘R → cache-bypassing refresh
    - ⌘] / ⌘[ → forward / back
    - ⌘1..⌘9 → switch to tab N
    - Ctrl+Tab / Ctrl+Shift+Tab → cycle tabs
- [ ] Accessibility:
    - Every interactive widget has an `accessible_role` and `accessible_label`
    - Tab list uses `gtk::AccessibleRole::TabList`
    - Run `gtk4-inspector`'s a11y checker in CI (if possible; otherwise manual)
    - AT-SPI on Linux, AXUIElement on macOS — GTK4 abstracts this

**TDD gate:**

Unit tests:
- Each shortcut is registered (verify via `ShortcutController` lookup)
- ⌘T opens a tab and focuses location bar
- ⌘W closes the active tab
- ⌘D toggles debug view visibility

Integration tests:
- Launch app, simulate ⌘T keystroke, assert a new tab is created and location bar is focused

---

## 4. Phase exit criteria (Phase 4 → Phase 5 gate)

- [ ] Tabs, windows, incognito windows work
- [ ] Location bar with unified search (tabs + history + bookmarks + protocol suggestions)
- [ ] Sidebar with Tabs/Bookmarks unified, History, Site Nav
- [ ] Navigation controls (back/forward/refresh/stop/home)
- [ ] Find-in-page (with documented limitations from Phase 2 spike)
- [ ] Settings dialog with 6 categories
- [ ] IndieAuth login flow works end-to-end against a mock IdP
- [ ] WebFinger lookup for `@user@host` format
- [ ] Bookmark dialog with collections, tags, notes
- [ ] Incognito windows enforce: no history, no bookmarks, no Titan, no IndieAuth, raw mode disabled
- [ ] All keyboard shortcuts registered and working
- [ ] a11y: every interactive widget has role + label
- [ ] `cargo test --workspace` passes with ≥70% overall coverage
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] No `--no-verify` in git history
- [ ] `worklog.md` up to date

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Relm4 component model has steep learning curve; AI agents may struggle | High | Medium | Read every Relm4 example; document patterns in `docs/references/relm4-patterns.md` as discovered |
| R2 | Cross-block text selection spike (Phase 2 §3.11) blocks find-in-page | Medium | Medium | Spike done in Phase 2; if blocked, find-in-page is per-block only for 1.0 (documented) |
| R3 | IndieAuth loopback redirect doesn't work cleanly on macOS (App Sandbox) | Medium | High | macOS app not sandboxed in 1.0 (acceptable for indie dev); document for future App Store distribution |
| R4 | Incognito enforcement has gaps (a future protocol writes to persistent state) | Medium | High | All future protocol adapters must accept `FetchContext.incognito` and respect it; integration test asserts zero writes for incognito fetch |
| R5 | Settings dialog grows beyond 6 categories as features are added in later releases | High | Low | Architecture supports adding categories; no migration needed |
| R6 | Favicon fetch is itself an SSRF vector (attacker sets `<link rel="icon" href="http://internal/">`) | Medium | Medium | All favicon fetches go through `FetchPolicy::check_url` |

---

## 6. References

### GTK / Relm4

- Relm4 docs: https://relm4.org/docs/stable/
- Relm4 book: https://relm4.org/book/stable/
- Relm4 examples: https://github.com/Relm4/relm4/tree/main/examples
- gtk4-rs book: https://gtk-rs.org/gtk4-rs/stable/latest/book/
- gtk4-rs widget reference: https://gtk-rs.org/gtk4-rs/stable/latest/docs/
- gtk4 `Notebook`: https://docs.gtk.org/gtk4/class.Notebook.html
- gtk4 `ListBox`: https://docs.gtk.org/gtk4/class.ListBox.html
- gtk4 `EntryCompletion`: https://docs.gtk.org/gtk4/class.EntryCompletion.html
- gtk4 `ShortcutController`: https://docs.gtk.org/gtk4/class.ShortcutController.html
- gtk4 `Accessible`: https://docs.gtk.org/gtk4/iface.Accessible.html

### IndieAuth / WebFinger

- IndieAuth spec: https://indieauth.spec.indieweb.org/
- PKCE: https://www.rfc-editor.org/rfc/rfc7636
- Loopback redirect: https://datatracker.ietf.org/doc/html/rfc8252#section-7.3
- WebFinger: https://www.rfc-editor.org/rfc/rfc7033
- Original Bean's `internal/auth/indieauth.go` (consult upstream)

### Original Bean reference (consult, do not copy)

- `frontend/src/lib/tabs.ts` — tab model
- `frontend/src/components/browser-shell.tsx` — shell
- `frontend/src/components/tab-sidebar.tsx` — sidebar
- `frontend/src/components/location-bar.tsx` — location bar
- `frontend/src/components/nav-toolbar.tsx` — nav controls
- `frontend/src/components/find-bar.tsx` — find-in-page
- `frontend/src/components/settings/` — settings dialog
- `frontend/src/lib/shortcuts.ts` — keyboard shortcuts
- `docs/plans/2026-08-03-incognito-hardening/` — incognito hardening
- `docs/plans/privacy-plan.md` — privacy policy

---

## 7. AI-agent instructions for Phase 4

**Before writing code:**

1. Read the Relm4 docs and book chapters on components, factories, and workers. These are the core abstractions for Phase 4.
2. Read every Relm4 example that touches tabs, dialogs, or lists.
3. Read the original Bean's frontend components listed in §6 — they show the semantics we need to preserve (but not the React-specific implementation).
4. Read `docs/references/0003-authority-model.md` — the single-process Rust model changes how state propagates.

**While writing code:**

1. **Load tokens are mandatory for every navigation.** Don't skip them. The "stale fetch overwrites current tab" bug is a regression we will not allow.
2. **Incognito is enforced at the FetchContext level, not the UI.** UI greys out buttons for clarity, but the actual enforcement is in `FetchContext.incognito` propagating to every protocol/store write.
3. **IndieAuth uses the system browser for the auth flow, not the embedded webview.** The auth page is third-party content; it doesn't belong in our embedded webview.
4. **Every widget gets a11y attributes.** `accessible_role` and `accessible_label` are not optional.
5. **Settings use the bulk `get_settings`/`set_settings` API.** Don't add per-key bindings — that's what bloated the Wails version's `app.go`.

**After writing code:**

1. Run `cargo test -p hypernext-ui` (requires a display).
2. Update `worklog.md`.
3. Conventional Commits: `feat(phase-4): add tab lifecycle`, `test(phase-4): cover load token invalidation`, `docs(phase-4): document incognito enforcement`.

**If you get stuck on Relm4 patterns:**

1. Read the Relm4 examples again — they cover most patterns.
2. If a pattern isn't covered, document the question in `worklog.md` and propose a solution; don't block.
3. Relm4 is well-documented but not as universally known as React. AI agents may need to consult the docs more often — that's expected.
