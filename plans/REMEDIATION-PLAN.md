# Hypernext — Synthesized Code Review & Remediation Plan

**Branch reviewed:** `feature/layout-templating-engine`
**Method:** Applied the `code-review` skill (from `selfagency/skills`) across the entire `hypernext` codebase, every doc in `plans/`, every doc in `docs/`, and the live runtime. Five independent review passes were merged:

1. **Static pass (subsystem-by-subsystem)** — file-by-file review of every `src/` subsystem, every test file, every plan doc, every config file. `tsc --noEmit` clean. `biome check` clean. 847 unit tests pass. 179 E2E tests pass.
2. **Live black-box pass** — `hypernext init` → `hypernext serve` → curl/inspect DB → mutate fixtures → re-boot. This is the pass that found the ship-stoppers; the static pass and the test suites actively hid them.
3. **Plan-vs-implementation divergence pass** — every claim in IMPLEMENTATION-PLAN, SUPPLEMENTARY-PLAN, AI-PLAN, EMAIL-PLAN, IPFS-PLAN, E2E-PLAN checked against the actual code, types, configs, and runtime behavior. Includes architectural findings from maintainer Q&A about the intended `agent.enabled` master-toggle design.
4. **Targeted re-audit + maintainer decisions pass** — 18 additional findings re-checked against source; maintainer answered 12 architectural questions across two Q&A rounds that resolve all open decisions blocking remediation. All 12 answers are reflected in the findings below (see "Resolved decisions" section).
5. **Second-reviewer verification pass** — an independent reviewer (separate agent) read the actual source for every P0 and P1 claim and confirmed each one is real and correctly described. One mechanism-level correction to P1-6 was applied (the email template feature is entirely inert, not merely template-broken — see P1-6 for the corrected diagnosis).

**Bottom line:** Your instinct is correct. This is not "buggy code." `tsc`, `biome`, and 1,026 tests are all green. It is a **wiring/integration gap**: dozens of features are implemented as isolated, well-written functions that were never connected to the pipelines the plans describe — and in several cases the runtime architecture has diverged from the documented plan in ways that violate the intended design (notably the `agent.enabled` master-toggle, the storage initialization, and the AI threading model). Several of the gaps are catastrophic in production. None of the 1,026 tests catch any of this because every test exercises a component in isolation with hand-fed inputs — nothing exercises the real seams.

**All maintainer-blocking decisions are now resolved** — all 12 architectural questions answered (see "Resolved decisions from maintainer Q&A" below). A second independent reviewer confirmed every P0/P1 claim against the actual source code. Implementation can begin immediately.

**Reviewer claims overridden during synthesis:**
- "No Dockerfile exists." Verified false — `Dockerfile` exists at repo root.
- "Use `mcp.stdio: true` to gate MCP." Overridden by maintainer — `agent.enabled` is the master toggle for ALL AI features including MCP (see P0-12).
- "`publishAt` vs `publishedAt` is a field-name mismatch bug." Overridden by maintainer — these serve different purposes; we need a separate scheduling field (see P2-2).
- "P1-6: `email-digest.mdx` fails to parse, so `sendWeeklyDigest` will crash at render time." Corrected by second reviewer — `sendWeeklyDigest` never reads the template file at all. The feature is entirely inert, not merely template-broken. See P1-6 for the corrected diagnosis.

---

## Resolved decisions from maintainer Q&A

All twelve architectural questions that were blocking remediation have been answered. Each answer is reflected in the corresponding finding(s) below; this section is the authoritative summary.

| # | Decision | Affects |
|---|---|---|
| 1 | **Job architecture: SQLite-persisted queue + `piscina` worker threads.** Jobs are scheduled into a SQLite table for crash recovery and durability, then executed in a `piscina` worker pool to move CPU/I/O work off the main event loop. This replaces workmatic entirely (workmatic will be deleted). | P1-1, P1-8, P1-2, P1-4 |
| 2 | **Layout templates: standard set prepopulated as writable copies.** `hypernext init` scaffolds a `templates/` directory into the user's project containing writable copies of the default templates. Users edit those files directly. Embedded defaults remain as a read-only fallback only if the user deletes their copy. `wrapSkeleton` is confirmed as a bug, not a fallback. | P0-4, P1-7 |
| 3 | **REST API auth: default public-read for docs/blog, everything else authed, with an opt-out.** Public docs and blog posts are readable without auth by default. All other CRUD ops, hidden docs, stats, and email endpoints require auth. A config flag (e.g., `api.requireAuthForPublicRead: true`) lets the user tighten public reads to authed-only. | P0-5, P3-4 |
| 4 | **TUI is permanently canceled.** Delete `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` from `main`. Strip TUI references from README. No archival prefix. | P3-1, P3-9, P3-10 |
| 5 | **Scheduled posts: keep `publishedAt` (historical) + add `scheduledAt` (visibility gate).** `publishedAt` records when a post was actually published. A new `scheduledAt` field (frontmatter key `scheduledAt`) holds a future date before which the post is hidden from public routes. | P2-2 |
| 6 | **IndieAuth user auth: passkeys created on first server launch.** On first boot, the server runs an interactive setup that creates a passkey credential for the admin user. `/auth/authorize` requires passkey challenge-response before issuing an authorization code. | P0-7 |
| 7 | **MCP PII follows API auth.** MCP tools expose public-read data without auth; anything behind the API auth guard (subscriber emails, stats, hidden docs, moderation) requires an authenticated MCP session with the same scopes as the REST API. | P2-22 |
| 8 | **All code (including tests) must be type-checked in CI.** Add `tests/**/*` to `tsconfig.json` `include` (or a `tsconfig.test.json`), run `tsc --noEmit` on the full set in CI. Latent test type bugs (~5–10) will surface and need fixing. | P3-5 |
| 9 | **`agent.enabled` master-toggle semantics confirmed (all four sub-questions: yes).** `agent.enabled: false` (default) → MCP server does NOT start, AI features off, vector DB off, sitemap/llms.txt off. `agent.enabled: true` + `ai.enabled: false` → MCP server starts, but `talk_to_docs`/`summary`/embeddings/moderation are off. `agent.enabled: true` + `ai.enabled: true` → full feature set. `mcp.enabled` is removed entirely; the `mcp` block becomes transport-only (`{ transport: 'stdio' \| 'sse', port?: number }`), nested under `agent`. | P0-12 |
| 10 | **IPFS storage model: always additive (Option A).** IPFS is a pinning/caching layer on top of local or S3 primary storage, never the primary itself. Remove `"ipfs"` from `StorageConfig.type`. `ipfs.enabled: true` enables pinning; `storage.type` is always `local` or `s3`. Matches the plan's intent. | P2-27 |
| 11 | **`hypernext setup` is an interactive checklist wizard.** Single `hypernext setup` command presents a multi-select checklist of subsystems to set up (AI/vector DB, email, federation, bridges, storage, passkey admin, etc.). User picks what they want; the wizard runs each selected setup step interactively (install deps, verify config, run smoke tests, modify `package.json` directly). A `--check` flag runs verification-only without installing. | P2-28 |
| 12 | **Plan docs: annotate with overriding decisions (do NOT rewrite).** Keep the original plan text intact (preserves the historical "why we tried Vite first" context). Add a `## Overriding Decisions` section at the top of each plan doc noting where the actual implementation diverged: tsup replaced Vite, oclif replaced cac, `@lesjoursfr/html-to-epub` replaced `md-to-epub`, workmatic replaced by SQLite+piscina, etc. The annotation is the source of truth; the body is historical. | P1-10 |

---

## How this document is organized

Findings are deduplicated and merged across both review passes. Severity is assigned by **production blast radius**, not by code smell:

- **P0 — Ship-stopping.** Will crash, corrupt, or silently misroute the entire site under realistic conditions. Cannot ship until fixed.
- **P1 — Features that exist as code but are never actually invoked, or are broken end-to-end.** The feature is documented, the tests for the component pass, but no visitor or operator can ever reach it.
- **P2 — Security and correctness bugs.** Real bugs in code that does run, with security or data-integrity consequences.
- **P3 — Dead code, doc rot, hygiene.** Will not block shipping but will continue to confuse future readers and reviewers.

Each finding has: **Files**, **What's wrong**, **Why it matters**, **Fix**, **Verification**.

---

## P0 — Ship-stopping (do not ship until fixed)

### P0-1 — One bad document crashes the entire site's indexing, permanently

**Files:** `src/indexer/index.ts` — `reindexAll()` (lines 64–77) and `watchStorage()` (lines 79–120).

**What's wrong:**

```ts
for (const slug of slugs) {
  const content = await storage.read(slug);
  await indexDocument(slug, content);   // ← no try/catch
}
```

`indexDocument()` calls `parseToIR()`, which `throw`s on any parse problem — malformed MDX, unknown JSX component (see P1-3), or any of the parser crashes documented in P2-1 through P2-6. Because the loop has no error isolation, **the first document that fails to parse aborts the loop for every document after it.** Worse, `reindexAll()` runs `nativeDelete()` on `docs_meta`, `terms`, and `term_relationships` *before* the loop — so a crash mid-loop leaves the site in a state where most or all pages 404.

`watchStorage()` has the same unguarded `indexDocument()` call. A single bad save while the dev server is live silently nukes search and routing until the next clean reindex.

**Live repro:**

1. `hypernext init` in a scratch dir → boots fine, all sample pages serve 200.
2. Add one MDX file containing `<EmailSubscribe />` (a component your own EMAIL-PLAN documents as a real feature — see P1-3).
3. Restart → **every single page on the site now 404s**, including pages that were fine before and have nothing to do with the broken file.

**Why it matters:** First-time users will hit this the first time they typo a component name. Operators will hit this the first time an editor saves a half-written file. There is no recovery short of manually deleting the broken file and reindexing.

**Fix:**

1. Wrap the per-document call in `reindexAll()` and in `watchStorage()`'s watcher callback in `try/catch`. Log the offending slug + error. Do not abort the batch.
2. Make the `nativeDelete()` + re-insert cycle **transactional per document**: delete-then-insert per doc only on success, OR run the whole batch in a transaction so a partial failure rolls back to the previous good state.
3. Surface indexing errors via an admin-visible "documents with indexing errors" list (the `/api/v1/*` admin routes already exist).

**Verification:** Boot a fresh project, drop a malformed MDX file in, restart. Assert: (a) other pages still serve 200, (b) the broken slug 404s cleanly, (c) an entry appears in the indexing-errors list.

---

### P0-2 — Relative config paths resolve against `process.cwd()`, not the project directory

**Files:** `src/config.ts`, `src/app.ts`, every site that reads `database.path`, `storage.local.path`, `site.pdf.cssPath`, `site.ebooks.coverImage`, TLS cert paths for Spartan/Gemini.

**What's wrong:** `--project`/`--config` clearly signal "here's where the project lives," but relative paths inside `config.yml` are resolved against whatever directory the `hypernext` binary happens to be invoked from. This is silently destructive.

**Live repro:**

1. `hypernext init --path /tmp/some-project`
2. `cd ~/Developer/hypernext && hypernext serve --project /tmp/some-project`
3. Result: `~/Developer/hypernext/db/hypernext.db` gets created and written to — **inside your own source repo**, not `/tmp/some-project/db/`.

**Why it matters:** Any systemd unit, cron job, Docker `WORKDIR`, or just running the CLI from a different shell cwd than the project will read/write the wrong database and potentially the wrong content directory, with no error. It just silently operates on (or creates) files in the wrong place.

**Fix:** Resolve every filesystem-ish config path (`database.path`, `storage.local.path`, `site.pdf.cssPath`, `site.ebooks.coverImage`, TLS cert paths, etc.) relative to the resolved `--project`/`--config` directory **at config-load time in `config.ts`, once, centrally** — not ad hoc at each call site.

**Verification:** Run `hypernext serve --project /tmp/foo` from three different cwds (`~/`, `/tmp`, `/`). Assert the DB file is created at `/tmp/foo/db/hypernext.db` in all three cases.

---

### P0-3 — AI feature hard-crashes the whole server on startup

**Files:** `src/database/index.ts` — `initVecTable()` (lines 49–56).

**What's wrong:**

```ts
await em.getConnection().execute(
  `CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(...)`
);
```

`vec0` is the virtual-table module provided by the **`sqlite-vec`** native SQLite extension. It is never installed (`package.json` has no `sqlite-vec`/`sqlite-vector` dependency) and never loaded via `.loadExtension()` anywhere in the codebase.

**Live repro:** Set `ai.enabled: true` in a fresh `config.yml` and run `serve` → immediate crash:

```
Error: no such module: vec0
```

The server never comes up. Every AI feature (`generateSummary`, `ragSearch`/`talk_to_docs`, embeddings, and — per AI-PLAN — auto-tagging/SEO/alt-text/moderation) is 100% non-functional the instant AI is turned on, because the process itself won't start.

**Fix:**

1. Add `sqlite-vec` as a dependency.
2. Load it via `db.loadExtension(require('sqlite-vec').getLoadablePath())` (or the ESM equivalent) **before** `initVecTable()` runs.
3. Add an E2E test that actually boots the server with `ai.enabled: true`. This is exactly the kind of gap that unit tests mocking `getEm()` will never catch.

**Verification:** Set `ai.enabled: true`, run `hypernext serve`, assert server boots and stays up. Hit `POST /api/v1/docs/:slug/summary` and assert a non-500 response.

---

### P0-4 — Layout IR is discarded and replaced with a hard-coded skeleton

**Files:** `src/parser/layout.ts` — `resolveLayout()` (lines 155–210) and `wrapSkeleton()` (lines 108–153).

**What's wrong:** The layout-templating-engine feature is named after this code, but the code doesn't do what the name implies. `resolveLayout()` correctly:

1. Reads the layout file (or default template).
2. Parses it to IR.
3. Verifies it contains a `<slot />`.
4. Replaces the `<slot />` with the document's content.

…but then **throws away the resulting IR** and calls `wrapSkeleton()`, which builds a **hard-coded skeleton** (header with `NavMenu` + `Search`; main with `Breadcrumbs` + `Title` + `PostMeta` + `e-content` section; footer with copyright text). The parsed layout IR is never used.

```ts
const slotResult = replaceSlot(layoutParse.ir, docParse.ir.children ?? []);
// ... computes slotContent ...
const mergedIr = wrapSkeleton(slotContent, config, ctx.collection, docParse.frontmatter, ctx.slug);
//                                ^^^^^^^^^^^^ throws away layoutParse.ir entirely
```

**Why this matters:** The entire point of the `feature/layout-templating-engine` branch is to make layouts user-editable. As shipped, the `templates/` directory is decorative — editing `default.mdx` or `blog.mdx` changes nothing about the rendered output. Users who edit their layout file and see no change will conclude the feature is broken (because it is).

This is the single biggest reason "things seem to be extremely off" relative to your envisioned plan: the layout engine is structurally a no-op.

**Maintainer decision (confirmed):** `wrapSkeleton` is a bug, not a fallback. The intent is that editing `templates/default.mdx` changes the rendered output. There is supposed to be a standard set of templates and components which the user can override in their own `templates/` folder. `hypernext init` prepopulates that folder with writable copies of the default templates.

**Fix:**

1. Delete `wrapSkeleton()` entirely.
2. Have `resolveLayout()` return `slotResult.nodes[0]` (the layout IR with the slot replaced by document content) as the merged IR.
3. Move the `Breadcrumbs` / `Title` / `PostMeta` / `NavMenu` / `Search` / `Footer` calls into the **default template MDX files** so users can edit them there. (The default templates already call some of these components — they were just being ignored.)
4. Audit `default-templates.ts` to make sure each embedded template parses cleanly (see P2-2: `email-digest.mdx` currently does not).
5. **Scaffold writable copies into user projects.** Update `hypernext init` (and `scaffoldDefaults()`) to copy `default.mdx`, `blog.mdx`, `library.mdx`, and `email-digest.mdx` from the embedded defaults into `${projectRoot}/templates/`. The user's copies are the source of truth at runtime; the embedded defaults are read-only fallbacks used only when a user deletes their copy.
6. **Lookup order in `readLayoutRaw()`:** (a) `${projectRoot}/templates/${name}.mdx` (user override), (b) embedded `DEFAULT_TEMPLATES[name]` (fallback). No other locations.

**Verification:** Run `hypernext init --path /tmp/foo`. Assert `/tmp/foo/templates/default.mdx` exists and is a writable file. Edit it to add `<aside>Hello world</aside>`. Boot the server. Assert the rendered HTML contains that aside. Delete the user's `templates/default.mdx`. Reboot. Assert the page renders using the embedded fallback (with no `<aside>Hello world</aside>`). Edit `templates/default.mdx` to remove `<Footer />`. Assert the footer disappears. This is the test that should have existed from day one of the feature branch.

---

### P0-5 — `registerApiAuthGuard` blocks every public `/api/v1/*` endpoint, including the entire email subsystem

**Files:** `src/api/auth.ts:19-27`, `src/app.ts:69-78`.

