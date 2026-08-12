# AGENTS.md — Hypernext Operating Contract

> **This is your operating contract. Do not deviate from it.**
> Read in full before writing any code. If anything here conflicts with a general rule, **this file wins**.
> Applies to: `**` (all files, all sessions, all agents).

---

## 1. Project Overview

**Hypernext** is an all-protocol internet client for viewing, interacting, and creating on the small web and smolnet. It's a Rust desktop app — native GTK4 widgets for the app shell, an embedded platform webview surgically used only for raw-mode HTTP tabs.

**Stack:**
- Rust 1.83+ (stable, MSRV enforced via CI)
- Relm4 + GTK4 (native UI; **not** a webview-based shell)
- tokio (exclusive async runtime — ADR 0008)
- rusqlite + refinery + sqlite-vec (storage — ADR 0004)
- keyring crate (OS keychain only — ADR 0007)
- Embedded WebKitGTK / WKWebView / WebView2 (raw-mode HTTP only — ADR 0002)

**Target OS (1.0):** macOS 14+. Linux/Windows added in later releases.

**Roadmap:** dimension-based releases — 1.0 Hypertext → 1.1 Feeds → 1.5 Distributed → 2.0 Conversation → 3.0 Workshop → 4.0 Correspondence → 5.0 Confidential → 6.0 Sync. See `docs/overview.md` §3 for the full matrix.

**Maintainer:** single developer, AI-agent-assisted. The plan must be realistic for one person, not a team. AI agents do most of the code; this file is their contract.

---

## 2. Required Reading (in order, before writing any code)

