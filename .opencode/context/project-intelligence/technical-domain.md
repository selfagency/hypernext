<!-- Context: project-intelligence/technical | Priority: critical | Version: 1.0 | Updated: 2026-07-16 -->

# Technical Domain

**Purpose**: Tech stack, architecture, and development patterns for Hypernext.
**Last Updated**: 2026-07-16

## Quick Reference

**Update Triggers**: Stack changes | New protocols | Parser changes | Security boundary updates
**Audience**: Developers, AI agents

## Primary Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Language | TypeScript | 6.0+ | Strict mode, single codebase for Node SSR |
| Runtime | Node.js | 22+ | Single process, zero external daemons |
| Bundler | Vite | 8+ | SSR build, fast dev loop |
| CLI | cac | 6.7+ | Lightweight command parsing |
| HTTP | Fastify | 5+ | Plugin-based API server |
| Database | better-sqlite3 + MikroORM | 12+ / 7+ | FTS5 search, single-file persistence |
| Cache | lru-cache | 11+ | In-memory only, no Redis |
| MDX Parser | remark-parse + remark-mdx | 15+ / 3+ | AST-only, no JS execution |
| Package Manager | pnpm | 10+ | Workspace/catalog support |
| Lint/Format | Ultracite / Biome | 7.8+ / 2.4+ | Zero-config strict quality gates |
| Testing | Vitest | 4+ | Vite-native test runner |

## Architecture

**Type**: Single-process Node server
**Pattern**: Protocol adapters → IR → renderers
**Core Flow**:
1. Storage provider (Local/S3) reads `.mdx`
2. Parser converts MDX to AST, rejects unknown JSX
3. AST becomes Intermediate Representation (IR)
4. Component resolvers hydrate allowed components
5. Renderers emit HTML/Gemtext/Gopher/RSS/etc.
6. TCP/TLS servers serve each protocol

## Code Patterns

### API Endpoint

```typescript
fastify.get("/api/v1/docs", async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const limit = Math.min(Number(query.limit) || 20, 100);
  const offset = Number(query.offset) || 0;

  const em = getEm();
  const qb = em.createQueryBuilder("DocMeta", "m");
  qb.select(["m.slug", "m.title", "m.description", "m.date", "m.type"])
    .orderBy({ date: "DESC", id: "DESC" })
    .limit(limit)
    .offset(offset);

  const docs = await qb.execute();
  reply.send({ docs, limit, offset });
});
```

### Component Resolver

```typescript
export const COMPONENT_RESOLVERS: Record<string, ComponentResolver> = {
  async RecentPosts(props) {
    const limit = Number(props.limit) || 5;
    const slugs = (await listDocSlugs()).slice(0, limit);
    const items: IrNode[] = [];
    for (const slug of slugs) {
      const doc = await getDocBySlug(slug);
      items.push(
        listItemNode([linkNode(`/${slug}`, [textNode(doc?.title ?? slug)])])
      );
    }
    return [listNode(false, items)];
  },
};
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `deep-merge.ts`, `doc-meta.ts` |
| Classes | PascalCase | `LocalStorageProvider`, `DocMeta` |
| Functions | camelCase verb phrases | `parseToIR`, `renderHTML` |
| Constants | UPPER_SNAKE_CASE | `ALLOWED_COMPONENTS` |
| Database tables | snake_case | `docs_meta`, `term_relationships` |
| Entities | PascalCase in `src/database/entities/` | `Term`, `OAuthToken` |

## Code Standards

- TypeScript strict mode enabled
- Explicit function parameter and return types
- Prefer `const`; use `let` only for reassignment
- Pure functions for parsers/renderers; side effects isolated in servers
- Early returns over deep nesting
- Validate at boundaries (config, storage slugs, API query params)
- No `any`; use `unknown` when type is genuinely unknown
- Module-level regex/const values declared before imports where required
- Run `pnpm check` and `pnpm fix` before commit

## Security Requirements

- **No arbitrary JS execution**: MDX is parsed to AST only; unknown JSX components hard-fail
- **Allowed components only**: `NavMenu`, `RecentPosts`, `TableOfContents`, `Include`, `Mermaid`, `Latex`, `AuthorBio`, `Enclosure`, `Breadcrumbs`, `Search`, `TagCloud`, `PostNav`, `RelatedPosts`, `SyndicationLinks`, `Figure`, `Comments`, `slot`
- **Path traversal blocked**: Storage normalizes slugs and rejects `..` sequences
- **Parameterized queries**: Database queries use bound parameters
- **Input validation**: Config validates required keys; API validates limits/offsets
- **No external daemons**: SQLite + in-memory cache only

## 📂 Codebase References

**CLI entry**: `src/bin.ts` — cac CLI, server bootstrap
**Config pipeline**: `src/config.ts` — loadYAML → envSubst → validate → mergeCliOverrides
**Parser security**: `src/parser/pipeline.ts` — `ALLOWED_COMPONENTS` allowlist, AST walk
**Component resolvers**: `src/parser/components.ts` — built-in MDX component implementations
**Storage providers**: `src/storage/local.ts`, `src/storage/s3.ts` — path normalization
**Database layer**: `src/database/index.ts` — MikroORM + raw FTS5 SQL
**Server bootstrap**: `src/app.ts` — protocol server startup
**Agent guide**: `AGENTS.md` — full architectural constraints and patterns

## Related Files

- `business-domain.md` — Why this technical foundation exists