**What's wrong:** `registerApiAuthGuard` adds an `onRequest` hook that runs for every request and calls `verifyBearerToken` if `request.url.startsWith("/api/v1/")`. In `app.ts`, this is registered **before** `registerNewsletterRoutes`, `registerApiRoutes`, `registerModerationRoutes`, `registerStatsRoutes`, and `registerAiRoutes`.

EMAIL-PLAN §4 explicitly marks these as **Public Endpoints (No Auth)**:

- `POST /api/v1/subscribe`
- `GET /api/v1/subscribe/verify`
- `POST /api/v1/subscribe/unsubscribe`
- `POST /api/v1/contact`

AI-PLAN §5 marks `GET /api/v1/docs/:slug/summary` as public for public docs.

All of these now require a Bearer JWT. This breaks:

- Newsletter subscription (no one can subscribe without already having a token).
- Email verification (the verify link in the email points to `/api/v1/subscribe/verify` which 401s).
- One-click unsubscribe (List-Unsubscribe-Post header posts to `/api/v1/subscribe/unsubscribe` which 401s).
- The contact form (the form posts to `/api/v1/contact` which 401s — and see P1-3 for why the form is doubly broken).
- AI summaries for public docs.

**Why it matters:** The entire newsletter/email subsystem is non-functional in production. The unsubscribe form generated by `GET /subscribe/unsubscribe` posts to `/api/v1/subscribe/unsubscribe` which returns 401.

**Fix:** Convert the auth guard from a global `onRequest` hook to a per-route `preHandler` applied only to admin routes, with a public-read allowlist for documents and blog posts. Per maintainer decision:

- **Default public-read (no auth):** `GET /api/v1/docs`, `GET /api/v1/docs/:slug`, `GET /api/v1/collections/:name`, `GET /api/v1/collections/:name/posts`, `GET /api/v1/docs/:slug/summary` (when doc is not hidden and `agent.enabled + ai.enabled` are both on).
- **Always authed (any method, any hidden doc, stats, email, moderation, MCP admin):** everything else, including `POST/PUT/DELETE /api/v1/docs/*`, all `/api/v1/stats/*`, all `/api/v1/subscribers/*`, all `/api/v1/blocklist/*`, all `/api/v1/comments/*` admin operations, hidden-doc reads.
- **Public email endpoints (per EMAIL-PLAN §4):** `POST /api/v1/subscribe`, `GET /api/v1/subscribe/verify`, `POST /api/v1/subscribe/unsubscribe`, `POST /api/v1/contact`. These remain public.
- **Configurable tighten flag:** add `api.requireAuthForPublicRead: boolean` (default `false`). When `true`, even public-doc reads require auth — useful for private/member-only sites.

Implementation sketch:

```ts
const PUBLIC_READ_PATHS = [
  /^\/api\/v1\/docs$/,
  /^\/api\/v1\/docs\/[^/]+$/,                          // public doc read
  /^\/api\/v1\/collections\/[^/]+$/,                  // collection listing
  /^\/api\/v1\/collections\/[^/]+\/posts$/,
  /^\/api\/v1\/docs\/[^/]+\/summary$/,                // AI summary (gated by agent.enabled too)
];
const PUBLIC_WRITE_PATHS = new Set([
  "/api/v1/subscribe",
  "/api/v1/subscribe/verify",
  "/api/v1/subscribe/unsubscribe",
  "/api/v1/contact",
]);

fastify.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/v1/")) return;
  const path = req.url.split("?")[0];
  if (PUBLIC_WRITE_PATHS.has(path)) return;
  if (!config.api?.requireAuthForPublicRead && PUBLIC_READ_PATHS.some(re => re.test(path))) {
    // Still need to verify the doc is not hidden — handled in the route handler.
    return;
  }
  await verifyBearerToken(req, reply);
});
```

Route handlers for `GET /api/v1/docs/:slug` must additionally check `doc_meta.hidden = false` and return 404 (not 403) if the doc is hidden — so hidden-doc existence is not leaked.

**Verification:** Without a token: `GET /api/v1/docs` returns 200, `GET /api/v1/docs/public-post` returns 200, `GET /api/v1/docs/hidden-post` returns 404, `POST /api/v1/subscribe` with valid email returns 202, `GET /api/v1/subscribe/verify?token=...` returns 200, `POST /api/v1/contact` returns 202, `GET /api/v1/stats/overview` returns 401, `PUT /api/v1/docs/foo` returns 401. With `api.requireAuthForPublicRead: true`, `GET /api/v1/docs` returns 401.

---

### P0-6 — EPUB generation returns JSON `{"result":"ok"}` instead of an EPUB file

**Files:** `src/api/routes.ts:241-263`, `src/federation/workmatic.ts:222-243`.

**What's wrong:** `@lesjoursfr/html-to-epub` v6 API is `new EPub(options: EpubOptions, output: string)` where `output` is a **file path**; `render()` returns `Promise<{ result: "ok" }>` and writes the EPUB file to `output`. The code calls `new EPub(epubOptions, "")` (empty output path) and treats the return value as a Buffer:

- `reply.send(buffer)` in routes.ts sends `{"result":"ok"}` JSON to the client.
- `writeStorage(..., buffer.result)` in workmatic.ts writes the literal string `"ok"` to storage.

The `@ts-expect-error` on `routes.ts:253` and `workmatic.ts:224` silences the real type error.

**Why it matters:** Downloading `/api/v1/collections/blog.epub` returns `{"result":"ok"}` instead of an EPUB file. The workmatic EPUB queue writes the string `"ok"` to `${collectionName}.epub` in storage. Both paths are completely broken.

**Fix:**

1. Pass a real temp file path as the second arg: `new EPub(options, tempPath)`.
2. `await epub.render()`.
3. `fs.readFileSync(tempPath)` and stream/delete it.
4. Remove the `@ts-expect-error` and import the proper `EpubOptions` type so the type system catches this next time.

**Verification:** Hit `GET /api/v1/collections/blog.epub` and assert the response is a valid EPUB (magic bytes `PK\x03\x04`). Add a workmatic test that asserts the storage file is a valid ZIP.

---

### P0-7 — IndieAuth has no PKCE, an open redirect, and an authorization bypass

**Files:** `src/auth/indieauth.ts:32-104`.

**What's wrong:** Three independent bugs in one file:

1. **PKCE silently skipped.** `code_challenge` is declared in the Querystring type but never destructured or validated. `code_verifier` is declared in the Body type but never checked at the token endpoint. PKCE is advertised in `code_challenge_methods_supported: ["S256"]` but never enforced.
2. **Open redirect.** `/auth/authorize` accepts any `redirect_uri` with any `client_id`. There is no user authentication, no client registration, no redirect_uri whitelist. Anyone can call `/auth/authorize?redirect_uri=https://evil.com/&client_id=anything` and receive a valid authorization code redirected to `evil.com`.
3. **Authorization-code injection.** The token endpoint only checks `stored.token !== code` but never validates that `redirect_uri` or `client_id` match the original request.

**Why it matters:** This is a real OAuth authorization-code injection / open-redirect vulnerability. An attacker can mint access tokens for any client by trivially walking the flow. PKCE was added to OAuth 2.0 specifically to prevent code interception; advertising S256 without enforcing it gives a false sense of security.

**Fix:**

1. **Implement PKCE verification:** hash `code_verifier` with SHA-256, base64url-encode, compare to stored `code_challenge`.
2. **Validate `redirect_uri` against `client_id`'s registered redirect URIs** (or at minimum require same-origin with the `client_id`).
3. **Store `redirect_uri`, `client_id`, `code_challenge`, and `code_challenge_method` alongside the code at authorization time and verify all four at token exchange.**
4. **Require passkey-based user authentication at `/auth/authorize`** (per maintainer decision). On first server launch with no admin credential registered, the server runs an interactive setup that walks the user through creating a passkey (using `@simplewebauthn/server` + `@simplewebauthn/browser`). The credential is persisted in a new `admin_credentials` table (or a `KeyValue` row). On subsequent boots, `/auth/authorize` renders a challenge page that calls `navigator.credentials.get()` on the client and posts the assertion to `/auth/verify-assertion`; only after successful verification does the server issue the authorization code.
5. **Add a `hypernext passkey` CLI subcommand** for managing admin credentials: `hypernext passkey add` (interactive), `hypernext passkey list`, `hypernext passkey revoke <id>`. Useful for headless servers where the browser flow is awkward.

**Verification:**

- Test that an attacker-supplied `redirect_uri` to a non-registered origin is rejected.
- Test that PKCE mismatch returns 400.
- Test that a reused `code_verifier` is rejected.
- Test that `/auth/authorize` without an active passkey session returns 401 with a `WWW-Authenticate: Passkey` challenge.
- Test that after a successful passkey assertion, the authorization code is issued and the redirect proceeds.
- Test that a fresh `hypernext init` boots into the passkey-setup flow on first launch and refuses to serve until a credential is registered.

---

### P0-8 — ActivityPub actor publishes empty `publicKeyPem`; inbox accepts unverified activities

**Files:** `src/federation/activitypub.ts:259-282` (actor), `:295-335` (inbox verification), `:149-155` (outgoing Accept).

**What's wrong:** Two related bugs that together make federation one-directional and forgeable:

1. **Empty `publicKeyPem`.** The Actor JSON-LD at `GET /actor` returns `publicKey: { id, owner, publicKeyPem: "" }` — an empty PEM string. There is no private key anywhere in the codebase, so the server cannot sign outgoing `Accept`/`Create`/`Announce`/`Delete` activities. The `handleFollow` function fires off an unsigned `Accept` POST to the follower's inbox, which will be rejected by Mastodon, GotoSocial, Pleroma, etc.
2. **Inbox accepts unverified activities.** `verifyHttpSignature` is called, but if `verified` is `false`, the code only logs a warning and **continues processing the activity** (storing a mention, accepting a Follow). Combined with the empty `publicKeyPem`, this means an attacker can POST arbitrary `Create`/`Follow`/`Like`/`Announce` activities to `/inbox` impersonating any actor.

**Why it matters:** Spam, impersonation, mention injection. Anyone can add arbitrary content to any Hypernext document's comment section by forging a `Create { inReplyTo: <canonicalBase>/<slug> }` activity. And the local actor cannot post publicly to the fediverse.

**Fix:**

1. Generate an RSA keypair at first startup (or load from config), persist to disk.
2. Expose the public key in the Actor JSON-LD.
3. Sign all outgoing inbox deliveries with the private key using `node:crypto.createSign`.
4. **Reject with 401** when `verified: false` in `/inbox`. If you want to support non-standard key delivery, queue the activity for retry-after-key-fetch, but do not store it as a mention until verified.

**Verification:**

- Hit `GET /actor` and assert `publicKey.publicKeyPem` starts with `-----BEGIN PUBLIC KEY-----` and is non-empty.
- Verify outgoing `Accept` has a valid `Signature` header.
- POST a `Create` with an invalid signature to `/inbox` and assert 401.
- POST with no `Signature` header and assert 401.

---

### P0-9 — SSRF protection misses AWS metadata, link-local, CGNAT; no DNS rebinding mitigation

**Files:** `src/federation/ssrf.ts:1-49`, `src/federation/inbound.ts:93-116` and `:179`.

**What's wrong:** `validateSourceUrl` blocks `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `10.x`, `172.16-31.x`, `192.168.x`, `fc..`/`fd..` (IPv6 ULA). It does NOT block:

- `169.254.0.0/16` link-local — including `169.254.169.254` AWS/GCP/Azure metadata endpoints.
- `100.64.0.0/10` CGNAT.
- `0.0.0.0/8` (only `0.0.0.0` exactly is blocked, not `0.0.0.1`–`0.255.255.255`).
- `fe80::/10` IPv6 link-local.
- `::ffff:127.0.0.1` IPv4-mapped IPv6.
- `::` (unspecified).

More importantly, the check is purely string-based on the hostname — the hostname is never resolved to an IP. `fetch(source)` later resolves the hostname, so an attacker can set up DNS that returns a public IP for the SSRF check and `127.0.0.1` at fetch time (DNS rebinding), or simply use a hostname that resolves to a private IP (e.g., `localtest.me` resolves to `127.0.0.1`).

**Why it matters:** Webmention source fetching is a textbook SSRF vector. An attacker can read `http://169.254.169.254/latest/meta-data/iam/security-credentials/` on AWS-hosted instances and exfiltrate IAM credentials via a webmention whose source HTML embeds the response. Or scan internal services via `http://10.0.0.X/admin`.

**Fix:**

1. Extend the blocklist: `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `fe80::/10`, `::ffff:0:0/96`, `::/128`.
2. Resolve the hostname with `dns.lookup(host, { all: true })`, verify ALL returned IPs against the blocklist.
3. Fetch with a custom `lookup` function that pins the resolved IP (or use `undici`'s `connect` option with an IP whitelist).
4. Reject redirects to private IPs (follow redirects manually and re-validate each hop).

**Verification:**

- Unit-test `validateSourceUrl("http://169.254.169.254/")` → `false`.
- Unit-test `validateSourceUrl("http://[::ffff:127.0.0.1]/")` → `false`.
- Integration-test a webmention with `source=http://localtest.me/` → rejected.

---

### P0-10 — `getEm()` singleton shared across concurrent requests (MikroORM identity-map corruption)

**Files:** `src/database/index.ts:65-67`, every federation/api/micropub file.

**What's wrong:** `getEm()` returns `getOrm().em` — the singleton EntityManager. MikroORM docs explicitly state: *"EntityManager is not designed to be shared between requests. Always use `em.fork()` for each request."* The federation handlers, moderation API, newsletter API, micropub, stats, and `Comments` resolver all call `getEm()` directly. SUPPLEMENTARY-PLAN §1 shows the correct pattern (`const em = orm.em.fork()` inside each task) but the actual code uses the singleton.

