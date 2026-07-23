# Hypernext Agent Guide

This document provides essential guidelines, architectural rules, and workflows for AI agents (Claude, Cursor, Copilot, etc.) contributing to the Hypernext project.

## 1. Project Overview

Hypernext is a TypeScript-based, multi-protocol Markdown document server and IndieWeb publishing engine. It transforms Markdown files (`.md` and `.mdx`) into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It is designed to run on a $5 VPS as a single [Node.js](https://Node.js) process with zero external daemons (using SQLite and in-memory caching).

**Current Status (as of July 2026):** Post-audit remediation phase. Foundation is solid (76 test files, 300+ tests, ~80% coverage). Significant dead-wiring issues identified across the background job system, AI feature pipeline, and renderer error handling. See §9 Known Issues for the full catalog. All core features demand verification in live dev/preview environment before sign-off.

## 2. CRITICAL AGENT CONSTRAINTS (DO NOT VIOLATE)

### 2.1 Quality Enforcement (Non-Negotiable)

- **NEVER use `--no-verify`** on git commits. All pre-commit hooks MUST execute and pass.
- **NEVER skip type checking.** Run `pnpm lint` and verify zero TypeScript errors before claiming a task complete.
- **NEVER skip linting.** All code MUST pass Biome checks. Run `pnpm check` and fix all issues.
- **NEVER skip testing.** All new code MUST have corresponding unit and/or integration tests.
- **NEVER ship code that doesn't run.** Always verify the application starts cleanly: `pnpm build && pnpm dev` or `pnpm test:run`.

### 2.2 Test-Driven Development (Mandatory)

All new code development MUST be test-driven:

1. Write tests first (or in parallel with implementation) before implementation is complete
2. Unit tests for logic, helpers, utilities, transformations
3. Integration tests for multi-module flows (parser → indexer → cache, API routes, protocol servers, etc.)
4. Every new feature must have >= 1 test demonstrating its behavior
5. Run `pnpm test:run` and verify 100% pass rate before declaring the feature complete

### 2.3 Live Verification (No Exceptions)

Every new feature MUST be demonstrated working in the live application BEFORE considering it finished:

- **Dev environment:** `pnpm dev` with manual verification (browser, terminal, or protocol client)
- **Preview/staging environment:** E2E test verification or manual smoke test
- **No compromises:** If you cannot show it working in a running instance, the feature is not finished

### 2.4 Clarification Requirement

ALWAYS clarify the user's intent BEFORE proceeding if feature requests or repair tasks are ambiguous:

- Ask: "Do you want feature X to also handle Y?" if scope is unclear
- Ask: "Is this a regression fix or a new enhancement?" if the request mixes concerns
- Ask: "Should this apply to all content types or just blog posts?" if context is missing
- Proceed only after receiving explicit direction

## 3. Architectural Constraints (DO NOT VIOLATE)

1. **NO ARBITRARY JS EXECUTION IN MDX:** Never compile MDX to React/JS. Use `remark-parse` + `remark-mdx` to generate an Abstract Syntax Tree (AST), walk it, reject unknown JSX elements, and transform it into a standard Intermediate Representation (IR).
2. **SINGLE PROCESS / NO EXTERNAL DAEMONS:** Do not introduce Redis, Elasticsearch, or separate worker processes. All persistence and full-text search MUST use `better-sqlite3`. All caching MUST use in-memory `lru-cache`.
3. **SECURITY BOUNDARY:** The MDX parser MUST hard-fail if it encounters a JSX component not in the explicit allowlist (`NavMenu`, `RecentPosts`, `TableOfContents`, `Include`, `Mermaid`, `Latex`, `AuthorBio`, `Enclosure`).
4. **PROTOCOL ADHERENCE:** Strictly follow protocol specs (e.g., Spartan request format is `{host} {path} {content-length}\\r\\n`, NEX is headerless, Gemtext flattens nested lists).

## 4. Tech Stack & Tooling

- **Language:** TypeScript (strict mode, v6.0.3+)
- **Runtime:** Node.js 24+ (target ES2025)
- **Package Manager:** `pnpm` (v10.33.4+, MUST use `pnpm-lock.yaml`)
- **Bundler:** `tsup` (Node.js SSR bundles)
- **Linter/Formatter:** `Biome` (v2.4.16) + `Ultracite` (v7.8.3)
  - Run `pnpm lint` to check, `pnpm format` to auto-fix
  - Run `pnpm check` and `pnpm fix` (Ultracite wrapper) for comprehensive validation
- **Testing:** `Vitest` (v4.1.10, 50 test files, 271+ tests, ~80% coverage)
  - Run `pnpm test` for watch mode
  - Run `pnpm test:run` for single run
  - Run `pnpm test:coverage` to generate coverage reports
  - Run `pnpm test:e2e` for browser + protocol E2E tests
- **Git Hooks:** `Husky` (v9.1.7) + `lint-staged` (v17.0.8) enforce lint/format/typecheck on commit
- **CLI Framework:** `oclif` (v4.12.0) for command-line structure
- **HTTP Framework:** `Fastify` (v5.3.2) with 20+ plugins
- **Database:** `MikroORM` + SQLite (better-sqlite3 v12.11.1) with sqlite-vec for embeddings
- **Markdown:** `unified` + `remark` + `mdast-util-mdx` for AST → IR pipeline
- **Federation:** `@atproto/api` + `ActivityPub` outbox + `standard.site` integration

## 5. Directory Structure (Current)

```
src/
├── bin.ts               # CLI entry point (oclif)
├── app.ts               # Fastify server bootstrap
├── config.ts            # YAML config loader + CLI flag merging
├── init.ts              # Initialization flow (first-run setup)
├── router.ts            # Central route dispatcher (HTTP + protocol routing)
├── nav.ts               # Navigation graph builder
├── cache.ts             # LRU cache layer
│
├── parser/              # remark-mdx AST → IR pipeline
│   ├── pipeline.ts      # Main parsing + component security
│   ├── components.ts    # Built-in component resolvers
│   └── ...
│
├── database/            # MikroORM entities + better-sqlite3 wrapper
│   ├── index.ts
│   ├── mikro-orm.config.ts
│   └── entities/
│       ├── doc-meta.ts
│       ├── term.ts (taxonomy)
│       ├── subscriber.ts
│       ├── oauth-token.ts
│       ├── mention.ts (webmentions)
│       ├── pageview.ts (analytics)
│       ├── syndication.ts (POSSE)
│       └── term-relationship.ts
│
├── storage/             # LocalFS and S3 providers
│   ├── index.ts
│   ├── local.ts
│   └── s3.ts
│
├── indexer/             # File watcher → parser → cache/DB
│   └── index.ts
│
├── servers/             # TCP/TLS socket implementations
│   ├── gemini.ts
│   ├── gopher.ts
│   ├── spartan.ts
│   ├── nex.ts
│   ├── text.ts
│   ├── finger.ts
│   └── ...
│
├── renderers/           # IR → format (HTML, Gemtext, RSS, JSON-LD, etc.)
│   ├── html.ts
│   ├── gemtext.ts
│   ├── gopher.ts
│   ├── rss.ts
│   ├── json-ld.ts
│   ├── markdown.ts
│   ├── sitemap.ts
│   ├── robots-txt.ts
│   ├── llms-txt.ts
│   ├── security-txt.ts
│   ├── agent-readiness.ts
│   ├── content-signals.ts
│   ├── head.ts
│   ├── link-headers.ts
│   └── markdown-negotiation.ts
│
├── api/                 # Fastify REST API routes
│   ├── routes.ts
│   ├── pdf.ts (PDF generation via md-to-pdf)
│   ├── epub.ts (EPUB generation via @lesjoursfr/html-to-epub)
│   └── ...
│
├── auth/                # IndieAuth + OAuth
│   └── indieauth.ts
│
├── micropub/            # Inbound authoring (JSON POST → MDX)
│   └── index.ts
│
├── bridge/              # POSSE syndication
│   ├── mastodon.ts
│   └── bluesky.ts
│
├── federation/          # ActivityPub outbox + standard.site
│   ├── index.ts
│   ├── outbox.ts
│   └── ...
│
├── ingest/              # URL → HTML → MDX conversion
│   └── index.ts
│
├── sync/                # Push/pull to production
│   └── index.ts
│
├── jobs/                # Background jobs (PDF, AI embeddings, IPFS)
│   ├── pdf.ts
│   ├── ai-embeddings.ts
│   ├── ipfs-pinning.ts
│   └── ...
│
├── analytics/           # Pageview tracking
│   └── index.ts
│
├── mcp/                 # Model Context Protocol server
│   ├── index.ts
│   └── tools.ts
│
├── types/               # Shared TypeScript interfaces
│   ├── config.ts
│   ├── ir.ts (Intermediate Representation)
│   └── ...
│
├── utils/               # Helpers (string, date, hash, URL normalization)
├── constants/           # Allowlists, defaults, error codes
├── lib/                 # Vendor code wrappers
├── commands/            # oclif command handlers
└── ...
```

## 6. Key Implementation Patterns

### 6.1 Parsing Pipeline (MDX AST → IR)

When modifying `src/parser/pipeline.ts`:

1. Parse MDX using `unified` + `remark-mdx`
2. Walk the AST using `unist-util-visit`
3. If an `mdxJsxFlowElement` is encountered, check it against `ALLOWED_COMPONENTS` (defined in `src/parser/components.ts`)
4. If not in allowlist, throw an Error immediately — hard-fail to prevent security issues
5. If allowed (e.g., `<RecentPosts />`), query the database for data, generate standard mdast nodes, replace the component node
6. Transform the final merged AST into the Hypernext IR (JSON object with `type`, `children`, `meta`, etc.)

**Critical:** A single malformed MDX file can crash the entire site. All parsing errors must be caught, logged, and gracefully degraded (render fallback or skip document).

### 6.2 Adding a New Protocol Renderer

1. Create `src/renderers/newproto.ts`
2. Export function `renderNewProto(ir: IRNode): string | Buffer`
3. Map IR node types (Heading, Paragraph, List, Link) to protocol format
4. Register renderer in the cache layer (`src/cache.ts`)
5. **Test:** Create test file `tests/renderers/newproto.test.ts` with sample IR nodes
6. **Verify:** Run the protocol server locally and manually test

### 6.3 Adding a New Protocol Server

1. Create `src/servers/newproto.ts`
2. Use Node.js `net` (TCP) or `tls` (TLS) module
3. Parse raw incoming request per protocol spec
4. Resolve request to a slug (URL path normalization)
5. Fetch document IR from cache/indexer
6. Call appropriate renderer and write response to socket
7. **Test:** E2E test in `tests/e2e/servers/newproto.e2e.ts` with local socket connection
8. **Verify:** Connect from CLI/Telnet and verify output

### 6.4 Adding a New Built-in Component

1. Add component to allowlist in `src/constants/` or `src/parser/components.ts`
2. Implement resolver function in `src/parser/components.ts` that:
   - Accepts component props (parsed from JSX attributes)
   - Queries database or computes data
   - Returns standard mdast nodes (paragraph, list, heading, etc.)
3. Update `ALLOWED_COMPONENTS` array so parser recognizes it
4. **Test:** Unit test with mock data in `tests/parser/components.test.ts`
5. **Integration test:** E2E test with actual MDX file in `tests/e2e/parser.e2e.ts`

### 6.5 Background Jobs (PDF, AI Embeddings, IPFS)

Defined in `src/jobs/` but currently **not wired into the main indexing flow**:

- `pdf.ts`: Generates PDF from document IR (uses `md-to-pdf`)
- `ai-embeddings.ts`: Computes semantic embeddings (uses OpenAI + sqlite-vec)
- `ipfs-pinning.ts`: Pins to IPFS (uses kubo-rpc-client)

**CRITICAL ISSUE:** These jobs exist but are not called from the indexer or API. They are implemented but untested in the live system. Any modification MUST:

1. Verify the job actually executes when triggered
2. Write or update tests to ensure it runs end-to-end
3. Demonstrate it working in `pnpm dev`
4. Update indexer/API to properly invoke the job (if missing)

## 7. Testing Guidelines (TDD-Driven)

### 7.1 Test Structure

- **Unit tests:** Logic, parsers, renderers, utilities in `tests/unit/`
- **Integration tests:** Multi-module flows (parser → cache, API routes, DB queries) in `tests/integration/`
- **E2E tests:** Full app lifecycle, browser + protocol servers in `tests/e2e/`

### 7.2 What to Test

- Parser: Allowlist checks, AST → IR transformation, error handling on malformed MDX
- Renderers: IR → output format for each protocol
- API routes: Request validation, auth checks, response headers, status codes
- Database: Entity persistence, FTS5 queries, transaction rollback
- Servers: TCP/TLS socket communication, request parsing, response formatting
- CLI: Flag merging with config.yml, command execution

### 7.3 Test Execution

```bash
pnpm test          # Watch mode (on file changes)
pnpm test:run      # Single run (CI mode)
pnpm test:coverage # Coverage report (target ≥80%)
pnpm test:e2e      # E2E tests (requires Docker for some)
```

### 7.4 Coverage Expectations

- Current: ~80% (lines, statements, branches)
- Target: ≥80% for all new code
- Exception: E2E tests are expensive; prioritize unit + integration for fast feedback

## 8. Development Workflow

### 8.1 Before Committing

```bash
# 1. Test
pnpm test:run

# 2. Lint & typecheck
pnpm lint
pnpm format

# 3. Verify app runs
pnpm build
pnpm dev &
# Manual smoke test...
kill %1
```

### 8.2 Commit

```bash
# Husky + lint-staged will run Biome checks and formatter automatically
git add -A
git commit -m "feat: descriptive message"
# DO NOT USE --no-verify
```

### 8.3 Push & CI

- GitHub Actions (`.github/workflows/ci.yml`) runs lint, tests, build on all PRs
- Tags (`v*`) trigger NPM and Docker publishing
- Ensure all checks pass before merging to main

## 9. Known Issues & Remediation Status

### P0 (Critical) — Silent Failures, No Error Signal

#### P0.1 — `config` dropped on every `indexDocument` call
`scheduleAiFeatures()` (auto-tagging, SEO meta generation) is gated on a `config` parameter passed to `indexDocument()`. Every call site omits this parameter — AI features have never fired in production.

- Status: Identified (4 call sites, tracked in `plans/dead-wiring-remediation.md`)
- Fix: Pass `config` at all call sites
- Tests: Verify AI features execute on document index

#### P0.2 — Async indexing chain is orphaned
`enqueueIndexing` has zero callers outside `src/jobs/schedule.ts`. The entire chain (`processIndexing` → `ai-embedding` + `ipfs-pinning`) never executes. `sqlite-vec` embeddings table initialized but permanently empty.

- Status: Identified
- Fix: Wire `enqueueIndexing` into `reindexAll`/`watchStorage` OR inline AI/IPFS into `indexDocument`
- Tests: E2E test verifying embedding is stored after indexing

#### P0.3 — `parseToIR` unguarded in RSS and HTTP renderers
`parseToIR` throws on malformed MDX. The indexer wraps it in try-catch. The RSS renderer and HTTP server do not. One bad stored doc breaks the RSS feed for all subscribers.

- Status: Identified (2 call sites in `src/renderers/rss.ts` and `src/servers/http.ts`)
- Fix: Add try-catch around `parseToIR` in both locations
- Tests: Seed a malformed document and verify feed survives

### P1 (High) — Orphaned Infrastructure

#### P1.1 — PDF/EPUB job processors are dead code
`pdf-generation.ts` and `epub-generation.ts` are real implementations but nothing enqueues them. The sync API routes (`GET *.pdf`, `GET *.epub`) handle these inline and work correctly.

- Status: Identified — processor files are unreachable duplicates
- Fix: Delete processors or add enqueue calls at meaningful points
- Tests: Verify sync routes still work after deletion

#### P1.2 — `enqueuePdfGeneration`, `enqueueEpubGeneration`, `enqueueIpfsPinning` have zero callers
Same root cause as P0.2 — these schedule functions exist but nothing calls them.

- Status: Identified
- Fix: Wire into index pipeline or remove

### P2 (Medium) — Previously Fixed
- **Auth guards blocking public APIs:** Global IndieAuth middleware was blocking newsletter/contact form
  - Status: Fixed (exempted public endpoints)
  - Tests: Verify public routes don't require auth

### P3 (Low)
- **Minor renderer inconsistencies:** Some protocols missing metadata headers
  - Status: Identified in audit
  - Fix: Standardize across all renderers

## 10. Agent Tasks Checklist

When asked to implement a feature or fix an issue, ensure you:

- [ ] Clarify intent with the user (if ambiguous) BEFORE starting
- [ ] Check if feature violates "No JS Execution" or "Single Process" constraints
- [ ] Add feature to correct architectural layer (parser → parsers/, protocol → servers/)
- [ ] **Write tests FIRST or in parallel** (TDD) — unit + integration
- [ ] Implement the feature
- [ ] Run `pnpm test:run` — all tests pass
- [ ] Run `pnpm lint` — zero TypeScript errors
- [ ] Run `pnpm format` — no formatting issues
- [ ] Run `pnpm build && pnpm dev` — app starts cleanly, smoke test manually
- [ ] Update `config.yml` schema if new options are introduced
- [ ] Verify feature works in live dev environment (browser, CLI, protocol client)
- [ ] **DO NOT use `--no-verify` on commits**
- [ ] Mark task complete only after live verification

## 11. Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

### Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

### Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

#### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

#### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

#### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

#### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

#### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

#### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

#### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

---

### Testing Standards

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting
- **All new code must have corresponding tests**

### When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Performance and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm dlx ultracite fix` before committing to ensure compliance.
