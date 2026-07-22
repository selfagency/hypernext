<!-- Context: project-intelligence/technical | Priority: critical | Version: 1.0 | Updated: 2026-07-21 -->

# Technical Domain

**Purpose**: Tech stack, architecture patterns, naming conventions, and code standards for Hypernext — a multi-protocol Markdown document server and IndieWeb publishing engine.

**Last Updated**: 2026-07-21

## Quick Reference
**Update Triggers**: Tech stack changes | Bundler migration | New protocol/server | Auth architecture change
**Audience**: Developers, AI agents contributing to Hypernext

## Primary Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript strict (`tsc --noEmit`) | Type safety throughout |
| Runtime | Node.js 24 (ESM) | Latest LTS, native ESM |
| Bundler | tsup (esbuild-based) | Replaced Vite — handles Node externals, SSR not needed |
| CLI | oclif | Replaced cac — framework for commands |
| HTTP | Fastify + `@fastify/*` plugins | Performance, schema validation, hooks |
| ORM | MikroORM v7 SQLite (`@mikro-orm/sqlite`) | Entity manager, `defineEntity` functional pattern |
| Database | better-sqlite3 + FTS5 | Single-process persistence, full-text search via raw SQL |
| Cache | `lru-cache` (in-memory) | No Redis — $5 VPS constraint |
| Lint/Format | Biome + Ultracite preset | Zero-config, enforces kebab-case files |
| Test | Vitest | Unit + E2E, coverage via `vitest run --coverage` |
| CI | GitHub Actions | `pnpm test:coverage` → `pnpm test:e2e` → `pnpm dlx ultracite check` |

## Code Patterns

### API Routes (Fastify)
```typescript
// Public route with auth guard exemption
fastify.get("/api/v1/docs/:slug", async (req, reply) => {
  const em = getEm().fork(); // always fork per request
  const slug = normalizeSlug((req.params as { slug: string }).slug);
  if (slug.includes("..")) return reply.status(400).send({ error: "Invalid slug" });
  const doc = await em.findOne(DocMeta, { slug, hidden: false });
  if (!doc) return reply.status(404).send({ error: "Not found" });
  reply.send({ data: doc });
});
```

### Parser Pipeline (MDX → AST → IR)
```typescript
// 1. Parse MDX via unified + remark-mdx
// 2. Walk AST via unist-util-visit
// 3. Check mdxJsxFlowElement against ALLOWED_COMPONENTS whitelist
// 4. Resolve allowed components (query SQLite, generate mdast nodes)
// 5. Transform merged AST → Hypernext IR (JSON object)
// 6. Render IR → target format (HTML/Gemtext/Gopher/RSS)
const ALLOWED_COMPONENTS = new Set(["NavMenu", "RecentPosts", "TableOfContents", "Include", "Mermaid", "Latex", "AuthorBio", "Enclosure", "Comments", "EmailSubscribe", "ContactForm"]);
```

### Entity Definition (MikroORM defineEntity)
```typescript
import { defineEntity, Property, PrimaryKey } from "@mikro-orm/sqlite";

export const DocMeta = defineEntity({
  tableName: "docs_meta",
  fields: {
    slug: { type: "string", primary: true },
    title: { type: "string" },
    type: { type: "string", default: "post" },
    content: { type: "string", hidden: true },
    publishedAt: { type: "string", nullable: true },
    scheduledAt: { type: "string", nullable: true },
    hidden: { type: "boolean", default: false },
    order: { type: "integer", nullable: true },
  },
});
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case (Biome-enforced) | `deep-merge.ts`, `doc-meta.ts` |
| Entity classes | PascalCase | `DocMeta`, `Syndication`, `OAuthToken` |
| Functions/Variables | camelCase | `reindexAll()`, `getStorage()` |
| Database columns | snake_case | `published_at`, `scheduled_at`, `spam_status` |
| Storage providers | PascalCase + Provider suffix | `LocalStorageProvider`, `S3StorageProvider` |
| IR node types | camelCase strings | `"heading"`, `"paragraph"`, `"component"` |

## Code Standards
- **TypeScript strict mode** — no `any`, prefer `unknown`
- **No `@ts-expect-error`** without a `// reason:` comment
- **Always fork EntityManager** per request: `const em = getEm().fork()` — never share the singleton across concurrent handlers
- **`const` by default**, `let` only when reassignment needed
- **Error isolation in batch loops** — each iteration wrapped in try/catch so one failure doesn't abort the batch (P0-1 pattern)
- **Config paths resolved against project root** at load time, not `process.cwd()` (P0-2 pattern)
- **`agent.enabled` is the master toggle** for all AI/MCP/agent-readiness features — not independent flags
- **Functional over class-based** — prefer exported functions, avoid classes
- **Async/await** over raw promises
- **Early returns** over nested conditionals for error cases
- **Remove `console.log`/`debugger`** from production code
- **Optional chaining `?.`** and nullish coalescing `??` for safe property access
- **No barrel files** (index.ts re-exports) — import directly

## Security Requirements

| Category | Rule | Enforced |
|----------|------|----------|
| SSRF | Block private IP ranges + resolve DNS before fetch | `src/federation/ssrf.ts` |
| Path traversal | Reject `..` in slugs + resolve against base path | Storage, API routes, layout resolver |
| Auth | IndieAuth w/ PKCE + redirect_uri whitelist | `src/auth/indieauth.ts` |
| API auth | Public-read default for docs, authed for admin | P0-5 pattern in `src/api/auth.ts` |
| Prototype pollution | `deepMerge` blocks `__proto__`/`constructor`/`prototype` | `src/utils/deep-merge.ts` |
| XSS | HTML-escape all email body interpolations | `src/federation/email-tasks.ts` |
| Webmention | `verifyLinkInHtml` parses real HTML, not substring | `src/federation/inbound.ts` |
| MCP PII | Admin tools (subscribers, stats) require auth | MCP tool registration |
| Rate limiting | `@fastify/rate-limit` on inbound endpoints | Federation/micropub routes |

## 📂 Codebase References
**Implementation**: `src/` — modular subsystems under `storage/`, `parser/`, `database/`, `indexer/`, `api/`, `auth/`, `micropub/`, `bridge/`, `renderers/`, `servers/`, `federation/`, `mcp/`
**Config**: `config.yml`, `tsconfig.json`, `biome.jsonc`, `vitest.config.ts`, `tsup.config.ts`
**Entities**: `src/database/entities/` — DocMeta, Term, TermRelationship, Syndication, OAuthToken, Mention
**Plans**: `plans/` — IMPLEMENTATION-PLAN.md, SUPPLEMENTARY-PLAN.md, AI-PLAN.md, EMAIL-PLAN.md, IPFS-PLAN.md, E2E-PLAN.md, REMEDIATION-PLAN.md

## Related Files
- `business-domain.md` — Project value proposition, target users, roadmap
- `plans/REMEDIATION-PLAN.md` — Full code review + prioritized fix order (P0→P1→P2→P3)