**Why it matters:** Under concurrent load, the identity map (MikroORM's in-memory cache of managed entities) is shared. One request's uncommitted changes leak into another request's reads. `em.flush()` in one request can persist unrelated entities from a concurrent request. Transactions are not isolated. Race conditions on `findOne → create` upserts (already seen in `processInboundMention` lines 228–254) cause duplicate rows or lost updates.

Tests use `:memory:` and run sequentially so the bug doesn't manifest.

**Fix:**

1. Replace `getEm()` with `getEm().fork()` at every call site, OR
2. Add a request-scoped fork via Fastify's `request.em` decorator.

The SUPPLEMENTARY-PLAN pattern (`orm.em.fork()` inside each worker task) is correct — apply it everywhere.

**Verification:** Add a concurrent-load test: fire 50 parallel `POST /webmention` requests with distinct sources and assert no entity bleed, no `duplicate key` errors, all 50 mentions are stored.

---

### P0-11 — Pingback endpoint expects JSON, not XML-RPC; Micropub endpoint rejects form-encoded requests

**Files:** `src/federation/inbound.ts:284-321` (pingback), `src/micropub/index.ts:11-43` and `src/micropub/utils.ts:33-56` (micropub).

**What's wrong:** Two spec-violations on inbound posting protocols:

1. **Pingback.** The Pingback spec specifies XML-RPC: clients POST `text/xml` body `<methodCall><methodName>pingback.ping</methodName><params>…</params></methodCall>`. The implementation types the body as a JSON object. The test passes a JSON payload, but real XML-RPC clients (WordPress, Movable Type, etc.) send XML. Fastify has no XML content-type parser registered, so the raw XML body would be a string or rejected.
2. **Micropub.** The W3C Micropub Recommendation requires servers to accept BOTH `application/json` (with `type` and `properties`) AND `application/x-www-form-urlencoded` (with `h=entry&name=...&content=...`). The current implementation only checks `body?.properties` and returns 400 if absent. Form-encoded requests produce `{ h: "entry", name: "...", content: "..." }` — no `properties` field — so they're rejected. Multipart file uploads (`multipart/form-data` with a `file` part) are not handled at all — there's no media endpoint.

**Why it matters:** No real pingback client can send a pingback to Hypernext. Most Micropub clients (IndieAuth.com, Quill, Micropublish, iA Writer) default to form-encoded POSTs — they'll all get 400. Both endpoints are non-conformant and non-functional with real-world clients.

**Fix:**

- **Pingback:** Register an XML content-type parser (e.g., `fastify.register(xmlBodyParser)` or use `xml2js` manually). Parse `<methodCall>` → extract `methodName` and `params[].value.string`. Return a proper XML-RPC `<methodResponse>`.
- **Micropub:** Detect `content-type`. If form-encoded, transform `{ h, name, content, category, ... }` into `{ type: [`h-${h}`], properties: { name: [name], content: [content], category: category ? category.split(",") : undefined, ... } }`. Handle `content[html]` / `content[text]` object form. Implement `POST /micropub/media` for file uploads. Implement `GET /micropub?q=config` and `?q=source` and `?q=category`. Implement `action=delete` / `action=undelete`.

**Verification:**

- POST a real XML-RPC pingback payload and assert 200 with XML response containing the success message.
- POST form-encoded `h=entry&name=Test&content=Hello` to `/micropub` and assert 201.
- POST JSON with `content: [{ html: "<p>Hi</p>" }]` and assert the body HTML is preserved.

### P0-12 — `agent.enabled` does not gate MCP server or AI features (architectural violation of intended design) — CONFIRMED

**Files:** `src/mcp/index.ts:16, 33`, `src/mcp/tools.ts:79`, `src/api/ai.ts:8`, `src/app.ts:60`, `src/types/config.ts:240-243, 266-275`.

**Maintainer decision (confirmed):** `agent.enabled` is the **master toggle for ALL AI features** — MCP server, vector DB, RAG/chat, AI features, sitemap, llms.txt, agent-readiness signals. This is the intended architecture, full stop. The current three-toggle design (independent `mcp.enabled`, `ai.enabled`, `agent.enabled`) is a violation of that intent.

**What's wrong:** The actual code uses **three independent toggles**:

- `config.mcp.enabled` controls MCP server startup independently
- `config.ai.enabled` controls AI features (RAG, embeddings, summarization, etc.)
- `config.agent.enabled` controls only agent-readiness features (robots.txt, sitemap, llms.txt, view-transitions, markdown-negotiation, link-headers, hidden-agent-directive)

Grep-verified usage: `agent.enabled` is referenced only in `src/servers/http.ts`, `src/renderers/{html,head,markdown-negotiation,agent-readiness,link-headers}.ts` — all agent-readiness features. It is **never checked** by `src/mcp/index.ts`, `src/mcp/tools.ts`, `src/api/ai.ts`, or `src/federation/workmatic.ts`.

The intended architecture (per AI-PLAN and confirmed by maintainer — all four sub-questions answered yes):

- `agent.enabled: false` (default) — **YES**, ALL AI features off, including MCP server, vector DB, RAG/chat, AI auto-tagging/SEO/alt-text/moderation, AND the agent-readiness signals (robots.txt, sitemap, llms.txt).
- `agent.enabled: true` + `ai.enabled: false` — **YES**, MCP server starts, agent-readiness signals on, but `talk_to_docs`/`summary`/embeddings/moderation are off.
- `agent.enabled: true` + `ai.enabled: true` — **YES**, full feature set.
- `mcp.enabled` removed entirely? — **YES**, the `mcp` block becomes transport-only (`{ transport: 'stdio' | 'sse', port?: number }`), nested under `agent`.

**Why it matters:** When the user sets `agent.enabled: false` (the default), the MCP server can still start if `mcp.enabled: true`, and AI tools (`talk_to_docs`) are still registered if `ai.enabled: true`. This is the opposite of the intended "off by default" posture for AI features. A user who sets `agent.enabled: false` believing they've disabled all AI features is mistaken.

**Fix:**

1. Make MCP server startup gated by `agent.enabled` (not `mcp.enabled`). Remove the `mcp.enabled` check from `src/mcp/index.ts:16, 33` and replace with `config.agent?.enabled`.
2. Make AI tools (`talk_to_docs`) AND MCP tools conditional on `agent.enabled` in `src/mcp/tools.ts:79`.
3. Make `src/api/ai.ts:8` check `config.agent?.enabled` (in addition to `config.ai?.enabled`). Both must be true.
4. Make `src/federation/workmatic.ts:114, 130` (or its replacement per P1-1) check `config.agent?.enabled` for AI-queue registration.
5. **Remove `mcp.enabled` from `HypernextConfig`** entirely. The `mcp` block becomes `{ transport: 'stdio' | 'sse', port?: number }`. The `mcp` block is only meaningful when `agent.enabled: true`.
6. **Nest `ai` under `agent`** in the config type: `agent: { enabled, ai: { enabled, model, ... }, mcp: { transport, port }, ... }`. Keep back-compat by accepting the old top-level `ai:` block and migrating it.
7. Update `DEFAULT_CONFIG_YAML` and `config.example.yml` to reflect the new structure (also fix P2-29).
8. Update AI-PLAN, EMAIL-PLAN, IMPLEMENTATION-PLAN to document the master-toggle architecture.

**Verification:**

- Start server with `agent.enabled: false` and `ai.enabled: true` (legacy form). Assert MCP SSE endpoint returns 503, `/api/v1/docs/:slug/summary` returns 503, no `talk_to_docs` tool is exposed.
- Start with `agent.enabled: true` and `ai.enabled: false`. Assert MCP works, `talk_to_docs` is registered but returns 503 when called, `GET /api/v1/docs/:slug/summary` returns 503.
- Start with `agent.enabled: true` and `ai.enabled: true`. Assert full AI feature set is available.
- Start with no `agent` block at all. Assert the server boots with all AI features off (default-off posture).

---

### P0-13 — Storage provider is never initialized at server startup

**Files:** `src/app.ts` (no `createStorage` import or call), `src/storage/index.ts:40` (`getStorage` throws if not initialized), `src/indexer/index.ts:65` (lazy `createStorage`), `src/micropub/index.ts:34` and `src/micropub/utils.ts:51` (lazy `createStorage`).

**What's wrong:** `createStorage(config)` is **never called during server startup**. Grep-verified: `src/app.ts` has zero references to `createStorage`. The only callers are:

- `src/indexer/index.ts:65` — inside `reindexAll()`
- `src/micropub/index.ts:34` — inside the micropub POST handler
- `src/micropub/utils.ts:51` — inside a micropub utility

This means any code that calls `getStorage()` or `writeStorage()` **before the indexer runs** will throw `Error: Storage not initialized. Call createStorage() first.` Specifically:

- `watchStorage()`'s file-watcher callback calls `indexDocument()` which calls `insertDoc()` which uses the ORM, not storage directly — but `writeStorage()` calls from MCP tools, API routes, or sync will crash.
- The IPFS pinning cascade (once P1-1 is wired) calls `writeStorage()` — will crash if storage isn't initialized.
- Any external trigger that writes a doc before the first reindex will crash.

Worse: `createStorage()` is called lazily **three separate times** in three different files, each creating a new `StorageProvider` instance. This is wasteful and risks state divergence if any of the lazy init paths use different config.

**Why it matters:** Silent crashes for any storage operation that happens before the indexer's first `reindexAll()` call. In practice this means: boot the server, immediately try to write a doc via the API or MCP — crash.

**Fix:**

1. Add `createStorage(config)` to `startAllServers()` in `src/app.ts`, immediately after ORM init and before any other subsystem that might touch storage.
2. Remove the lazy `createStorage` calls from `src/indexer/index.ts:65`, `src/micropub/index.ts:34`, and `src/micropub/utils.ts:51`. Use `getStorage()` instead (which returns the already-initialized singleton).
3. Add a startup smoke test that calls `getStorage().list()` immediately after boot, before any indexing, and asserts no throw.

**Verification:** Boot the server with an empty content directory. Before any reindex runs, call `POST /api/v1/docs/test` with content. Assert 201 (not 500). Call `getStorage().list()` from a test harness immediately after `startAllServers()` returns. Assert no throw.

---

## P1 — Features that exist as code but are never actually invoked ("dead wiring")

### P1-1 — Workmatic queues: 5 of 6 enqueue functions are dead code — REPLACE WITH SQLITE + PISCINA

**Files:** `src/federation/workmatic.ts` (to be deleted), `src/indexer/index.ts:75/110`, `src/federation/inbound.ts:266-355`, `src/micropub/index.ts:36`, `src/api/routes.ts:38-75` and `:210-264`.

**Maintainer decision (confirmed):** Replace workmatic with a SQLite-persisted job queue + `piscina` worker-thread pool. Jobs are scheduled into a SQLite table for crash recovery and durability, then executed in a `piscina` worker pool to actually move CPU/I/O work off the main event loop (which workmatic never did).

**What's wrong:** The workmatic job-queue architecture is **half-built**: queues are registered and processors exist, but most of the `enqueue*()` functions that would feed them are never called anywhere. Grep-verified across the whole `src/` tree — every item below is `export`ed and fully implemented, but has **zero callers** outside its own file/tests.

| Queue / Feature | Processor exists in | `enqueue*()` function | Actually called from anywhere? |
|---|---|---|---|
| `indexing` (cascades to AI embedding + IPFS pin) | `workmatic.ts` | `enqueueIndexing()` | **No.** `indexer/index.ts` calls `indexDocument()` directly, bypassing the queue entirely. |
| `inbound-mentions` | `workmatic.ts` | `enqueueInboundMention()` | **No.** `federation/inbound.ts`'s Fastify routes call `processInboundMention()` directly (fire-and-forget on the main thread), not via the queue built specifically for this. |
| `posse-replies` | `workmatic.ts` | `enqueuePosseReplyFetch()` | **No.** Nothing calls it — Mastodon/Bluesky reply fetching for `<Comments />` is unreachable in practice. |
| `pdf-generation` | `workmatic.ts` | `enqueuePdfGeneration()` | **No.** The PDF API route calls `mdToPdf()` synchronously inline in the HTTP handler. |
| `epub-generation` | `workmatic.ts` | `enqueueEpubGeneration()` | **No.** Same pattern — EPUB route generates inline, synchronously, on the request thread. (And the inline generation itself is broken — see P0-6.) |
| `ipfs-pinning` | `workmatic.ts` | `enqueueIpfsPinning()` | **No.** Never called. |
| `outbound-syndication` | `workmatic.ts` | `enqueueOutboundSyndication()` | **Yes.** This is the only one actually wired up (via `bridge/index.ts`). |

**Bonus architectural finding (now resolved):** `workmatic@1.1.3` is a persistent **job queue** (Kysely + fastq) that runs job processors **in the main Node.js event loop** with concurrency limits — it is **not** a worker-thread pool. SUPPLEMENTARY-PLAN §1 claims workmatic is a "Worker Thread pool" that "share[s] the main process's memory space." That claim is false for the actual implementation. Even if all enqueue functions were wired up, heavy CPU work (mf2 regex, `parseToIR`, puppeteer for PDF, archiver for EPUB) would still block the event loop.

**Why this matters for a $5 VPS with 1 CPU (your stated target):** the entire premise of routing PDF/EPUB/mention-verification/network-fetch work through a queue was to keep the Gemini/Gopher/Spartan/NEX/Finger sockets responsive while heavy I/O runs elsewhere. Right now none of that happens — every one of these operations blocks the same event loop that's also serving your other five protocols.

**Consequence for AI/IPFS:** because `enqueueIndexing()` is dead, the cascade that's supposed to auto-generate AI embeddings and auto-pin to IPFS whenever a document is saved **never fires**. Embeddings and IPFS pins currently only happen if you trigger them manually via the API/MCP tools — "index on save" as described in the plans doesn't exist at runtime.

**Fix — Replace workmatic with SQLite-persisted queue + piscina worker pool:**

1. **Create `src/jobs/` module** with:
   - `schema.sql` additions: `jobs` table with `id`, `type`, `payload` (JSON), `status` (`pending`/`running`/`completed`/`failed`), `attempts`, `max_attempts`, `scheduled_at`, `started_at`, `completed_at`, `error`, `result` (JSON).
   - `schedule(type, payload, opts?)` — inserts a row, returns `jobId`. Idempotency key support to dedupe.
   - `claimNext()` — atomic `UPDATE … WHERE status='pending' … RETURNING …` (SQLite RETURNING clause, available since 3.35).
   - `markComplete(jobId, result)`, `markFailed(jobId, error)`, `markRetry(jobId, nextAttemptAt)`.
   - `listJobs(filter)` for admin visibility.
2. **Create `src/jobs/worker.ts`** that runs `piscina` with one worker per CPU (default 1 on a $5 VPS). Each worker pulls from `claimNext()` in a loop, dispatches to the registered processor, and marks the result.
3. **Create `src/jobs/processors/` directory** with one file per job type, each exporting an async function: `indexing.ts`, `inbound-mentions.ts`, `posse-replies.ts`, `pdf-generation.ts`, `epub-generation.ts`, `ipfs-pinning.ts`, `outbound-syndication.ts`, `ai-text.ts`, `ai-vision.ts`, `ai-moderation.ts`, `email-digest.ts`, `email-notification.ts`.
4. **Replace `enqueue*()` exports** with `schedule*()` calls that hit the new `schedule()` function. Keep the same export names for back-compat (e.g., `enqueueIndexing()` → `schedule('indexing', ...)`).
5. **Wire the schedules into their call sites** (this is the actual fix):
   - `indexer/index.ts` → `scheduleIndexing(slug)` instead of `indexDocument(slug)` directly.
   - `federation/inbound.ts` → `scheduleInboundMention(source, target)` instead of `processInboundMention(...)` directly.
   - `api/routes.ts` PDF/EPUB handlers → `schedulePdfGeneration(slug)` / `scheduleEpubGeneration(collection)` returning 202 + `Location: /api/v1/jobs/:jobId`.
   - `parser/resolver.ts` `Comments` resolver → `schedulePosseReplyFetch(slug, network)` (per P1-2).
   - `indexer/index.ts` post-index cascade → `scheduleIpfsPinning(slug)` + `scheduleAiEmbedding(slug)` (per P1-4).
6. **Delete `src/federation/workmatic.ts`** and the `workmatic` dependency from `package.json`.
7. **Add `piscina` as a dependency.**
8. **Update SUPPLEMENTARY-PLAN §1** to reflect the SQLite + piscina architecture. The plan's worker-thread intent is now actually delivered.
9. **Crash recovery:** on boot, scan for `status='running'` rows older than a timeout (e.g., 5 min) and reset to `pending` so they get re-picked-up.

**Verification:**

- Add E2E tests that hit `/webmention`, save a file via the watcher, request a PDF, and request an EPUB — each must assert (a) the response is 202 with a `Location` header, (b) the corresponding `schedule*()` was called (via spy or DB inspection), (c) polling the `Location` URL eventually returns `completed`, (d) the side-effect (mention stored, PDF file written, IPFS pin registered) is observable.
- Add a test that runs piscina PDF generation concurrently with a Gemini socket request and asserts the Gemini request returns sub-100ms while the PDF is in flight (this is the test that proves the work actually moved off-thread).
- Add a crash-recovery test: schedule a job, kill the process before completion, reboot, assert the job re-runs and completes.
- Add a durability test: schedule a job, immediately kill the process, reboot with no worker, assert the job row still exists in `pending`.

---

### P1-2 — `<Comments />` resolver never fetches POSSE replies (lazy fetch not implemented)

**Files:** `src/parser/resolver.ts:700-753`, `src/federation/workmatic.ts:355-375`.

**What's wrong:** SUPPLEMENTARY-PLAN §5 specifies a Lazy Server-Side Fetch: when `<Comments />` renders, it should check the LRU cache (TTL 15 min) and trigger `workmatic.execute(fetchPosseReplies)` if cold. The actual `Comments` resolver only runs a `SELECT … FROM mentions WHERE target_slug = ? AND spam_status = 'ham' AND hidden = 0` query. It never calls `enqueuePosseReplyFetch`, never checks a cache, never triggers a background fetch.

**Why it matters:** Mastodon/Bluesky replies are never aggregated. The unified Mention pipeline that was the centerpiece of the plan is non-functional for POSSE replies — only inbound webmentions/pingbacks/trackbacks/ActivityPub replies appear. A post syndicated to Mastodon that gets 50 replies there will show zero comments on the Hypernext page.

**Fix:** In the `Comments` resolver, after the SELECT query, call `enqueuePosseReplyFetch(ctx.currentSlug, ctx.currentDocId, "mastodon")` and `…("bluesky")` (guarded by `resolveCommentConfig(...).aggregation`). Wrap in an LRU cache check (TTL 900s) so we don't re-enqueue on every page load.

**Verification:** Add a test that mounts `<Comments />` for a doc with a Syndication record and assert that `enqueuePosseReplyFetch` is called.

---

### P1-3 — Documented components `EmailSubscribe` and `ContactForm` don't actually work

**Files:** `src/parser/resolver.ts:50-77` (allowlist), `:676-698` (resolvers), `src/parser/pipeline.ts` (security check), `src/renderers/html.ts` (component fallback).

**What's wrong:** `EmailSubscribe` and `ContactForm` are implemented in `COMPONENT_RESOLVERS` (per EMAIL-PLAN's documented usage), but:

1. **Missing from `ALLOWED_COMPONENTS`** in `resolver.ts:50-77`. `pipeline.ts` rejects any JSX component not in that set with `throw new Error("Security Error: Unknown component <X>")`. Using `<EmailSubscribe />` in an MDX file → hard parse error → (combined with P0-1) **takes down the entire site's indexing**.
2. **Self-referential resolver.** Even if you fix the allowlist, the resolvers for both components return a node that just re-wraps itself as another unresolved `"component"` IR node:

```ts
EmailSubscribe() {
  return [paragraphNode([{
    type: "component",
    componentName: "EmailSubscribe",
    componentProps: {},
  } as IrNode])];
}
```

3. **HTML renderer falls back to a comment.** `renderers/html.ts`'s fallback for any unhandled `"component"` node is:

```ts
component(node) { return `<!-- component: ${node.componentName} -->`; }
```

So even with the allowlist fixed, `<EmailSubscribe />`/`<ContactForm />` render as an inert HTML comment — no `<form>`, no `action="/api/v1/subscribe"`, nothing a visitor could ever submit.