1. **This file** — `AGENTS.md` (you're here).
2. **`docs/overview.md`** — strategic spine, dimension roadmap, open questions.
3. **The ADRs in `docs/references/`:**
   - `0001-ui-framework-choice.md` — Relm4 + GTK4 (why not Dioxus/Tauri/Iced)
   - `0002-browser-engine-survey.md` — why platform webviews, not Servo
   - `0003-authority-model.md` — single-process Rust, no IPC
   - `0004-storage-strategy.md` — rusqlite + refinery + sqlite-vec
   - `0005-tdd-discipline.md` — three test layers, coverage gates
   - `0006-fork-vendored-smolnet-crates.md` — 10 crates fork-vendored
   - `0007-keychain-only-secrets.md` — keyring crate, no plaintext fallback
   - `0008-async-runtime.md` — tokio exclusively
   - `0009-error-propagation.md` — thiserror + anyhow
   - `0010-revision-control-and-ci.md` — Conventional Commits, no `--no-verify` ever
4. **`docs/references/library-lookup-protocol.md`** — the 6-step protocol for verifying a crate before depending on it. **Non-negotiable.**
5. **`docs/references/crate-audit.md`** — health audit of 124+ crates; consult before adding any dependency.
6. **The relevant phase doc in `docs/phases/`** for the feature you're implementing. Every phase doc has a "References to consult before writing code" section — read every URL in it.
7. **`/home/z/my-project/worklog.md`** — append your work after every Task ID (see §11).

---

## 3. Workflow (Non-Negotiable)

1. **Receive → Clarify**: Identify constraints (security, perf, a11y, macOS-first, single-maintainer realism). **Primacy of user directives**: explicit user commands override any general rule.

2. **Research → Plan**: Use `context7` MCP and `exa` MCP for library/API research when available. Use the `web-search` and `web-reader` skills as fallbacks. Read codebase via `magic-context` if available. **Verify version-dependent APIs, breaking changes, and performance implications before design.** For Hypernext specifically: every crate dependency must follow `docs/references/library-lookup-protocol.md`.

3. **Plan → Approve**: Numbered subtasks, file changes, test strategy, internal todo list. **Declare intent**: concisely state action and purpose before executing any tool. Wait for approval unless explicitly authorized.

4. **Branch Strategy**:
   - **GitButler enabled** (~/.agents/skills/gitbutler/SKILL.md): virtual branch workflow. Isolate logical changes. Commit frequently with Conventional Commits.
   - **GitButler disabled** (~/.agents/skills/git-mcp-workflow/SKILL.md): use `git-mcp` for Git Flow or standard `feature/`, `fix/`, `chore/` branches from `main`. Prefix per ADR 0010.
   - **Hypernext commit format**: `feat(phase-N): description`, `fix(phase-N):`, `test(phase-N):`, `docs(phase-N):`, `chore(phase-N):`, `refactor(phase-N):`, `perf(phase-N):`. For release-phase work: `feat(1.1):`, `fix(2.0):`, etc. (per ADR 0010).

5. **TDD-First**: Red (failing test) → Green (minimal pass) → Refactor. **All checks must pass** before commit:
   - `cargo fmt --check`
   - `cargo clippy --workspace -- -D warnings`
   - `cargo test --workspace`
   - `cargo deny check`
   - No `--no-verify` in history (`scripts/check-no-verify.sh` enforces this)
   - Use `opencode-pty` for watch modes and long-running processes (`cargo watch`, test watchers, dev servers). Do NOT use `opencode-pty` for one-off commands.
   - Use `aft` for CLI task orchestration.

6. **Regular Commits**: After each logical code change, commit with conventional message. Update internal todo list immediately after commit. Reference the Task ID in commit body when applicable.

7. **Context Management**: Use `magic-context` to track project state, dependencies, and working context. Never search entire filesystem; restrict to project folder unless user provides external path.

8. **Draft PR** (if applicable): title references issue; summary + test plan in body. Do not merge.

---

## 4. Tool Priority & Mandatory File Safety (STRICT)

1. **GitButler / git-mcp**: Preferred for safe branch and repository operations.
2. **MCP tools**: `git-mcp`, `context7`, `exa` for repository, documentation, and search operations.
3. **opencode-pty**: For persistent processes (dev servers, `cargo watch`, test watchers, build monitors). **Do NOT use for one-off commands.**
4. **aft**: For task orchestration, multi-step workflows, and script composition.
5. **MANDATORY: NO HEREDOCS**: Terminal heredoc operations (`cat > file << EOF`, `tee`, `>>`) are **FORBIDDEN**. File corruption risk.
   - To create/modify files: use the `Write` or `Edit` tool only.
   - Terminal use allowed ONLY for: package management (`cargo add`), builds (`cargo build`), running tests (`cargo test`), and navigation (`ls`, `cd`).
6. **Script Persistence**: For any non-trivial script (>10 lines), save it to `/home/z/my-project/scripts/<name>.rs` (or `.py`, `.sh`) first via `Write`, then execute. On failure, edit the saved script — do NOT regenerate inline. (Same rule as the main project instructions §9.)
7. **CLI**: Last resort only. Use argument arrays, never pipe multi-line strings.

---

## 5. Planning Phase (Critical Depth)

Before any code execution:

1. **Deep Research**: Use `context7` (library docs) and `exa` (web search) to verify assumptions, API signatures, breaking changes, and performance characteristics. For Hypernext specifically, **always** cross-reference `docs/references/crate-audit.md` for the crate's health.
2. **Architecture Review**: Diagram data flow, boundary conditions, error cases. Call out anti-patterns. For Hypernext: every new feature must fit into the dimension roadmap (`docs/overview.md` §3) and the relevant phase doc.
3. **Trade-off Analysis**: Present options with explicit pros/cons. Question scope, complexity, and assumptions. For Hypernext: the answer is often "defer to a later release" rather than "expand scope now."
4. **Pushback**: If requirements are vague, conflicting, or over-scoped, articulate risks and request clarity. The Hypernext plan explicitly supports dropping a feature to a later release — use that escape valve.
5. **Test Strategy**: Write test plan (unit, integration, e2e scope) before implementation. Per ADR 0005: unit (`cargo test`) + integration (`tests/` per crate) + E2E (Playwright via CDP).
6. **Todo List**: Create/update internal tracking for all subtasks, dependencies, and completion status. Use the `TodoWrite` tool.

---

## 6. Context Management

- **magic-context** (if available): track working state, file modifications, dependencies, and project structure.
- **Never**: search entire filesystem. Restrict to `/home/z/my-project/download/hypernext-plan/` (plan docs) or the Hypernext repo root (when code is being written).
- **Path resolution**: verify all paths are within project scope. Reject glob patterns that escape project boundary.
- **Worklog**: append to `/home/z/my-project/worklog.md` after every Task ID. Format per §11 below.

---

## 7. Communication & Interaction Philosophy

- **Professional & Terse**: drop filler, articles, pleasantries. Caveman-style compression throughout.
- **Code on Request**: explain in natural language by default. Provide code only if explicitly asked or essential to concept.
- **Explain the Why**: brief reasoning for patterns and solutions. Reference code as `path:line`.
- **Technical Precision**: trade-offs, mistakes, and corrections stated plainly.
- **Commit Messages**: concise Conventional Commits, imperative mood. No IDE/tooling references. Format per ADR 0010: `feat(phase-N): <description>`.

---

## 8. Code Standards & Generation (Rust-specific)

The original agent guidance mentions "TS over JS, no `any`". For Hypernext, the equivalent Rust discipline:

### Rust Quality Rules

- **Clarity over cleverness**: straightforward, minimalist solutions. Avoid premature optimization.
- **Standard library first**: prefer `std` and `tokio` over third-party where possible. Third-party only if industry standard (per `crate-audit.md`).
- **Strict types**: explicit types on public APIs. Use `thiserror` enums for library errors, `anyhow` for app-level (ADR 0009).
- **`clippy` clean**: `cargo clippy --workspace -- -D warnings` must pass. No `unwrap()` in library code (use `?` with proper error type); `unwrap()` in tests is acceptable.
- **`rustfmt` clean**: `cargo fmt --check` must pass.
- **Async**: use `tokio` exclusively (ADR 0008). Never `async-std`, never `smol`. Sync-heavy operations (`rusqlite`, `keyring`, `pgp`) go in `tokio::task::spawn_blocking`.
- **Error propagation**: `?` operator everywhere; never swallow errors with `let _ = ...` unless explicitly documented.
- **No magic values**: use `const` for limits, timeouts, etc.
- **Anti-patterns to avoid**: one-off abstractions, deep nesting (>3 levels), unused `pub` exports, `Box<dyn Trait>` where generics would do.
- **Tests**: unit (`#[cfg(test)] mod tests`), integration (`tests/` directory per crate), e2e (Playwright). All green before commit. Coverage ≥80% per crate (ADR 0005).

### Hypernext-Specific Invariants (Non-Negotiable)

These are the architectural invariants from the ADRs. Violating them fails CI and is a release blocker.

1. **Single-process Rust.** No IPC, no bindings, no frontend/backend split (ADR 0003). The UI calls protocol/storage crates directly.
2. **Keychain-only secrets.** No plaintext, no Base64 fallback, no SQLite-based secret store (ADR 0007). Every token in `keyring` with account `<feature>.<id>`.
3. **tokio exclusively.** No `async-std`, no `smol` (ADR 0008).
4. **`thiserror` for libraries, `anyhow` for app.** Never `anyhow::Error` from a library's public API (ADR 0009).
5. **No `--no-verify` ever.** Pre-commit hooks are non-bypassable (ADR 0010).
6. **PGP verification before extraction.** Verify runs on raw bytes BEFORE any HTML extraction, markdown parsing, or rendering (Phase 2 §3.8).
7. **Explicit confirmation for irreversible side effects.** Titan upload, Micropub publish, social crosspost, BitTorrent download — all require user gesture, never implicit on navigation.
8. **SSRF defense at HTTP layer.** Every outbound HTTP request through `FetchPolicy::check_url`. No bypassing (Phase 3 §3.1).
9. **Incognito is enforced at `FetchContext` level, not UI.** UI greys out buttons for clarity; actual enforcement is `FetchContext.incognito` propagating to every protocol/store write (Phase 4 §3.10).
10. **Raw-mode webview is the ONLY webview.** Never introduce webviews anywhere else. The app shell is GTK4 native.
11. **Fork-vendored smolnet crates.** The 10 protocol crates in `crates-vendored/` are ours to maintain. Document changes in each crate's `HYPERNEXT_CHANGES.md` (ADR 0006).
12. **Load tokens for every navigation.** Don't skip; prevents the "stale fetch overwrites current tab" bug (Phase 4 §3.1).

---

## 9. Security, Accessibility & Performance

### Security (OWASP Top 10)

- **No hardcoded secrets**: keychain only (ADR 0007). Pre-commit checklist: injection, crypto, secrets, auth. **Name the threat** in code review.
- **Parameterized SQL queries**: rusqlite handles this; never use `format!` to build SQL.
- **Input validation**: every URL goes through `Dispatcher::normalize_address` + `FetchPolicy::check_url`. User input (forms, dialogs) is validated before use.
- **Path sanitization**: file paths from user input must be canonicalized and checked to be within the data directory.
- **PGP verification boundary**: invariant #6 above.
- **SSRF defense**: invariant #8.
- **Userscript `GM_xmlhttpRequest` SSRF**: all requests through `FetchPolicy`; `@connect *` forbidden (Phase 3 §3.8).

### Accessibility (GTK4 a11y)

- Every interactive widget has `accessible_role` and `accessible_label`.
- Tab list uses `gtk::AccessibleRole::TabList`.
- Keyboard navigation: every interactive element reachable via Tab key.
- Use GTK4's AT-SPI (Linux), AXUIElement (macOS), UIAutomation (Windows) — abstracted by GTK4 itself.
- Run `gtk4-inspector`'s a11y checker in CI if possible; otherwise manual.
- WCAG 2.2 AA is the target where applicable (contrast 4.5:1, heading order, keyboard focus, forms with labels).

### Performance

- **Measure first**: use `criterion` crate for benchmarks.
- **Lazy loading**: feed entries, mail messages, news articles — header-only fetch, body fetched on demand.
- **No `SELECT *`**: explicit column lists in every SQL query. Use indexes (defined in migrations).
- **Pagination**: history, bookmarks, feed entries — paginated, not all-at-once.
- **Tree-shaking**: not applicable to Rust (cargo handles this), but be aware of feature flags — only enable what's needed.
- **Debouncing**: location bar search input is debounced 200ms; sidebar search similar.
- **Batch DOM updates**: N/A for GTK4 (different model), but batch `ListBox` inserts when adding many rows.
- **Cold start <2 seconds** target (Phase 5 release gate).
- **Memory <150MB idle** target (Phase 5 release gate).

---

## 10. Git & Issue Tracking

### Safety First

- Start with context summary and status. **Inspect before mutate.**
- Branching workflow per §3.4 above.
- Commit hygiene: one logical change per commit. Conventional message. Push to remote after PR draft.
- **Safety order**: `restore` (uncommitted) > `stash` (context switch) > `revert` (published) > `reset` (local only).
- **No `--no-verify`** ever (ADR 0010). The `scripts/check-no-verify.sh` script enforces this in CI.

### Branch Operations

- GitButler: virtual branch isolation. Commit frequently within logical unit.
- git-mcp + Git Flow: `git_flow topic_start <type> <name> [<base>]` → topic branch from base. `git_flow topic_finish <type> <name>` → merge with strategy.
- Standard branches: `feature/`, `fix/`, `chore/` from `main`. Keep commits atomic.
- For Hypernext specifically: branch naming is `feat/<scope>-<description>` or `fix/<scope>-<description>` where `<scope>` is the phase number (e.g., `feat/phase-2-gemini-adapter`).

### Commit & History

- `git_commit <message>` → stage and commit with conventional format.
- `git_history` → review recent commits and branches.
- `git_restore <path>` → discard uncommitted changes (safe).
- `git_stash` → temporary storage for context switches.
- **Co-authored commits**: if an AI agent wrote the code, the commit body includes `Co-Authored-By: <agent-name> <noreply@...>`.

---

## 11. Worklog Protocol (Hypernext-Specific)

Every task has a **Task ID** reflecting global order and parallelism (e.g., `1`, `2-a`, `2-b`, `3`). AI agents must:

1. **Before starting work**: read `/home/z/my-project/worklog.md` to understand previous agents' work.
2. **After finishing work for a Task ID**: append a new section to `/home/z/my-project/worklog.md` (do NOT overwrite). Each section starts with `---` and includes:

```markdown
---
Task ID: 2-a
Agent: <agent name>
Task: <the task you were asked to do>

Work Log:
- <concrete step 1>
- <concrete step 2>
- ...

Stage Summary:
- <key results / important decisions / produced artifacts>
```

3. **Open questions**: if you encounter an unanswered question, document it in `worklog.md` under a `## Open questions` section and propose a path forward. Move on; don't block.

---

## 12. Library Lookup Protocol (Hypernext-Specific)

Before adding any `use` statement for an external crate, an AI agent MUST follow the 6-step protocol in `docs/references/library-lookup-protocol.md`. Summary:

1. **Verify crate exists and is healthy** — latest release within 12 months, >100 recent downloads, repo link works, license compatible (MIT/Apache-2.0/MPL-2.0/BSD-3-Clause/ISC/Unicode-DFS-2016; **no GPL/AGPL/LGPL**).
2. **Read the API docs** — docs.rs for the pinned version, in full.
3. **Read the CHANGELOG** — verify the API you plan to use exists in the pinned version, not just HEAD.
4. **Pin the version** in workspace `Cargo.toml` `[workspace.dependencies]` block. Use `cargo tree -p <crate>` to verify no surprise transitive deps.
5. **If the API doesn't match the phase doc**: STOP writing code. Update the phase doc to match the actual API. Commit the doc change separately: `docs(<phase>): correct <crate> API`. Then proceed.
6. **When in doubt**: use `web-search` + `web-reader` skills. If still unclear, document in `worklog.md` under `## Open questions` and propose a path forward.

**Silent API drift is what made the Wails version's docs unreliable. We will not repeat that in Hypernext.**

---

## 13. The "Stop" Conditions (when AI must halt)

An AI agent MUST stop and ask before proceeding if:

1. **A crate API doesn't match what the phase doc describes** — update the phase doc first (§12).
2. **A new dependency is required** that's not in `crate-audit.md` — audit it first; if it fails health checks, propose an alternative.
3. **A test is flaky** — mark `#[ignore]` with a comment explaining why. Don't delete.
4. **A feature requires breaking an invariant** (§8 Hypernext-Specific Invariants) — propose the change in `worklog.md` and ask the maintainer.
5. **The phase doc itself is ambiguous or wrong** — fix the doc, commit separately, then proceed.
6. **A security concern appears** (SSRF bypass path, secret leak path, PGP-before-extraction violation) — stop immediately, document, ask.
7. **`cargo test --workspace` is failing** and you don't know why — don't `git push -f` or `--no-verify`. Investigate.
8. **You're about to introduce a webview** anywhere except raw-mode HTTP tabs — stop. That violates ADR 0001 and 0002.
9. **You're about to store a secret in SQLite** or any non-keychain location — stop. That violates ADR 0007.
10. **You're about to call `publish()` or `start_torrent_download()` from a navigation handler** — stop. That violates the explicit-confirmation invariant.

---

## 14. Todo List Tracking

- Maintain internal list of subtasks, statuses (`pending`, `in_progress`, `completed`), and dependencies via the `TodoWrite` tool.
- Update after each commit or phase completion.
- Reference in planning, status checks, and PR summaries.
- Only ONE task in_progress at a time. Complete current before starting next.

---

## 15. Project Detection

Start of session read:

- `AGENTS.md` (this file)
- `.github/copilot-instructions.md` (ignore IDE-specific sections)
- `.github/instructions/`
- `.agent/instructions/`
- `.beans` files (task/issue tracking, if present)

Then read (Hypernext-specific):

- `docs/overview.md`
- The relevant `docs/phases/<phase>.md` for the current task
- The ADRs in `docs/references/` listed in §2

Project-specific overrides take precedence; silent sections use these global rules.

---

## 16. Summary — The Hypernext Agent's Checklist

Before writing any code, verify:

- [ ] Read this `AGENTS.md` in full
- [ ] Read `docs/overview.md`
- [ ] Read the relevant phase doc
- [ ] Read all ADRs in §2 (or at minimum: 0001, 0003, 0005, 0007, 0009, 0010)
- [ ] Read `docs/references/library-lookup-protocol.md`
- [ ] Check `docs/references/crate-audit.md` for any crate you plan to depend on
- [ ] Check `/home/z/my-project/worklog.md` for prior agent work
- [ ] Have a Task ID assigned
- [ ] Internal todo list created via `TodoWrite`

While writing code:

- [ ] Test FIRST (TDD per ADR 0005)
- [ ] Every external crate verified via §12
- [ ] No invariants violated (§8)
- [ ] No `--no-verify` (§10)
- [ ] No heredocs in terminal (§4)
- [ ] Scripts saved to `/home/z/my-project/scripts/` before execution (§4)
- [ ] Clippy + rustfmt + tests + deny all green before commit

After writing code:

- [ ] All gates green
- [ ] Commit with Conventional Commits format per ADR 0010
- [ ] Append to `/home/z/my-project/worklog.md` with Task ID, agent name, work log, stage summary
- [ ] Update internal todo list
- [ ] If crate API drifted from phase doc, doc change committed separately

**Non-conformance with this contract is a release blocker.** There is no wiggle room on the invariants in §8 or the safety rules in §4.