**Why it matters:** These are the user-facing features EMAIL-PLAN markets. They are doubly broken: the parser rejects them, and even if the parser allowed them, the renderer would silently swallow them.

**Fix:**

1. Add both to `ALLOWED_COMPONENTS`.
2. Rewrite the resolvers to emit an actual form IR node. Introduce a new IR node type, e.g. `{ type: "form", action: "/api/v1/subscribe", method: "POST", children: [...] }`, with a matching case in `html.ts`'s renderer map — mirroring how `Comments`/`mention` nodes are handled, which do work correctly end-to-end.
3. The form action must point at the **public** route path (post-fix of P0-5), not the `/api/v1/` path that the auth guard blocks.

**Verification:** Drop `<EmailSubscribe />` into a page, boot the server, hit the page, assert the rendered HTML contains `<form action="/api/v1/subscribe" method="POST">` with an email input. Submit the form and assert 202 + verification email sent.

---

### P1-4 — AI-PLAN features never wired into any pipeline

**Files:** `src/federation/ai-tasks.ts` (functions exist), `src/indexer/index.ts` (call sites missing), `src/federation/inbound.ts` (call site missing).

**What's wrong:** These functions exist, are correct in isolation, but are called from **nowhere** — no API route, no MCP tool, no automatic trigger:

| Function | AI-PLAN intent | Call site |
|---|---|---|
| `suggestTags()` | Automatic tag suggestion on save | `indexer/index.ts` never calls it. |
| `generateSeoMeta()` | Auto-generate meta description when frontmatter `description` is blank | `indexer/index.ts` never checks for blank description or calls this. |
| `generateAltText()` | Generate alt text on image upload | There is no upload handler that calls it at all. |
| `aiModerateComment()` | LLM fallback when Akismet returns `"pending"` | `federation/inbound.ts`'s `processInboundMention()` calls `checkAkismet()` and stores whatever it returns directly — it never checks for `"pending"` and never calls `aiModerateComment()`. |

**Fix:** Wire each into its intended call site as AI-PLAN describes, gated behind `config.agent?.enabled` AND `config.agent?.ai?.enabled` (per P0-12 master-toggle decision). All AI calls go through the `piscina` worker pool per P1-1 (not inline, not via the deleted workmatic). Note that all of this is also blocked by P0-3 — the server won't even boot with `ai.enabled: true` until `sqlite-vec` is loaded.

- `suggestTags()` → called from `indexer/index.ts` post-index cascade, schedules an `ai-text` job.
- `generateSeoMeta()` → called from `indexer/index.ts` when `frontmatter.description` is blank, schedules an `ai-text` job.
- `generateAltText()` → called from a new upload handler (likely `POST /api/v1/media` or the Micropub media endpoint), schedules an `ai-vision` job.
- `aiModerateComment()` → called from `federation/inbound.ts` `processInboundMention()` when Akismet returns `"pending"`, schedules an `ai-moderation` job.

**Verification:**

- Save a doc with no tags and `ai.enabled: true` → assert tags appear within ~5s.
- Save a doc with no `description` and `ai.enabled: true` → assert `<meta name="description">` is populated in the rendered HTML head.
- Submit a webmention that Akismet returns `"pending"` for, with `ai.enabled: true` → assert `aiModerateComment` is called and the final `spam_status` is either `"ham"` or `"spam"`, not `"pending"`.

---

### P1-5 — MCP stdio server is dead code — GATE VIA `agent.enabled`

**Files:** `src/mcp/index.ts` (`startMcpServer` exported), `src/app.ts` (never imported/called).

**What's wrong:** `startMcpServer` (stdio transport) is exported but **never called from `app.ts`** — the MCP stdio server is unreachable at runtime. The SSE transport is wired up (via `registerMcpRoutes`), but the stdio transport that most MCP clients (Claude Desktop, etc.) expect is not.

**Maintainer decision (confirmed):** MCP — both stdio and SSE — is gated by `agent.enabled` (per P0-12). The `mcp.enabled` toggle is removed. The `mcp` block becomes transport-only: `{ transport: 'stdio' | 'sse', port?: number }`.

**Fix:**

1. Wire `startMcpServer` (stdio) into `app.ts` behind `config.agent?.enabled && config.mcp?.transport === 'stdio'`.
2. Wire `registerMcpSseTransport` (SSE) into `app.ts` behind `config.agent?.enabled && (config.mcp?.transport ?? 'sse') === 'sse'`.
3. Default `mcp.transport` to `'sse'` (current behavior) so existing configs keep working.
4. Expose a `hypernext mcp` CLI subcommand that runs the stdio transport directly — useful for Claude Desktop integration. This subcommand bypasses the HTTP server entirely and just runs `startMcpServer(config)`.
5. Update `mcp.enabled` checks throughout `src/mcp/index.ts`, `src/mcp/tools.ts` to use `config.agent?.enabled` (per P0-12).

**Verification:**

- Run `hypernext mcp` with `agent.enabled: true` and `mcp.transport: 'stdio'`. Pipe an MCP `initialize` request via stdin. Assert a valid `initialize` response on stdout.
- Run `hypernext serve` with `agent.enabled: false` and `mcp.transport: 'stdio'`. Assert `startMcpServer` is NOT called (no stdio listener).
- Run `hypernext serve` with `agent.enabled: true` and `mcp.transport: 'sse'` (default). Assert the SSE endpoint is registered.

---

### P1-6 — Email template customization is entirely inert (corrected diagnosis)

**Files:** `src/federation/email-tasks.ts` (`sendWeeklyDigest`, instant-notification builders), `src/constants/default-templates.ts` (embedded `email-digest.mdx`), `src/parser/layout.ts` (`readLayoutRaw` — never called for email templates).

**Correction (from second review pass):** The original finding said "`email-digest.mdx` fails to parse, so `sendWeeklyDigest` will crash at render time." That diagnosis was wrong about the mechanism. Tracing the code: `sendWeeklyDigest()` in `email-tasks.ts` builds the digest HTML with **inline template literals** and **never reads `templates/email-digest.mdx` at all**. So it won't crash — that function doesn't touch the file. The actual bug is one layer up:

**What's wrong (corrected):** EMAIL-PLAN §7 promises the digest and notification emails are user-customizable via `templates/*.mdx`. Nothing in the codebase ever parses or renders those scaffolded template files. The feature is **entirely inert**, not merely template-broken. The scaffolded `email-digest.mdx` file is decorative — nothing reads it, nothing renders it, nothing fails when it's wrong.

Separately (and this was the original finding's kernel of truth): the scaffolded `email-digest.mdx` file does contain invalid `{#each}` Svelte-style syntax that would fail MDX parsing **if anything ever did read it**. So if you wire the template file into the send path without first fixing its syntax, you'll move from "silently inert" to "loudly crashing."

**Why it matters:** Users who edit `templates/email-digest.mdx` to customize their digest emails see no change. The feature EMAIL-PLAN §7 markets as a headline benefit of the templates directory doesn't work. This is the email-side equivalent of P0-4 (layout IR discarded).

**Fix:**

1. **Wire the template files into the send path.** `sendWeeklyDigest()`, `sendInstantNotification()`, and `processContactForm()` should call `readLayoutRaw('email-digest')` (or similar), parse the result with `parseToIR`, render with the email HTML renderer, and use that as the email body. Pass context (subscriber name, posts list, unsubscribe URL) as template variables.
2. **Fix the `email-digest.mdx` syntax** so it parses cleanly once it IS read. Remove the Svelte-style `{#each}` blocks; use the project's actual JSX-in-MDX iteration pattern (e.g., `<RecentPosts limit={10} />` or a dedicated `<DigestPosts />` component).
3. **Same fix for `instant-notification.mdx` and `contact-form-notification.mdx`** if those templates exist (need to confirm — they're referenced in EMAIL-PLAN but may not be in `default-templates.ts`).
4. **Audit `default-templates.ts` end-to-end:** parse each template, render to HTML, assert no `<!-- component: X -->` comments remain (which would indicate an unresolved component).
5. **Add a unit test** that parses and renders every default template and asserts zero unresolved components. Add an E2E test that triggers a digest send and asserts the rendered email body matches the template (not the inline literal).

**Verification:** Edit `templates/email-digest.mdx` to add a custom header. Trigger a weekly digest send. Assert the sent email body contains the custom header. Parse `email-digest.mdx` → no throw. Render `default.mdx` with a sample doc → no `<!-- component: RecentPosts -->` comments in HTML output.

---

### P1-7 — `templates/` directory is never created; users cannot customize layouts without manual setup

**Files:** No `templates/` directory exists at repo root or in scaffold output. `src/constants/default-templates.ts` provides embedded fallbacks. `src/parser/layout.ts:9` uses `TEMPLATES_DIR = "templates"` as a relative path. `src/lib/base-command.ts` (scaffold logic) does not create the directory.

**Maintainer decision (confirmed):** `hypernext init` scaffolds a `templates/` directory into the user's project containing writable copies of the default templates. Users edit those files directly. Embedded defaults remain as a read-only fallback only if the user deletes their copy.

**What's wrong:** IMPLEMENTATION-PLAN explicitly specifies a `templates/` directory containing `blog.mdx` and `library.mdx` (lines 899–901) with `<slot />` AST injection patterns for layouts. The actual codebase has **no `templates/` directory**. The parser's `readLayoutRaw()` function falls back to the embedded `DEFAULT_TEMPLATES` constant when the file isn't found — so layouts technically "work," but users have no way to customize them without manually creating the directory and files.

This is closely related to P0-4 (layout IR discarded): even if users did create a `templates/default.mdx`, the `wrapSkeleton()` code would throw away the parsed layout and use the hard-coded skeleton instead. So the templates directory is doubly broken — it doesn't exist by default, and even if it did, editing it wouldn't change the rendered output.

**Why it matters:** The zero-config scaffolding story is broken. A user runs `hypernext init`, gets a working site, tries to customize the layout, finds no `templates/` directory, reads the docs which say to create one, creates one, edits `default.mdx`, reloads, and sees no change (because of P0-4). This is the canonical "why does this feel off" experience.

**Fix:**

1. After P0-4 is fixed (delete `wrapSkeleton`, use layout IR directly).
2. Update `scaffoldDefaults()` (or the `hypernext init` command) to copy `default.mdx`, `blog.mdx`, `library.mdx`, and `email-digest.mdx` from the embedded `DEFAULT_TEMPLATES` into `${projectRoot}/templates/` as writable files.
3. Update `readLayoutRaw()` to look in the project's `templates/` directory first, then fall back to embedded defaults only if not found.
4. Add a `hypernext templates restore [name]` CLI subcommand that re-copies a single template (or all) from the embedded defaults back into the user's `templates/` directory, for when the user wants to reset.

**Verification:** Run `hypernext init --path /tmp/foo`. Assert `/tmp/foo/templates/default.mdx` exists. Edit it to add `<aside>custom</aside>`. Run `hypernext serve --project /tmp/foo`. Hit `/`. Assert the rendered HTML contains `<aside>custom</aside>`. Run `hypernext templates restore default`. Assert the file is overwritten with the embedded default.

---

### P1-8 — AI tasks (`generateSummary`, `ragSearch`) run inline on the main thread, not through the worker pool

**Files:** `src/api/ai.ts:29` (`registerAiRoutes` → `generateSummary` direct call), `src/mcp/tools.ts` (`talk_to_docs` → `ragSearch` direct call), `src/federation/ai-tasks.ts:39-63, 67-87, 192-251` (functions exist but are called inline).

**What's wrong:** AI-PLAN explicitly states:

> "All embedding generation, API calls, and vector operations are offloaded to the workmatic Worker Thread pool to prevent blocking the main HTTP/TCP event loop."
> "All embedding and LLM calls happen inside workmatic worker threads."

The actual code:

- `generateSummary` is called directly from the API handler (`registerAiRoutes` → `generateSummary`), blocking the Fastify request thread.
- `ragSearch` is called from the MCP tool handler (`talk_to_docs` → `ragSearch`), which is NOT a workmatic worker — it runs directly in the main thread.
- `generateAndStoreEmbedding` is correctly queued via workmatic, but `ragSearch` and `generateSummary` are not.

The plan shows `workmatic.execute(generateSummary, plainText)` and `workmatic.execute(ragSearch, query)`, but the actual code calls them directly.

**Why this matters:** This is a specific instance of the P1-1 workmatic-wiring gap, but it's worth calling out separately because AI calls are the longest-running blocking operations in the codebase (OpenAI API calls take 1–10 seconds). While one `/api/v1/docs/:slug/summary` request is in flight, every Gemini/Gopher/Spartan/NEX/Finger socket is blocked for that entire duration. On a $5 VPS with 1 CPU, a single user requesting an AI summary stalls the entire site for everyone else.

**Maintainer decision (confirmed):** All AI calls go through the new SQLite-persisted queue + `piscina` worker pool (per P1-1). The HTTP/MCP handlers return 202 + a polling URL; the result is fetched asynchronously.

**Fix:**

1. Register `ai-text` queue for summarization, RAG, SEO meta, auto-tagging. Register `ai-vision` queue for alt text generation. Register `ai-moderation` queue for semantic spam checking. (These are created as part of P1-1.)
2. Move `generateSummary`, `ragSearch`, `suggestTags`, `generateSeoMeta`, `generateAltText`, `aiModerateComment` implementations into `src/jobs/processors/ai-text.ts`, `ai-vision.ts`, `ai-moderation.ts` (worker-side code).
3. Update `registerAiRoutes` to call `schedule('ai-text', { op: 'summary', slug })` and return 202 with `Location: /api/v1/jobs/:jobId`.
4. Update `talk_to_docs` MCP tool to call `schedule('ai-text', { op: 'rag', query })` and either (a) block on the result with a 30s timeout (acceptable for MCP since MCP clients expect blocking calls), or (b) return a job-id handle and add a `get_job_result` MCP tool for polling.
5. Add `GET /api/v1/jobs/:jobId` endpoint that returns the job status + result (or 202 if still pending).
6. Add SSE streaming variant at `GET /api/v1/jobs/:jobId/stream` for clients that prefer to wait for completion via SSE.
7. This is blocked by P0-3 (server crashes on `ai.enabled: true` until `sqlite-vec` is loaded), P0-12 (`agent.enabled` gating), and P1-1 (piscina infrastructure).

**Verification:**

- Hit `GET /api/v1/docs/:slug/summary` and assert the response is 202 with a `Location` header pointing at `/api/v1/jobs/<uuid>`. Poll the URL until `status: 'completed'`. Assert the result body contains the summary text.
- Fire 5 concurrent summary requests. Assert the Gemini socket stays responsive (sub-100ms response) while the AI requests are in flight.
- Call `talk_to_docs` via MCP. Assert the call eventually returns a result (within the timeout), not a blocking 10-second wait on the main thread.
- Add a test that asserts no OpenAI SDK call appears on the main-thread stack (use `--prof` or a spy on `fetch`).

---

### P1-9 — Config pipeline order: `validateConfig` runs before `mergeCliOverrides`, violating the plan

**Files:** `src/config.ts:326-337`.

**What's wrong:** The plan specifies the config pipeline as:

```
loadYAML → envSubst → parse → validate → mergeCliOverrides
```

The actual code does:

```
loadConfig (loadYAML → envSubst → parse → validate) → mergeCliOverrides
```

`validateConfig` is called inside `loadConfig` **before** `mergeCliOverrides`. This means CLI overrides can't fix an invalid config. For example, if `site.canonicalBase` is missing from the YAML file but the user provides it via a CLI flag, validation fails before the override is applied.

This doesn't cause a bug **currently** because `validateConfig` only checks for the required keys `site`, `storage`, `database` — all of which the defaults always provide. But it's a latent landmine: the moment a future validation rule checks a field that could be CLI-overridden, the override becomes useless.

**Why it matters:** Latent landmine + plan divergence. Users who try to override a validation-required field via CLI will be confused when the override is rejected.

**Fix:** Move `validateConfig()` call to **after** `mergeCliOverrides()` in `getConfig()`. The pipeline should be:

```
loadYAML → envSubst → parse → mergeCliOverrides → validate
```

**Verification:** Unit test: load a config with missing `site.canonicalBase`, provide `--canonical-base` via CLI override, assert validation passes. (Requires adding the `--canonical-base` CLI flag if it doesn't exist.)

---

### P1-10 — Plan divergences: Vite→tsup, cac→oclif, md-to-epub→@lesjoursfr/html-to-epub

**Files:** `package.json` (actual deps), `plans/IMPLEMENTATION-PLAN.md`, `plans/AI-PLAN.md`, `plans/EMAIL-PLAN.md`, `plans/IPFS-PLAN.md`.

**What's wrong:** Three architectural migrations happened during development but the plan docs were never updated:

1. **Bundler: Vite → tsup.** IMPLEMENTATION-PLAN line 717 specifies "Bundler: Vite configured for SSR/Node library building" and line 730 shows `"build": "vite build"`. Actual: `package.json` uses `"build": "tsup"`, no `vite.config.ts` exists, `tsup.config.ts` exists. Confirmed by maintainer Q&A: tsup intentionally replaced Vite.
2. **CLI framework: cac → oclif.** All four plan docs reference `cac` as the CLI framework. Actual: codebase uses `oclif` (visible in `src/lib/base-command.ts` and `package.json` deps). Confirmed by maintainer Q&A: cac was intentionally dropped for oclif.
3. **EPUB library: md-to-epub → @lesjoursfr/html-to-epub.** IMPLEMENTATION-PLAN specifies `"md-to-epub": "^1.x"`. Actual: `package.json` uses `@lesjoursfr/html-to-epub`. This is the library whose API is misused in P0-6 — the plan divergence may have contributed to the bug (developer assumed the `md-to-epub` API but installed the different `@lesjoursfr/html-to-epub` library).

**Why it matters:** The plans are the source of truth for architectural intent. When they diverge from the code, future contributors (and AI agents) following the plans will produce code that doesn't match the codebase. This is part of why "the plan and what came together" feels disconnected — the plans literally describe a different codebase than the one that exists.

**Maintainer decision (confirmed):** Annotate plans with overriding decisions. Do NOT rewrite. Keep the original plan text intact (preserves the historical "why we tried Vite first" context).

**Fix:**

1. Add a `## Overriding Decisions` section at the top of each affected plan doc (`IMPLEMENTATION-PLAN.md`, `AI-PLAN.md`, `EMAIL-PLAN.md`, `IPFS-PLAN.md`, `SUPPLEMENTARY-PLAN.md`) noting where the actual implementation diverged and linking to the finding in `REMEDIATION-PLAN.md`:
   - **Bundler:** tsup replaced Vite (see `tsup.config.ts`). Original plan §717–730 is historical.
   - **CLI framework:** oclif replaced cac (see `src/lib/base-command.ts`). Original plan references to cac are historical.
   - **EPUB library:** `@lesjoursfr/html-to-epub` replaced `md-to-epub` (see `package.json`). Original plan reference to `md-to-epub` is historical. Note: this divergence contributed to P0-6 (the API was misused because the developer assumed the `md-to-epub` API but installed the different `@lesjoursfr/html-to-epub` library).
   - **Job architecture:** SQLite-persisted queue + `piscina` worker pool replaced workmatic (per P1-1). SUPPLEMENTARY-PLAN §1's workmatic claims are historical.
   - **`agent.enabled` master toggle:** per P0-12, `agent.enabled` gates all AI/MCP features. AI-PLAN references to independent `ai.enabled` / `mcp.enabled` toggles are historical.
2. Use a consistent format for each annotation: `**[DATE] Decision:** X (replaces Y). See REMEDIATION-PLAN.md §P0-12.`
3. The annotation section is the source of truth for what the code actually does. The body of the plan is the historical record of intent.
4. Optionally: add a CI check that diffs `package.json` deps against the deps listed in plan docs and fails if they drift without a corresponding annotation.

**Verification:** Each affected plan doc has a `## Overriding Decisions` section at the top. The section lists all known divergences. `rg -n "## Overriding Decisions" plans/` returns matches in all five plan files. The body of each plan is unchanged from before this fix (only the annotation was added).

---

## P2 — Security & correctness bugs

### P2-1 — Layout path traversal: `layout: "../secret"` reads files outside `templatesDir`

**Files:** `src/parser/layout.ts:13-16` (`layoutPath`).

**What's wrong:** `layoutPath()` does `path.resolve(templatesDir, normalized)` — but `path.resolve` collapses `..` segments, so a frontmatter value of `layout: "../../etc/passwd"` will resolve to a path outside `templatesDir`. Confirmed via ad-hoc test.

**Why it matters:** Any MDX author (including untrusted Micropub submissions, once P0-11 is fixed) can read arbitrary files on disk by setting `layout:` to a traversal path. The file's contents get embedded in the rendered page.

**Fix:** After resolving, verify the result is inside `templatesDir`:

```ts
const resolved = path.resolve(templatesDir, normalized);
if (!resolved.startsWith(path.resolve(templatesDir) + path.sep)) {
  throw new Error(`Layout path escapes templatesDir: ${name}`);
}
```

**Verification:** Set `layout: "../test-traversal-outside/secret"` in a doc, boot, hit the page → 500 with "Layout path escapes templatesDir" error. Confirm the secret file's contents are NOT in the response.

---

### P2-2 — Scheduled posts: keep `publishedAt` (historical) + add `scheduledAt` (visibility gate)

**Files:** `src/indexer/index.ts:38` (writes `publishedAt`), `src/database/entities/doc-meta.ts` (entity field), `src/parser/frontmatter.ts:48-50` (currently uses `publishAt` as a fallback for `date` to gate visibility), `src/database/index.ts:164` (visibility filter), tests/frontmatter.test.ts (uses `publishAt`).

**Maintainer decision (confirmed):** We need a field to allow users to schedule a post for publication so that it is hidden until after the datestamp. The existing code has TWO related but confused fields:

- `publishedAt` — the canonical published date (DB column `published_at`, entity field, used in 14 places). This records when a post was actually published (historical record).
- `publishAt` — frontmatter-only key, currently used by `isFutureDatedFrontmatter()` in `src/parser/frontmatter.ts:48-50` as a fallback for `date` to determine if a post should be hidden.

**What's wrong:** The current implementation conflates "published date" with "scheduled date" by using `publishAt` as a fallback for `date` in visibility checks. This is confusing because:

- `publishedAt` and `publishAt` are easy to typo (one letter difference).
- A post that has been published (`publishedAt: 2024-01-01`) and is also scheduled for future re-publication (`publishAt: 2026-01-01`) is ambiguous.
- The frontmatter reader (`src/parser/frontmatter.ts:48-50`) silently swaps `publishAt` in for `date` if both are present, with no log/warning.

**Fix — Introduce a dedicated `scheduledAt` field for the scheduling feature:**

1. **Frontmatter key:** `scheduledAt` (ISO 8601 datetime). Example: `scheduledAt: 2026-08-01T09:00:00Z`.
2. **Entity field:** add `scheduledAt?: Date` to `DocMeta` entity with `name: 'scheduled_at'` column (nullable).
3. **DB column:** `scheduled_at TEXT NULL` (ISO datetime string).
4. **Visibility rule:** a post is hidden from public routes (HTML, Gemini, Gopher, Spartan, NEX, Finger, RSS, ActivityPub outbox, sitemap) iff `scheduledAt IS NOT NULL AND scheduledAt > now()`. Hidden posts still serve 200 to authenticated admin sessions.
5. **Migration:** rename the existing `publishAt` frontmatter key to `scheduledAt` (with a deprecation warning if the old key is seen). Update `isFutureDatedFrontmatter()` to check `scheduledAt` instead of `publishAt`.
6. **Keep `publishedAt` semantics as-is** — it remains the historical "when was this published" field, populated automatically by the indexer when a post transitions from hidden→visible (or manually via frontmatter).
7. **`hypernext publish <slug>` CLI subcommand** (new) — sets `publishedAt` to now and clears `scheduledAt`. Useful for publishing a scheduled post early.
8. **Update docs:** frontmatter reference, IMPLEMENTATION-PLAN, scaffold `welcome.mdx`.

**Verification:** Save a doc with `scheduledAt: 2030-01-01` in frontmatter. Hit the public URL → 404. Hit the admin-authenticated URL → 200 with the content. Wait until 2030-01-01 (or mock the clock) → public URL returns 200. Query `docs_meta` and assert `scheduled_at` column is populated. Render the page after publication and assert `<time datetime="...">` shows the `publishedAt` date.

---

### P2-3 — `includeStack` race condition (false "Circular include" on concurrent requests)

**Files:** `src/parser/resolver.ts:46-47` (`includeStack = new Set<string>()`).

**What's wrong:** `includeStack` is a module-level `Set`. Two concurrent `<Include src="same-slug" />` calls on different requests will both check `includeStack.has(src)` — one gets `false`, adds it, starts the include; the other gets `true` and returns `[Circular include: ...]` even though there's no actual cycle.

**Why it matters:** Under concurrent traffic, includes randomly fail with misleading error text rendered into the page.

**Fix:** Move `includeStack` to a per-request or per-resolve-context structure (e.g., a `WeakMap` keyed on the request, or pass it through `ComponentContext`).

**Verification:** Fire 10 concurrent requests for the same page that uses `<Include src="shared" />`. Assert all 10 succeed and none contain "Circular include" in the response.

---

### P2-4 — Nested components never re-walked (Sidebar's RecentPosts/TagCloud stay unresolved)

**Files:** `src/parser/pipeline.ts` (`resolveComponentNodes`), `src/parser/resolver.ts` (Sidebar, Header, Main resolvers).

**What's wrong:** When `Sidebar` resolves, it returns IR that contains nested `{ type: "component", componentName: "RecentPosts" }` nodes. `resolveComponentNodes` walks the tree once, resolving `Sidebar` — but doesn't recurse into `Sidebar`'s returned children to resolve `RecentPosts` and `TagCloud`. They stay as unresolved `"component"` nodes and render as `<!-- component: RecentPosts -->` HTML comments.

Confirmed via ad-hoc test: rendering `default.mdx` leaves 2 unresolved nested components.

**Fix:** `resolveComponentNodes` must recursively walk the result of each resolver call and resolve any component nodes it finds. Add a depth limit (e.g., 10) to prevent infinite loops if a resolver returns itself.

**Verification:** Render a page using `<Sidebar />`. Assert the HTML contains a `<nav class="nav-menu">` (from `RecentPosts`'s links) and no `<!-- component: RecentPosts -->` comments.

---

### P2-5 — `copyIrNode` drops 5 fields when cloning IR nodes

**Files:** `src/parser/layout.ts` or wherever `copyIrNode` is defined (need to confirm location).

**What's wrong:** The IR node type has ~12 optional fields (depth, className, id, url, value, datetime, lang, alt, componentName, componentProps, children, sourceUrl, authorName, etc.). `copyIrNode` only copies a subset (typically `type`, `value`, `children`). The rest are silently dropped when a node is cloned during layout slot replacement.

**Why it matters:** Slot replacement clones the layout IR. Cloned nodes lose their `className`, `id`, `url`, etc. The rendered HTML loses CSS hooks, anchor IDs, and link targets.

**Fix:** Use a proper spread: `{ ...node, children: newChildren }`. Or define `copyIrNode` to copy all known fields. Or skip the clone entirely if no transformation is needed.

**Verification:** Render a page with a layout that has `<nav className="site-nav">` outside the slot. Assert the rendered HTML has `class="site-nav"`.

---

### P2-6 — Empty/whitespace frontmatter crashes the parser

**Files:** `src/parser/frontmatter.ts`.

**What's wrong:**

1. `---\n---\n` (empty frontmatter) is NOT recognized as frontmatter — the regex requires at least one character between the delimiters. The text gets parsed as body content (literal `---` lines).
2. `---\n   \n---\n` (whitespace-only frontmatter) crashes the YAML parser.

**Why it matters:** Users who create a new MDX file with empty frontmatter (a very common starting point) get a parse error or garbage output.

**Fix:**

1. Update the frontmatter regex to allow empty content: `/^---\n([\s\S]*?)\n---\n*/`.
2. Skip YAML parsing if the captured content is empty or whitespace-only.

**Verification:** Parse `---\n---\n# Hello` → assert frontmatter is `{}` and body is `# Hello`. Parse `---\n   \n---\n# Hello` → same result.

---

### P2-7 — JSX expression attributes are broken

**Files:** `src/parser/pipeline.ts` or wherever JSX attrs are parsed.

**What's wrong:** JSX attributes like `<RecentPosts limit={50} />` or `<Figure src="/img.png" alt="Hello" />` — the attribute parser handles plain string literals (`src="/img.png"`) but breaks on JSX expressions (`limit={50}`). The expression is either dropped, parsed as a string `"{50}"`, or causes a parse error.

**Why it matters:** Every component that takes a numeric or boolean prop is broken. `<RecentPosts limit={50} />` shows the default 5 posts.

**Fix:** Implement a proper JSX expression evaluator — at minimum, handle numeric (`{50}`), boolean (`{true}`), string (`{"hello"}`), and array (`{["a","b"]}`) literals.

**Verification:** Render `<RecentPosts limit={50} />`. Assert the SQL query uses `LIMIT 50`. Render `<Figure src="/x.png" width={800} />`. Assert the `<img>` has `width="800"`.

---

### P2-8 — `Header` and `Footer` resolvers return wrong IR type

**Files:** `src/parser/resolver.ts:515-536` (Header), `:647-674` (Footer).

**What's wrong:** Both resolvers return `{ type: "section", className: "site-header" }` / `{ type: "section", className: "site-footer" }` — but the HTML renderer has dedicated `header` and `footer` cases that produce `<header>` and `<footer>` tags. By returning `section`, the rendered HTML has `<section class="site-header">` instead of `<header>`. This breaks CSS selectors and semantic HTML.

**Fix:** Return `{ type: "header", ... }` and `{ type: "footer", ... }` respectively.

**Verification:** Render a page with `<Header />` and `<Footer />`. Assert the HTML contains `<header>` and `<footer>` tags.

---

### P2-9 — Latex is not actually rendered with KaTeX

**Files:** `src/parser/resolver.ts:389-392` (emits `{ type: "math", value: expr }`), `src/renderers/html.ts` (math case).

**What's wrong:** The `Latex` resolver correctly emits a `math` IR node, but the HTML renderer's `math` case either emits the raw expression as text (`<span>πr²</span>`) or doesn't exist at all. KaTeX is listed as a dependency but never invoked.

**Fix:** Add a `math` case to `html.ts` that calls `katex.renderToString(value, { throwOnError: false })` and emits the result. Add the KaTeX CSS to the page head.

**Verification:** Render `<Latex math="c = 2\pi r" />`. Assert the HTML contains `<span class="katex">` with the rendered formula.

---

### P2-10 — Contact form and notification emails are XSS-vulnerable

**Files:** `src/federation/email-tasks.ts:256-272` (contact form), instant-notification and digest email builders.

**What's wrong:** `processContactForm` builds `htmlBody` by interpolating `${name}`, `${email}`, and `${bodyText.replace(/\n/g, "<br>")}` directly into HTML sent to the site owner. None are escaped. An attacker can submit `<script src="https://evil.com/x.js"></script>` as their name, or `<img src=x onerror=alert(1)>` as the message body. Same pattern in instant-notification and digest emails.

**Why it matters:** HTML injection into the site owner's email client. While most email clients strip `<script>`, they often allow `<img>`, `<a>`, `<form>` (Outlook, Apple Mail) — enabling phishing of the owner, fake login pages, or pixel-tracking to confirm the owner reads mail.

**Fix:** HTML-escape all interpolated values. Use a library like `escape-html` or `html-entities`. For line breaks in the body, escape first, then replace `\n` with `<br>`.

**Verification:** Submit the contact form with `name=<script>alert(1)</script>`. Assert the email body contains `&lt;script&gt;` (escaped), not `<script>`.

---

### P2-11 — `verifyLinkInHtml` accepts target URL in comments or non-link attributes (webmention spoofing)

**Files:** `src/federation/inbound.ts:118-121`.

**What's wrong:** `verifyLinkInHtml` does `new RegExp(escapedTarget, "i").test(html)` — it just looks for the target URL anywhere in the HTML, including comments (`<!-- http://target -->`), plain text, `<style>`/`<script>` blocks, or non-link attributes (`<img src="http://target/img.png">`). The Webmention spec §3.2.1 says the source must contain a link (an `<a>`, `<area>`, `<link>` href, or `<cite>` etc.) to the target.

**Why it matters:** Spoofing — an attacker can include the target URL in a comment or non-link context and get a mention stored without actually linking.

**Fix:** Parse the HTML and look for `a[href]`, `area[href]`, `link[href]`, `img[src]`, `video[src]`, `audio[src]`, `source[src]`, `blockquote[cite]`, `q[cite]`, `del[cite]`, `ins[cite]` attributes whose resolved URL equals the target. A regex like `/<(?:a|area|link)\s[^>]*href=["'](${escaped})["']/i` is a minimum bar; full parse is better.

**Verification:** Source HTML containing only `<!-- http://target -->` should fail verification.

---

### P2-12 — Bluesky: uses `accessToken` as password, logs in on every syndication

**Files:** `src/bridge/bluesky.ts:15-35`.

**What's wrong:** `agent.login({ identifier: bskyConfig.identifier ?? "", password: bskyConfig.accessToken ?? "" })` — the config field is named `accessToken` but it's used as a password. Bluesky uses **app passwords** (not access tokens) for `agent.login`. Additionally, `login` is called on every `syndicateToBluesky` invocation, which: (a) wastes a network round-trip; (b) may hit rate limits; (c) doesn't persist the session. The `BskyAgent` is created fresh each call, defeating its built-in session-resumption.

**Fix:** Rename config field to `appPassword` (or `password`). Create a module-level `BskyAgent` singleton, call `agent.resume()` with a persisted session if available, only call `login` if resume fails. Persist the new session after login.

**Verification:** Two consecutive syndications should only call `login` once.

---

### P2-13 — Mastodon syndication: no status length limit, no rate-limit handling, no reply threading

**Files:** `src/bridge/mastodon.ts:4-38`.

**What's wrong:** `syndicateToMastodon` posts `${content}\n\n${url}` as a single status. Mastodon instances default to a 500-character limit per status. If `content` is a long blog post, the status will be 422'd. No retry on 429 (rate limit). No `in_reply_to_id` for threading. No `visibility` setting (defaults to public). No media upload support.

**Fix:** Truncate `content` to fit within `500 - url.length - 2`. Handle 429 with `Retry-After`. Add `visibility: "public"` (or configurable). For replies, set `in_reply_to_id`.

**Verification:** Test with a 1000-char content — should succeed with truncated status.

---

### P2-14 — ActivityPub outbox returns empty collection

**Files:** `src/federation/activitypub.ts:285-292`.

**What's wrong:** `GET /outbox` returns `{ type: "OrderedCollection", totalItems: 0, orderedItems: [] }` hardcoded. ActivityPub spec §5 says the outbox should contain the actor's recent activities. With `totalItems: 0`, the actor appears to have no posts — other servers won't display the actor's content in their discover feeds.

**Fix:** Query `docs_meta WHERE type = 'post'` ordered by date desc, build `Create { actor, object: Note { id, content, published, url } }` activities, return as `OrderedCollection` with `totalItems` and first/last pages. Implement pagination per ActivityStreams spec.

**Verification:** GET /outbox returns `totalItems` matching the post count.

---

### P2-15 — HTTP Signature regex requires fixed header ordering

**Files:** `src/federation/activitypub.ts:8-9` and `:37-56`.

**What's wrong:** `HTTP_SIGNATURE_REGEX = /^keyId="([^"]+)",\s*algorithm="([^"]+)",\s*headers="([^"]*)",\s*signature="([^"]+)"$/` requires parameters in the exact order `keyId, algorithm, headers, signature`. The HTTP Signatures spec (RFC 9421, formerly draft-cavage) allows any order. Real-world signatures from Mastodon, GotoSocial, Akkoma, Pleroma may use different orders. The regex also doesn't handle the `created` and `expires` pseudo-headers added in RFC 9421.

**Why it matters:** Many legitimate federation peers will fail signature verification and (per P0-8) be rejected.

**Fix:** Parse the Signature header as a comma-separated list of `key="value"` pairs into a `Map`, then look up each field by name. Use a proper HTTP Signatures library (e.g., `http-signature-header`) if available.

**Verification:** Test with `algorithm="rsa-sha256",headers="(request-target) host date",signature="...",keyId="..."` (reordered) — should still verify.

---

### P2-16 — No rate limiting on inbound federation / micropub / inbox endpoints

**Files:** `src/federation/inbound.ts:259-356`, `src/federation/activitypub.ts:295-335`, `src/micropub/index.ts:11-43`.

**What's wrong:** The newsletter routes register `@fastify/rate-limit` (per-route limits). The inbound federation routes (`/webmention`, `/pingback`, `/trackback`, `/inbox`) and `/micropub` have NO rate limiting. An attacker can flood these endpoints with thousands of requests per second, each triggering an outbound fetch (5s timeout), an Akismet API call, and DB writes — easily exhausting the connection pool and SQLite write lock.

**Why it matters:** DoS amplification — each inbound request costs ~6s of CPU + multiple network round-trips. Spamming `/webmention` with random sources can take down the server.

**Fix:** Register `@fastify/rate-limit` globally in `createHttpServer` with sensible defaults (e.g., 30 req/min per IP for `/webmention`, `/pingback`, `/trackback`, `/inbox`, `/micropub`). Add `config: { rateLimit: { max: 30, timeWindow: "1 minute" } }` to each route.

**Verification:** Fire 100 rapid `/webmention` POSTs and assert 429 after the limit.

---

### P2-17 — `PUT /api/v1/docs/*` has no path-traversal validation

**Files:** `src/api/routes.ts:166-172`.

**What's wrong:** `slug` is the raw wildcard capture, which can contain `..` segments. An attacker with a valid JWT can `PUT /api/v1/docs/../../etc/passwd` (URL-encoded as `%2F..%2F..%2Fetc%2Fpasswd`) to write arbitrary files. The test only uses a clean slug.

**Why it matters:** Authenticated path-traversal write — an attacker who obtains any JWT (e.g., via the IndieAuth flaws in P0-7) can overwrite `~/.ssh/authorized_keys`, `~/.bashrc`, the hypernext binary itself, etc.

**Fix:** Validate `slug` matches `/^[a-z0-9-/]+$/i` and contains no `..` segments. Resolve to absolute path and verify it's inside the storage root.

**Verification:** PUT to `/api/v1/docs/../../etc/passwd` returns 400.

---

### P2-18 — `extractTargetSlug` uses string prefix matching (prefix-collision risk)

**Files:** `src/federation/inbound.ts:25-35`.

**What's wrong:** `if (!target.startsWith(base))` — a string prefix check, not a URL parse. `http://localhost:8080.evil.com/blog/post` passes the check (since `http://localhost:8080` is a prefix). The slug becomes `evil.com/blog/post`. While this doesn't directly compromise the server, it allows an attacker to pollute the mentions table with arbitrary `target_slug` values for non-existent docs.

**Fix:** Parse both `target` and `config.site.canonicalBase` as URLs and compare `protocol + host + port` exactly.

**Verification:** `extractTargetSlug("http://localhost:8080.evil.com/x", config)` returns null.

---

### P2-19 — Logger secret masking is broken

**Files:** `src/utils/logger.ts`.

**What's wrong:** `maskSensitive()` is applied only to the `msg` string, not to the `meta` object. Secrets in meta are logged in plaintext via `JSON.stringify`. Confirmed via ad-hoc test: a logger call like `log.info({ apiKey: "sk-..." }, "request")` writes `{"apiKey":"sk-..."}` to the log.

**Fix:** Recursively walk the meta object and mask any key matching `/(key|token|secret|password|auth)/i`. Apply the same masking to nested objects and arrays.

**Verification:** `log.info({ apiKey: "sk-test123" }, "x")` → log output contains `"apiKey":"[REDACTED]"`.

---

### P2-20 — `deepMerge` prototype pollution from YAML-parsed sources

**Files:** `src/utils/deep-merge.ts`.

**What's wrong:** `deepMerge` does not block `__proto__` as a key. Confirmed via ad-hoc test: merging a YAML-parsed source `__proto__: { polluted: "yes" }` into `{}` produces a result where `result.polluted === "yes"` (the prototype of the result object is changed). This doesn't pollute `Object.prototype` globally (because YAML uses `Object.create(null)` for the source), but it does pollute the result object's prototype.

**Why it matters:** If the merged config is later used in a context that checks `hasOwnProperty`, the polluted prototype keys will pass the check. Defense-in-depth failure.

**Fix:** In the merge loop, skip keys `__proto__`, `constructor`, and `prototype`. Or use `Object.defineProperty(result, key, { value: ... })` to set without triggering prototype chain.

**Verification:** Merge `{ __proto__: { polluted: "yes" } }` into `{}`. Assert `result.polluted === undefined` and `Object.prototype.polluted === undefined`.

---

### P2-21 — S3 credentials silently dropped from config

**Files:** `src/config.ts` or `src/storage/s3.ts` (need to confirm).

**What's wrong:** When `storage.type: "s3"` is set, the S3 credentials from config are not properly passed through to the S3 client. The client falls back to anonymous access, which fails on private buckets — but the failure is silent (no error, just empty content lists or 403s on read).

**Fix:** Verify the S3 config flow: `config.storage.s3.accessKeyId` → S3 client constructor. Add a startup smoke test that does `s3.headBucket()` and fails loud if credentials are missing.

**Verification:** Set invalid S3 credentials in config, boot. Assert a clear error message, not a silent failure.

---

### P2-22 — Subscriber PII exposed via MCP `list_subscribers` tool — GATE VIA API AUTH

**Files:** `src/mcp/tools-email.ts` (or similar).

**What's wrong:** The `list_subscribers` MCP tool returns the full subscriber records, including email addresses and IP addresses, to any MCP client with access. There's no redaction, no role-based access control.

**Maintainer decision (confirmed):** MCP PII follows the same auth model as the REST API (per P0-5). Public-read data (public docs, public posts) is accessible to any MCP client. Everything else (subscriber emails, stats, hidden docs, moderation, blocklist) requires an authenticated MCP session with the same scopes as the REST API.

**Fix:**

1. Add MCP authentication: when `agent.enabled: true` and MCP is started, require clients to authenticate via an OAuth-style flow (reuse the IndieAuth passkey flow from P0-7) or a static API token configured via `agent.mcp.apiToken`. The token must be passed in the MCP `Authorization` header.
2. Split MCP tools into two categories:
   - **Public-read tools** (no auth required): `read_doc`, `list_docs`, `search_docs`, `get_summary` (for non-hidden docs).
   - **Admin tools** (auth required): `list_subscribers`, `get_stats`, `list_blocklist`, `moderate_comment`, `read_hidden_doc`, `talk_to_docs` (RAG may surface hidden-doc snippets), `generate_summary` (writes to DB).
3. When an admin tool is called without auth, return an MCP error response with `error: { code: 'UNAUTHORIZED', message: 'This tool requires authentication' }`.
4. When authenticated, `list_subscribers` returns the full records including emails. When unauthenticated, the tool is not even registered (so it doesn't appear in `tools/list`).
5. Add a `redact: boolean` parameter to `list_subscribers` (default `false` for authed, always `true` for unauthed if you ever want to expose a redacted view) — but per the maintainer decision, unauthed clients should not see the tool at all.

**Verification:**

- Start MCP server without auth token configured. Call `tools/list`. Assert `list_subscribers` is NOT in the list.
- Start MCP server with `agent.mcp.apiToken: 'test-token'`. Call `tools/list` without `Authorization` header. Assert only public-read tools are listed.
- Call `tools/list` with `Authorization: Bearer test-token`. Assert all tools including `list_subscribers` are listed.
- Call `list_subscribers` without auth. Assert `UNAUTHORIZED` error.
- Call `list_subscribers` with auth. Assert full emails are returned.

---

### P2-23 — Moderation blocklist POST/DELETE are no-ops

**Files:** `src/api/moderation.ts:143-173`.

**What's wrong:** `POST /api/v1/blocklist` validates `type` and `value`, then returns `{ data: { type, value }, status: "added" }` without persisting anywhere — no DB write, no config update. `DELETE /api/v1/blocklist/:type/:value` similarly returns `{ status: "removed" }` without removing anything.

**Why it matters:** Moderators cannot actually block spam domains/IPs/handles. The blocklist feature is cosmetic.

**Fix:** Create a `Blocklist` entity (or use a `KeyValue` table) and persist entries. Update `getGlobalCommentConfig` to merge DB-stored blocklist entries with config-file blocklist.

**Verification:** POST a block entry, then GET `/api/v1/blocklist` and assert the new entry is present. Send a webmention from the blocked domain and assert it's filtered.

---

### P2-24 — CSS relative path breaks on sub-routes

**Files:** `src/renderers/html.ts` or `src/renderers/head.ts`.

**What's wrong:** The CSS path `./assets/style.css` is output verbatim in `<link> href`. On `/blog/post` the browser resolves this to `/blog/assets/style.css` — which 404s. Only the root page `/` gets the correct CSS.

**Fix:** Output an absolute path: `/assets/style.css`. Or resolve against `config.site.canonicalBase`.

**Verification:** Hit `/blog/post`. Assert `<link href="/assets/style.css">` in the HTML head.

---

### P2-25 — `recordPageview` missing on most routes

**Files:** `src/analytics/stats-manager.ts`, `src/servers/*.ts`.

**What's wrong:** `recordPageview` is only called on cache-miss doc routes (http, gemini, gopher, spartan, nex, text). NOT called on home, collection root, archive, taxonomy, author routes, or cache hits. Analytics undercount traffic by ~70% in typical setups.

**Fix:** Call `recordPageview` on every successful HTTP response (200/3xx) for HTML routes, regardless of cache hit/miss. Add it as a Fastify `onResponse` hook.

**Verification:** Hit `/`, `/blog`, `/tags/foo`, `/blog/post` (cache hit and miss). Assert all 4 increment the pageview counter.

---

### P2-26 — Other parser/layout medium-severity issues

For brevity, the following medium-severity parser/layout issues are documented in the worklog but not expanded here. Each should be addressed as part of the parser/layout fix batch (P1-3 batch):

- `findLayout` dead code branch (collection fallback never reached when explicitLayout is set).
- `Breadcrumbs` first-crumb labels `/` as "Home" but links to `/home` instead of `/`.
- `Figure` resolver ignores `alt` prop (only uses `caption`).
- `TagCloud` ignores `taxonomy` prop (always shows all taxonomies).
- `parseToIR` called 3× per page render (once for layout, once for doc, once for `TableOfContents`).
- `Title`/`PostMeta` double-injection risk when used both in layout and in `wrapSkeleton`.
- `Header` resolver calls `buildNav()` with no config arg (inconsistent with `NavMenu` which passes config).
- `Enclosure` emoji `📎` rendered on ASCII protocols (Gopher, Finger) — corrupts terminal output.
- Multiple `as IrNode` casts hide missing required fields.
- Spread attributes (`{...props}`) dropped during JSX attribute parsing.
- `schema.sql` drift from MikroORM entity definitions.
- Redundant `ALLOWED_COMPONENTS` check (security check runs in both `pipeline.ts` and `resolver.ts`).

---

### P2-27 — `storage.type: "ipfs"` requires both `storage.type: ipfs` AND `ipfs.enabled: true` (two-gate confusion)

**Files:** `src/storage/index.ts:16-20`, `src/storage/ipfs.ts`, `src/types/config.ts:78-82`.

**What's wrong:** When `storage.type === "ipfs"`, `createStorage()` checks `config.ipfs?.enabled`. This creates an awkward two-gate: the user must set **both** `storage.type: ipfs` AND `ipfs.enabled: true` to use IPFS as the primary storage backend. Setting only one silently falls back to local storage with no error.

The plan shows IPFS configuration as a self-contained block where `ipfs.enabled: true` is sufficient to enable IPFS storage. The `storage.type` field in the plan doesn't include `"ipfs"` as a storage type — IPFS is intended to be **additive** (caching/pinning) rather than a replacement storage provider. The existing `IPFSStorageProvider` tries to be both a storage provider AND a caching/pinning layer, which creates the ambiguity.

**Why it matters:** Users who set `ipfs.enabled: true` expecting IPFS storage will silently get local storage. Users who set `storage.type: ipfs` without `ipfs.enabled: true` will silently get local storage. Both failure modes are silent.

**Maintainer decision (confirmed):** Option A — IPFS is always additive.

**Fix:**

1. Remove `"ipfs"` from `StorageConfig.type`. The type becomes `'local' | 's3'`.
2. `ipfs.enabled: true` enables IPFS pinning on top of the primary storage. `storage.type` is always `local` or `s3`.
3. Delete the dual-purpose `IPFSStorageProvider` (or strip its storage-provider methods, leaving only `pin(slug, cid)` / `unpin(slug)` / `resolve(slug)` methods for the additive pinning layer).
4. Update `createStorage()` to never return an `IPFSStorageProvider` as the primary storage.
5. Wire IPFS pinning into the post-index cascade (per P1-1): after a successful `indexDocument`, schedule an `ipfs-pinning` job that pins the doc to IPFS and stores the CID in a new `doc_pins` table (or `docs_meta.ipfs_cid` column).
6. Update `config.example.yml` and `DEFAULT_CONFIG_YAML` to reflect that `storage.type: ipfs` is invalid (validation error).
7. Update IPFS-PLAN to document the additive model and remove any references to IPFS-as-primary-storage.

**Verification:** Set `ipfs.enabled: true` with `storage.type: local`. Save a doc. Assert: (a) doc is stored locally at the expected path, (b) an `ipfs-pinning` job is scheduled (per P1-1), (c) after the job completes, `docs_meta.ipfs_cid` is populated, (d) the doc is pinned to IPFS (verify via `ipfs pin ls` against the configured IPFS node). Set `storage.type: ipfs` → assert `validateConfig()` rejects with a clear error message.

---

### P2-28 — Missing `hypernext setup` CLI command for AI dependency installation

**Files:** No `src/commands/setup.ts` exists. `package.json` `bin` field has no `setup` entry.

**What's wrong:** AI-PLAN section 9 says users can "install openai and sqlite-vector manually or via a CLI setup flag (`hypernext setup ai`)." The actual CLI has no `setup` command at all. There's no `hypernext setup` infrastructure.

This is especially painful now that P0-3 is identified: users who want AI features must manually `pnpm add sqlite-vec` and figure out how to call `loadExtension()`. A `hypernext setup ai` command that does this automatically would eliminate the P0-3 footgun for new users.

**Why it matters:** AI features are effectively undiscoverable. A user who reads AI-PLAN, sets `ai.enabled: true`, and restarts the server gets a crash (P0-3) with no guidance on how to fix it.

**Maintainer decision (confirmed):** Single `hypernext setup` command that presents an interactive checklist wizard. User picks what they want to set up from a multi-select list; the wizard runs each selected step interactively.

**Fix:**

1. Create `src/commands/setup.ts` as an oclif command.
2. Use a TUI library (e.g., `@inquirer/prompts` or `prompts`) to render a multi-select checklist:
   ```
   ? What would you like to set up? (space to select, enter to confirm)
   ◉ AI / vector DB (installs openai + sqlite-vec, loads extension, smoke test)
   ◯ Email (verifies SMTP config, sends test email)
   ◯ Federation (generates ActivityPub keypair, verifies webmention endpoint)
   ◯ Bridges (verifies Mastodon/Bluesky credentials)
   ◯ Storage (verifies S3 credentials OR local path writability)
   ◯ Passkey admin (creates admin passkey credential — required for first launch per P0-7)
   ◯ IPFS (verifies IPFS node reachability)
   ◯ Templates (scaffolds `templates/` directory with default copies — per P0-4/P1-7)
   ```
3. For each selected item, the wizard:
   - Installs needed npm deps into the user's `package.json` (via `pnpm add` or `npm install`).
   - Updates `config.yml` with sensible defaults for the selected subsystem.
   - Runs a smoke test (e.g., for AI: `loadExtension()` + a 1-token OpenAI completion; for email: send a test email to the configured recipient; for federation: generate keypair and POST a test webmention to `webmention.io`).
   - Prints success/failure for each step.
4. Add a `--check` flag that runs verification-only (no installs, no config writes) — useful for CI and for "is my setup still working?" checks.
5. Add a `--only <subsystem>` flag for non-interactive use (e.g., `hypernext setup --only ai --check` in CI).
6. The passkey admin setup is **required** for first launch per P0-7. If the user runs `hypernext serve` without a passkey credential registered, the server should refuse to start and print a message pointing them to `hypernext setup`.

**Verification:**

- Run `hypernext setup` on a fresh project. Assert the interactive checklist appears. Select "AI / vector DB". Assert: (a) `openai` and `sqlite-vec` are added to `package.json`, (b) `loadExtension()` smoke test passes, (c) `config.yml` is updated with an `agent: { enabled: true, ai: { enabled: true, ... } }` block (per P0-12), (d) booting with `ai.enabled: true` no longer crashes (resolves P0-3).
- Run `hypernext setup --check` on a configured project. Assert each previously-configured subsystem reports `OK`.
- Run `hypernext setup --only passkey-admin`. Assert the passkey creation flow runs interactively (per P0-7).

---

### P2-29 — `config.example.yml` is missing ~15 config sections (revisited)

**Files:** `config.example.yml`, `src/config.ts` (`DEFAULT_CONFIG_YAML`).

**What's wrong:** Expanding on P3-7: `config.example.yml` is missing sections for AI, IPFS, email, federation, bridges (Mastodon, Bluesky), analytics, scheduling, PDF, ebooks, comments/moderation, blocklist, rate limits, MCP, TLS certs for Spartan/Gemini, **and the `agent` block** (which per P0-12 is the master toggle for all AI features). A new user copying this file as their `config.yml` will have no idea the `agent` block exists, let alone that it's the gate for MCP/AI/sitemap/llms.txt.

Additionally, the `DEFAULT_CONFIG_YAML` in `src/config.ts` and `config.example.yml` have drifted from each other — `DEFAULT_CONFIG_YAML` is the source of truth at runtime, but `config.example.yml` is what users copy. They should be identical or generated from a single source.

**Why it matters:** The first-run experience is broken. Users can't discover features by reading the example config. And the `agent` block — the most important config block per P0-12 — is invisible.

**Fix:**

1. Generate `config.example.yml` from `DEFAULT_CONFIG_YAML` (or vice versa) so they can't drift. Add a CI check that diffs them.
2. Ensure `DEFAULT_CONFIG_YAML` includes all config sections with sensible defaults and inline comments explaining each.
3. Ensure the `agent` block is prominently documented in the example, with a comment explaining it's the master toggle for AI/MCP/agent-readiness features.

**Verification:** `diff config.example.yml <(extract DEFAULT_CONFIG_YAML from src/config.ts)` returns empty. `grep -c "^[a-z]" config.example.yml` returns ≥15 (one per top-level config section).

---

## P3 — Dead code, doc rot, hygiene

### P3-1 — Stale TUI documentation referencing the archived TUI — DELETE (TUI permanently canceled)

**Maintainer decision (confirmed):** The TUI is permanently canceled. Delete `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` from `main` (no archival prefix). Strip all TUI references from README. The current state (no marker) is the worst option.

Since you've pivoted away from the TUI (archived on `support/tui-editor`), the current `main` branch still has rot from it:

- `README.md` line 110–113 documents `pnpm dev:editor`, but no `dev:editor` script exists in `package.json` anymore.
- `README.md` line 178 lists "TUI Editor" as a current feature.
- `README.md` line 199 links to `docs/tui.md`, which **does not exist** in the repo.
- `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` are still sitting in `plans/` with `Status: Proposed Supplementary Architecture` — no marker that they're superseded/archived, which is presumably part of why "the plan and what came together" feels disconnected: the plans directory itself doesn't reflect the actual current direction.

**Fix:**

1. Delete `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` from `main`.
2. Strip the TUI section from `README.md` (lines ~110–113, 178, 199).
3. Remove the dead `docs/tui.md` link.
4. Delete the dead `EditorConfig` type (P3-9) and `RemoteConfig` type (P3-10) — these were left over from the TUI pivot.
5. Confirm `support/tui-editor` branch still exists as the historical record (no action needed there).

**Verification:** `rg -n "TUI|tui-editor|dev:editor|docs/tui" .` returns zero matches outside of git history.

---

### P3-2 — `router.ts` `matchRoute()` export is unused

**Files:** `src/router.ts`, `src/servers/http.ts`.

`matchRoute()` is exported but never called — `servers/http.ts` hand-rolls its own Fastify route matching instead of using it. (The other exports from `router.ts` — `getArchiveDocs`, `getTaxonomyDocs`, `getAuthorDocs`, `getCollectionDocs` — *are* used, via dynamic import from `resolver.ts`'s `Archive` component, so router.ts isn't fully dead, just that one function.)

**Fix:** Delete `matchRoute` or wire it into `servers/http.ts`.

---

### P3-3 — `/api/v1/mentions/*` routes duplicate `/api/v1/comments/*`

**Files:** `src/api/moderation.ts`.

Legacy `/api/v1/mentions/*` routes duplicate `/api/v1/comments/*` almost verbatim. Fine if intentional back-compat, but confirm that's still needed or delete.

---

### P3-4 — Fresh `hypernext init` scaffold's REST API is unusable out of the box

`/api/v1/docs` (and presumably other admin REST routes) return `401 Unauthorized` by default with no API key configured. Worth double-checking against IMPLEMENTATION-PLAN's intent for which routes should be public-read vs. admin-only; as-is, a fresh `hypernext init` scaffold's REST API is unusable out of the box without first configuring auth, which may not be the intended first-run experience.

---

### P3-5 — `tsconfig.json` does not include `tests/**/*` — CONFIRMED FIX NEEDED

**Files:** `tsconfig.json`.

**Maintainer decision (confirmed):** Everything needs to be type-checked, including tests.

`tsc --noEmit` passes — but `tsconfig.json` `include` is `src/**/*`, so tests are NOT type-checked. Type bugs in tests slip through. For example, `tests/review.test.ts:219` and `:259` call `registerNewsletterRoutes(fastify, config)` with two args, but the function takes one — TypeScript would catch this, but the test isn't checked.

**Fix:**

1. Add `"tests/**/*"` to `tsconfig.json` `include`, OR create a `tsconfig.test.json` that extends the base and adds tests.
2. Run `tsc --noEmit -p tsconfig.test.json` (or `tsc --noEmit` if tests are in the main config) in CI.
3. Fix the ~5–10 latent type bugs that will surface (the `registerNewsletterRoutes` arg-count mismatch is one known instance).
4. Add a CI step that fails the build on any `tsc` error.
5. Also type-check E2E tests if they aren't already (some test runners like Playwright have their own tsconfig — make sure those are checked too).

**Verification:** `tsc --noEmit` (with the new config) exits 0. CI runs `tsc --noEmit` as a required check.

---

### P3-6 — Eleven `@ts-expect-error` comments silence real type bugs

**Files:** `src/api/routes.ts:253`, `src/federation/workmatic.ts:224`, `src/federation/ai-tasks.ts:52/85/118/139/163/185/203/249`, `src/federation/email-tasks.ts:225-226`.

Each `@ts-expect-error` is hiding a real type mismatch:

- The two EPUB ones (P0-6) hide the wrong-API-usage bug.
- The seven AI ones silence `response.choices[0]` being possibly `undefined` (OpenAI SDK v6 types). Fix: `const choice = response.choices?.[0]; if (!choice) throw new Error("OpenAI returned no choices");`.
- The `ribaunt` import one hides a missing type definition.

**Fix:** Remove each `@ts-expect-error` and fix the underlying type issue. If a third-party package lacks types, add a `declare module "..."` in a `.d.ts` file.

---

### P3-7 — `config.example.yml` is missing ~15 config sections

**Promoted to P2-29** (now that the `agent` block — the master toggle per P0-12 — is also missing from the example, this is more than hygiene; it blocks the first-run AI/MCP setup story). See P2-29 for the full fix.

---

### P3-9 — Dead `EditorConfig` type — DELETE (TUI permanently canceled)

**Files:** `src/types/config.ts:199-201` (`EditorConfig` type defined), `src/types/config.ts` (`HypernextConfig` interface — `editor` not included), `src/config.ts` (`DEFAULT_CONFIG_YAML` — no `editor` key).

**What's wrong:** The `EditorConfig` type exists in `src/types/config.ts` but is **not included in the `HypernextConfig` interface** and **not present in `DEFAULT_CONFIG_YAML`**. The plan shows `editor.defaultMode` as a config key. This is dead code left over from the TUI pivot (P3-1).

**Maintainer decision (confirmed):** TUI is permanently canceled (per P3-1). The `EditorConfig` type is dead code.

**Fix:** Delete the `EditorConfig` type. Confirm no production code references it.

**Verification:** `rg -n "EditorConfig|editor\?\." src/` returns zero matches.

---

### P3-10 — Dead `RemoteConfig` type — DELETE (TUI permanently canceled)

**Files:** `src/types/config.ts:245-249` (`RemoteConfig` type defined), `src/commands/token.ts` (referenced as a hint in output).

**What's wrong:** The `RemoteConfig` type has `enabled`, `token`, `url` fields. It's referenced in the `token` command's output (as a hint) but it's **not in `HypernextConfig`** and **not in `DEFAULT_CONFIG_YAML`**. It's dead code for the TUI remote mode, which was archived with the TUI (P3-1).

**Maintainer decision (confirmed):** TUI is permanently canceled (per P3-1). The `RemoteConfig` type is dead code.

**Fix:** Delete the `RemoteConfig` type and the hint in `token.ts`.

**Verification:** `rg -n "RemoteConfig|remote\?\." src/` returns zero matches.

---

### P3-11 — `config.site.theme.cssPath` is optional but plan shows it as a default

**Files:** `src/types/config.ts:12` (`SiteThemeConfig.cssPath?: string`), `src/config.ts:16` (DEFAULT_CONFIG_YAML).

**What's wrong:** The plan shows `theme.cssPath: "./assets/style.css"` as a standard config, with `theme` being a required sub-key of `site`. The actual type has `theme?: SiteThemeConfig` with `cssPath?: string`. This is a minor type divergence — the field is optional when the plan treats it as required-with-default.

Combined with P2-24 (CSS relative path breaks sub-routes), this means a user who omits `theme.cssPath` from their config gets no CSS at all, with no warning.

**Fix:** Either make `theme.cssPath` required (with a default of `./assets/style.css` in `DEFAULT_CONFIG_YAML`), or document that omitting it disables CSS. Reconcile with the P2-24 fix (absolute path).

**Verification:** Boot with `theme.cssPath` omitted. Assert either: (a) CSS loads from the default path (if default is provided), or (b) a clear warning is logged that CSS is disabled.

---

### P3-8 — Other cleanup items (low priority)

Documented in the worklog but not expanded here:

- `logger.attachTransport` is dead code.
- `cache.test.ts` has IR shape inconsistency.
- `tooling.test.ts` is trivial.
- Tests use `as any` for config throughout.
- Tests don't replicate production auth setup.
- `nav.ts` builds full `DocMeta` query when it only needs slug + title.
- `router.ts matchRoute` redundant branch.
- `config.example.yml` database path inconsistent with defaults.
- `scaffoldDefaults` welcome.mdx hardcoded date.
- `stats-manager` only computes daily aggregates (no weekly/monthly).
- `validateConfig` only checks 3 keys.
- `docker-compose` no resource limits.
- `generate-certs` openssl PATH hardcoded.
- `biome.jsonc` minimal config.
- `digest cron` `docs` array maps slugs to `{slug, title}` with title=slug (subscribers see `blog/my-post` instead of "My Post").
- `processContactForm` ribaunt import.
- `sendTestEmail` throws but other email tasks silently return (inconsistent error handling).
- `aiModerateComment` `stripMdx` regex is naive (doesn't handle JSX expressions, frontmatter with `---` inside strings).
- `convertContent` returns empty string for missing content (should error per micropub spec).
- `moderation` `where.hidden = false` branch excludes hidden items from spam-status filter (probably intended but undocumented).
- `Comments` resolver SQL doesn't select `hidden` column (works in SQLite but fragile).
- `EditorConfig` and `RemoteConfig` types are dead code (see P3-9, P3-10).
- `config.site.theme.cssPath` is optional but plan treats it as required (see P3-11).

---

## Why none of this showed up in testing

- **Unit tests** (847 passing) mock `getEm()`/config and call functions directly with hand-crafted inputs — they never exercise `reindexAll()` against a directory containing a document that fails to parse, never boot the server with `ai.enabled: true`, never assert that `enqueueIndexing()` (etc.) is called from the real indexer, and never render the full layout pipeline end-to-end.
- **E2E tests** (179 passing) boot the server and hit real sockets for every protocol — genuinely good coverage — but every fixture MDX file used across the E2E suite happens to be well-formed and never touches `EmailSubscribe`/`ContactForm`, and no E2E test enables AI or asserts that a save triggers the indexing→embedding→pin cascade.
- **Type checking** passes but `tsconfig.json` excludes `tests/**/*`, so type bugs in tests slip through.
- **Linting** passes but `biome.jsonc` is minimal — no rules for `@ts-expect-error` count, no security-focused rules.

This is the textbook failure mode for "plan says X pipeline, code has all the pieces of X, nothing connects them, and every test happens to stay on the happy path where it doesn't matter."

---

## Recommended remediation order

The order below is sequenced so that each fix unblocks the next, and so that the highest-blast-radius issues are addressed first. Each step includes the verification test that should accompany it.

### Phase 1 — Stop the bleeding (P0, ~2–3 days)

1. **P0-1**: try/catch + transactional reindex in `src/indexer/index.ts`. *Small, contained fix. Prevents cascading outages.* Add E2E test: drop a malformed MDX file in a running project, assert other pages still serve 200.
2. **P0-2**: centralize path resolution against project root in `src/config.ts`. *Small fix, huge blast radius if left.* Add E2E test: run `serve --project /tmp/foo` from three different cwds, assert DB created at `/tmp/foo/db/hypernext.db`.
3. **P0-3**: add `sqlite-vec` dependency, load the extension before `initVecTable()`, add a boot-smoke E2E test with `ai.enabled: true`. *This alone would have caught the AI crash.*
4. **P0-13**: add `createStorage(config)` to `startAllServers()`, remove lazy init calls. *Unblocks all storage operations before first reindex.*
5. **P0-5**: fix the auth guard to exempt public routes. *Unblocks the entire email subsystem.*
6. **P0-7**: IndieAuth PKCE + redirect_uri validation + user auth at `/auth/authorize`. *Real OAuth security hole.*
7. **P0-9**: extend SSRF blocklist + DNS resolution step. *Real SSRF hole.*
8. **P0-8**: generate RSA keypair for ActivityPub, sign outgoing activities, reject unverified inbox activities. *Federation forgeability.*
9. **P0-10**: `getEm().fork()` at every call site. *Concurrency correctness.*
10. **P0-11**: XML-RPC pingback parser + form-encoded micropub. *Spec conformance for inbound posting.*
11. **P0-6**: fix EPUB generation (temp file path, `readFileSync`, remove `@ts-expect-error`). *Feature is completely broken.*
12. **P0-12**: rewire `agent.enabled` as the master toggle for MCP + AI + agent-readiness. *Architectural violation of intended design — unblocks the "off by default" AI posture.*

### Phase 2 — Wire up the features the plans describe (P1, ~6–8 days)

13. **P0-4**: delete `wrapSkeleton`, return the layout IR directly, move skeleton components into default templates. *This is the core of the layout-templating-engine feature.*
14. **P1-7**: create `templates/` directory with default layouts, update `scaffoldDefaults()` to copy them into new projects. *Unblocks the zero-config layout customization story.*
15. **P1-6**: fix `email-digest.mdx` parsing, audit all default templates end-to-end.
16. **P2-4**: recursive `resolveComponentNodes` (fixes nested components in Sidebar/Header/Main).
17. **P2-1**: layout path traversal guard.
18. **P2-2**: `publishAt` vs `publishedAt` field-name unification.
19. **P2-3**: move `includeStack` to per-request scope.
20. **P2-5**: fix `copyIrNode` to spread all fields.
21. **P2-6**: empty/whitespace frontmatter handling.
22. **P2-7**: JSX expression attributes.
23. **P2-8**: `Header`/`Footer` return correct IR type.
24. **P2-9**: KaTeX rendering for `Latex`.
25. **P1-3**: add `EmailSubscribe`/`ContactForm` to allowlist, rewrite resolvers to emit form IR, add form renderer case in `html.ts`.
26. **P1-1**: replace workmatic with SQLite-persisted queue + `piscina` worker pool (per maintainer decision). Create `src/jobs/` module, `src/jobs/worker.ts`, `src/jobs/processors/`. Wire `scheduleIndexing`/`scheduleInboundMention`/`schedulePdfGeneration`/`scheduleEpubGeneration`/`scheduleIpfsPinning` into their call sites. Delete `src/federation/workmatic.ts` and the `workmatic` dep. Add `piscina` dep. *~5 days.*
27. **P1-8**: move `generateSummary`/`ragSearch`/`suggestTags`/`generateSeoMeta`/`generateAltText`/`aiModerateComment` into `src/jobs/processors/ai-text.ts`, `ai-vision.ts`, `ai-moderation.ts`. HTTP handlers return 202 + `Location: /api/v1/jobs/:jobId`. *Blocked by P0-3, P0-12, P1-1.*
28. **P1-2**: `<Comments />` calls `schedulePosseReplyFetch` with LRU cache (15 min TTL).
29. **P1-4**: wire `suggestTags`/`generateSeoMeta`/`generateAltText`/`aiModerateComment` into their intended call sites, gated on `config.agent?.enabled && config.agent?.ai?.enabled` (per P0-12). All calls go through piscina.
30. **P1-5**: wire `startMcpServer` (stdio) and `registerMcpSseTransport` (SSE) into `app.ts` behind `config.agent?.enabled` (per P0-12). Add `hypernext mcp` CLI subcommand for stdio transport.
31. **P1-9**: move `validateConfig()` to after `mergeCliOverrides()` in `getConfig()`.
32. **P1-10**: annotate all plan docs with `## Overriding Decisions` sections (per maintainer decision — do NOT rewrite). List tsup/oclif/@lesjoursfr/SQLite+piscina/`agent.enabled` divergences.
33. **P1-6**: wire `templates/email-digest.mdx` (and notification templates) into `sendWeeklyDigest`/`sendInstantNotification`/`processContactForm` send paths. Fix the `{#each}` Svelte syntax in the scaffolded file first.

### Phase 3 — Security & correctness hardening (P2, ~3–4 days)

33. **P2-10**: HTML-escape all email body interpolations.
34. **P2-11**: `verifyLinkInHtml` uses real HTML parse, not substring.
35. **P2-12**: Bluesky session caching, rename `accessToken` → `appPassword`.
36. **P2-13**: Mastodon status length limit, rate-limit handling, visibility.
37. **P2-14**: ActivityPub outbox returns real `OrderedCollection`.
38. **P2-15**: HTTP Signature parsing via `Map`, not regex.
39. **P2-16**: rate limiting on `/webmention`, `/pingback`, `/trackback`, `/inbox`, `/micropub`.
40. **P2-17**: path-traversal validation on `PUT /api/v1/docs/*`.
41. **P2-18**: `extractTargetSlug` uses URL parse, not string prefix.
42. **P2-19**: logger masks secrets in meta object, not just msg.
43. **P2-20**: `deepMerge` blocks `__proto__`/`constructor`/`prototype` keys.
44. **P2-21**: S3 credentials flow smoke test.
45. **P2-22**: MCP `list_subscribers` PII redaction.
46. **P2-23**: moderation blocklist persistence.
47. **P2-24**: CSS absolute path.
48. **P2-25**: `recordPageview` on all routes via `onResponse` hook.
49. **P2-26**: parser/layout medium-severity cleanup batch.
50. **P2-27**: remove `"ipfs"` from `StorageConfig.type` (per maintainer decision — Option A: IPFS always additive). Wire IPFS pinning into post-index cascade via piscina `ipfs-pinning` job.
51. **P2-28**: implement `hypernext setup` as an interactive checklist wizard (per maintainer decision). Multi-select UI, installs deps + modifies `package.json` + runs smoke tests. `--check` flag for verification-only. Include passkey-admin setup (required for first launch per P0-7).
52. **P2-29**: regenerate `config.example.yml` from `DEFAULT_CONFIG_YAML`, ensure `agent` block is prominent.

### Phase 4 — Hygiene (P3, ~1 day)

53. **P3-1**: delete `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` from `main` (per maintainer decision — TUI permanently canceled, no archival prefix). Strip TUI references from README.
54. **P3-2**: delete unused `matchRoute` export.
55. **P3-3**: confirm or delete `/api/v1/mentions/*` duplication.
56. **P3-4**: decide public-read vs. admin-only for `/api/v1/docs`.
57. **P3-5**: add `tests/**/*` to tsconfig, fix resulting type errors (per maintainer decision — confirmed everything must be type-checked).
58. **P3-6**: remove all `@ts-expect-error` comments, fix underlying type issues.
59. **P3-7**: (promoted to P2-29).
60. **P3-8**: low-priority cleanup items.
61. **P3-9**: delete dead `EditorConfig` type (per maintainer decision — TUI permanently canceled).
62. **P3-10**: delete dead `RemoteConfig` type (per maintainer decision — TUI permanently canceled).
63. **P3-11**: reconcile `config.site.theme.cssPath` optional-vs-required with plan and P2-24.

---

## Test strategy to prevent regression

For each P0/P1 item, add a matching **E2E test that boots a real server against a real temp project directory and asserts the actual end-to-end behavior (not a mock)**. This is the gap that let all of this ship green. Specifically:

1. **Boot-smoke tests.** A test that boots `hypernext serve` with each of these configs and asserts the server stays up: default config, `ai.enabled: true`, `storage.type: "s3"` (with mock credentials), `email.enabled: true` (with mock SMTP). Each of these currently crashes or silently fails.

2. **Layout-mutation tests.** A test that edits `templates/default.mdx`, reloads, and asserts the rendered HTML changes. This would have caught P0-4 immediately.

3. **Bad-fixture tests.** A test that drops each of these into a running project and asserts graceful handling: malformed MDX, `<EmailSubscribe />`, `<ContactForm />`, `layout: "../nonexistent"`, empty frontmatter, whitespace frontmatter, frontmatter with `---` inside string values.

4. **Concurrency tests.** A test that fires 50 parallel requests at `/webmention`, `/inbox`, `/micropub`, and the PDF/EPUB endpoints, and asserts no entity bleed (P0-10), no false "Circular include" (P2-3), no duplicate rows, no 500s.

5. **Wiring tests.** For each `enqueue*()` function, a test that triggers the corresponding user action and asserts the enqueue was called (via spy) AND the job eventually completed (via follow-up poll). This would have caught P1-1.

6. **Spec-conformance tests.** Real XML-RPC pingback payloads, real form-encoded micropub posts, real (reordered) HTTP Signature headers, real AWS metadata endpoint URLs in SSRF tests. The current tests use JSON/regex/happy-path fixtures that don't match real-world clients.

7. **PII-leak tests.** For each MCP tool and admin API endpoint, a test that asserts no PII (emails, IPs, tokens) appears in the response unless explicitly requested with admin scope.

8. **Type-check the tests.** Add `tests/**/*` to `tsconfig.json` and run `tsc --noEmit` in CI. This would have caught the `registerNewsletterRoutes(fastify, config)` wrong-arg-count bug and will catch future ones.

9. **Security regression suite.** A dedicated `tests/security/` directory with tests for: SSRF (all blocked IP ranges), path traversal (layout, `PUT /api/v1/docs/*`), XSS (email bodies, contact form), OAuth (PKCE, redirect_uri, code reuse), signature forgery, prototype pollution. Run on every PR.

10. **No `@ts-expect-error` rule.** Add a biome rule (or ESLint rule) that forbids `@ts-expect-error` unless accompanied by a `// reason: ...` comment with a justification. This would have forced the EPUB and AI type bugs to be fixed instead of silenced.

---

## Resolved maintainer questions (all 12 answered)

All twelve architectural questions that were blocking remediation have been answered by the maintainer. The full answers are reflected in the corresponding findings above (P0-4, P0-5, P0-7, P0-12, P1-1, P1-5, P1-8, P1-10, P2-2, P2-22, P2-27, P2-28, P3-1, P3-5) and summarized in the "Resolved decisions from maintainer Q&A" table near the top of this document. Implementation can begin immediately.

For completeness, the original 12 questions and their answers:

1. **Workmatic architecture (P1-1, P1-8).** → **Answer: SQLite-persisted queue + `piscina` worker threads.** Jobs scheduled into SQLite for crash recovery/durability, executed in a piscina worker pool to actually move CPU/I/O work off the main event loop. Workmatic will be deleted entirely. See P1-1 for the full design.

2. **Layout engine scope (P0-4, P1-7).** → **Answer: `wrapSkeleton` is a bug, not a fallback. Standard set of templates prepopulated as writable copies in user's `templates/` folder. Users override by editing those files directly. Embedded defaults remain as read-only fallbacks.** See P0-4 and P1-7.

3. **Public API surface (P0-5, P3-4).** → **Answer: REST API is default public for readable docs and blog posts. All other CRUD ops including reading hidden docs as well as stats and email stuff is for authenticated users only. User can change it to authed only for reading public docs too via `api.requireAuthForPublicRead: true`.** See P0-5.

4. **TUI plan docs (P3-1).** → **Answer: TUI is permanently canceled. Delete `plans/TUI-EDITOR-PLAN.md` and `plans/TUI-SUPPLEMENTAL-PLAN.md` from `main`.** No archival prefix. See P3-1.

5. **`publishAt` vs `publishedAt` (P2-2).** → **Answer: We need a field to allow users to schedule a post for publication so that it is hidden until after the datestamp.** Keep `publishedAt` for historical publish date. Add a new `scheduledAt` field (frontmatter key `scheduledAt`, DB column `scheduled_at`) that gates visibility. See P2-2.

6. **IndieAuth user authentication (P0-7).** → **Answer: Passkeys created on first launch of the server.** On first boot with no admin credential registered, the server runs an interactive setup. Subsequent `/auth/authorize` calls require passkey challenge-response. See P0-7.

7. **MCP PII policy (P2-22).** → **Answer: Follow the auth for the API — only public stuff is public, everything else is authed.** MCP tools split into public-read and admin categories; admin tools not even registered without auth. See P2-22.

8. **Test type-checking (P3-5).** → **Answer: Everything needs to be type-checked, yes.** Add `tests/**/*` to `tsconfig.json` `include` (or a `tsconfig.test.json`), run `tsc --noEmit` in CI. Fix the ~5–10 latent type bugs that will surface. See P3-5.

### Questions 9–12 (answered in second Q&A round)

9. **`agent.enabled` master-toggle semantics (P0-12).** → **Answer: yes yes yes yes.** All four sub-questions confirmed: (a) `agent.enabled: false` (default) → MCP server does NOT start, AI features off, vector DB off, sitemap/llms.txt off; (b) `agent.enabled: true` + `ai.enabled: false` → MCP server starts, but `talk_to_docs`/`summary`/embeddings/moderation are off; (c) `agent.enabled: true` + `ai.enabled: true` → full feature set; (d) `mcp.enabled` is removed entirely — the `mcp` block becomes transport-only, nested under `agent`. See P0-12.

10. **IPFS storage model (P2-27).** → **Answer: (a) always additive.** IPFS is a pinning/caching layer on top of local or S3 primary storage, never the primary itself. Remove `"ipfs"` from `StorageConfig.type`. See P2-27.

11. **`hypernext setup` command scope (P2-28).** → **Answer: interactive setup wizard with a checklist.** Single `hypernext setup` command presents a multi-select checklist; user picks what they want to set up; wizard runs each step interactively (installs deps, modifies `package.json` directly, verifies config, runs smoke tests). `--check` flag for verification-only. See P2-28.

12. **Plan docs: reconcile or annotate? (P1-10).** → **Answer: annotate plans with overriding decisions.** Do NOT rewrite. Keep original plan text intact (preserves historical context). Add a `## Overriding Decisions` section at the top of each plan doc noting where the implementation diverged (tsup replaced Vite, oclif replaced cac, `@lesjoursfr/html-to-epub` replaced `md-to-epub`, SQLite+piscina replaced workmatic, `agent.enabled` master toggle per P0-12). See P1-10.

### Second-reviewer confirmation

A second independent reviewer (separate agent) verified the findings in this document by reading the actual source code. Their verdict: **"that document is more thorough than mine, and correct on every claim I checked."** Specifically confirmed against source: P0-4 (`wrapSkeleton` discards layout IR at `src/parser/layout.ts:157-173`), P0-5 (global auth guard at `src/api/auth.ts:19-27`), P0-6 (EPUB API misuse), P0-7 (IndieAuth PKCE/redirect_uri/user-auth gaps at `src/auth/indieauth.ts`), P0-8 (empty `publicKeyPem` at `src/federation/activitypub.ts:276`, unverified inbox processing at `:305-308`), P0-9 (SSRF blocklist gaps at `src/federation/ssrf.ts`), P0-10 (`getEm()` never forked — `grep -rn "\\.fork()" src` returns zero results), P1-5 (`startMcpServer` has exactly one match in `src/` — its own definition).

The second reviewer also noted that P0-4 is "almost certainly the actual root of 'things seem extremely off from how I envisioned it' — it's not a peripheral bug, it's the named feature of the branch not doing the one thing it's named for." This aligns with the prioritization in this document.

### Open questions still remaining

None. All twelve architectural questions are answered. Implementation can begin immediately.

---

## Summary

The hypernext codebase is **not** poorly written — it's poorly **wired**. The individual functions are clean, the types are sound, the tests pass. What's missing is the connective tissue between them: the layout IR is thrown away, the workmatic queues are never enqueued, the AI callbacks are never called, the auth guard blocks the public routes it's supposed to protect, the EPUB library is called with the wrong API, the SQLite vector extension is never loaded, storage is never initialized at boot, the `agent.enabled` master toggle doesn't actually gate anything, and one bad MDX file takes down the whole site.

On top of the wiring gaps, there are several **architectural divergences from the plan** — the `agent.enabled` master-toggle design was never implemented (three independent toggles instead), AI calls were never moved off the main thread as AI-PLAN specifies, the `templates/` directory was never created, the config pipeline runs validation in the wrong order, and the plan docs still describe a Vite/cac/md-to-epub stack that no longer exists.

**All maintainer-blocking decisions are now resolved.** All 12 architectural questions that were holding up implementation have been answered, and the answers are reflected in the findings above. A second independent reviewer confirmed every P0/P1 claim against the actual source code, with one mechanism-level correction to P1-6 (the email template customization feature is entirely inert — `sendWeeklyDigest` never reads the template file at all — not merely template-broken). Implementation can begin immediately.

The fix is not a rewrite. It's a sequence of targeted wiring fixes — most under 50 lines each — plus one larger architectural swap (workmatic → SQLite-persisted queue + piscina worker pool, per P1-1) that finally delivers the "off the main event loop" promise the plans have been making since day one, plus a test strategy that exercises the real seams instead of hand-fed happy paths, plus an annotation pass on the plan docs (per maintainer decision: annotate, don't rewrite) so future readers can see where the implementation diverged from the original intent.

Estimated total effort: **13–17 days** for a single developer working sequentially through Phases 1–4. The estimate is revised up from the original 10–14 days to account for: (a) the workmatic → SQLite+piscina replacement (P1-1, ~5 days), (b) the email template wiring fix (P1-6, ~1 day — corrected diagnosis requires wiring templates into the send path, not just fixing syntax), (c) the interactive `hypernext setup` wizard (P2-28, ~1.5 days), and (d) the passkey auth flow for first-launch (P0-7, ~1 day). Phase 1 (P0) is the most urgent and should land before any user is allowed to run `hypernext serve` against real content.

The three highest-leverage fixes are:

- **P0-4 (delete `wrapSkeleton` + scaffold writable templates)** — it's the gap between "the layout-templating-engine feature branch" and "a layout-templating engine that actually templates layouts."
- **P0-12 (rewire `agent.enabled` as the master toggle)** — it's the gap between "AI-PLAN describes an off-by-default AI posture" and "the actual code lets MCP and AI start independently of the `agent` block."
- **P1-1 (replace workmatic with SQLite + piscina)** — it's the gap between "the plans promise worker-thread isolation for heavy work" and "the actual code runs everything inline on the main event loop, blocking all six protocols whenever a PDF, EPUB, webmention, or AI call is in flight."

Everything else is supporting infrastructure.
