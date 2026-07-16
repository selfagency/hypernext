# Hypernext Agent Guide

This document provides essential guidelines, architectural rules, and workflows for AI agents (Claude, Cursor, Copilot, etc.) contributing to the Hypernext project.

## 1. Project Overview

Hypernext is a TypeScript-based, multi-protocol MDX document server and IndieWeb publishing engine. It transforms MDX files into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It is designed to run on a $5 VPS as a single [Node.js](https://Node.js) process with zero external daemons (using SQLite and in-memory caching).

## 2. Critical Architectural Constraints (DO NOT VIOLATE)

1. **NO ARBITRARY JS EXECUTION IN MDX:** Never compile MDX to React/JS. Use `remark-parse` + `remark-mdx` to generate an Abstract Syntax Tree (AST), walk it, reject unknown JSX elements, and transform it into a standard Intermediate Representation (IR).
2. **SINGLE PROCESS / NO EXTERNAL DAEMONS:** Do not introduce Redis, Elasticsearch, or separate worker processes. All persistence and full-text search MUST use `better-sqlite3`. All caching MUST use in-memory `lru-cache`.
3. **SECURITY BOUNDARY:** The MDX parser MUST hard-fail if it encounters a JSX component not in the explicit allowlist (`NavMenu`, `RecentPosts`, `TableOfContents`, `Include`, `Mermaid`, `Latex`, `AuthorBio`, `Enclosure`).
4. **PROTOCOL ADHERENCE:** Strictly follow protocol specs (e.g., Spartan request format is `{host} {path} {content-length}\r\n`, NEX is headerless, Gemtext flattens nested lists).

## 3. Tech Stack & Tooling

- **Language:** TypeScript (strict mode)
- **Package Manager:** `pnpm` (MUST use `pnpm-lock.yaml`)
- **Bundler:** `Vite` (Node SSR build)
- **Linter/Formatter:** `Ultracite` with `Biome`. Run `pnpm check` and `pnpm fix`.
- **Testing:** `Vitest`. Run `pnpm test:run`.
- **Git Hooks:** `Husky` + `lint-staged` run automatically on commit.
- **CLI Framework:** `cac` for command-line flags.
- **HTTP Framework:** `Fastify`

## 4. Directory Structure

```
src/
├── bin.ts               # CLI entry point (cac, zero-config scaffolding)
├── app.ts               # Server bootstrap
├── config.ts            # Loads config.yml, merges CLI flags
├── storage/             # LocalFS and S3 read/write providers
├── parser/              # remark-mdx -> AST -> IR pipeline
│   ├── pipeline.ts      # Main parsing logic & component security checks
│   └── components.ts    # Built-in component AST resolvers
├── database/            # better-sqlite3 wrapper (FTS5, taxonomies, syndication)
├── indexer/             # FS/S3 watcher -> triggers parser -> updates SQLite
├── api/                 # Fastify REST API & PDF/EPUB generation routes
├── auth/                # IndieAuth (OAuth2) logic
├── micropub/            # Inbound authoring endpoint (JSON -> MDX)
├── bridge/              # POSSE syndication (Mastodon, Bluesky)
├── renderers/           # IR -> HTML (Microformats2), Gemtext, Gopher, RSS
├── servers/             # TCP/TLS socket implementations for smolnet protocols
├── federation/          # ActivityPub Outbox, standard.site push
└── mcp/                 # Model Context Protocol server tools
```

## 5. Key Implementation Patterns

### Parsing Pipeline (AST -> IR)

When modifying `src/parser/pipeline.ts`:

1. Parse MDX using `unified` and `remark-mdx`.
2. Walk the AST using `unist-util-visit`.
3. If an `mdxJsxFlowElement` is encountered, check it against the allowed components array. If not found, throw an Error.
4. If a component is allowed (e.g., `<RecentPosts />`), query SQLite for the data, generate standard mdast nodes (lists, links), and replace the component node in the tree.
5. Transform the final, merged AST into the Hypernext IR (a JSON object representation).

### Adding a New Protocol Renderer

1. Create `src/renderers/newproto.ts`.
2. Export a function `renderNewProto(ir: IRNode): string | Buffer`.
3. Map IR nodes (Headings, Paragraphs, Lists) to the protocol's specific format.
4. Register the renderer in the cache layer.

### Adding a New Server

1. Create `src/servers/newproto.ts`.
2. Use Node's `net` (TCP) or `tls` (TLS) module.
3. Parse the raw incoming request according to the protocol spec.
4. Resolve the request to a slug.
5. Fetch the document IR from the indexer/cache.
6. Call the renderer and write the response to the socket.

## 6. Testing Guidelines

- Write tests for all new parser logic, ensuring no code execution occurs.
- Test protocol servers by spinning up the TCP/TLS socket locally in a `beforeAll` hook and connecting to it.
- Test API routes using Fastify's `inject` method.
- Ensure CLI flag overrides correctly merge with `config.yml` defaults.

## 7. Commit & CI/CD Rules

- Commits will fail if `pnpm lint` or `pnpm test:run` fail (enforced by Husky).
- Do not bypass git hooks with `--no-verify`.
- GitHub Actions (`.github/workflows/ci.yml`) runs linting, tests, and builds on all PRs. Tags (`v*`) trigger NPM and Docker Hub publishing.

## 8. Agent Tasks Checklist

When asked to implement a feature, ensure you:

- [ ] Check if the feature violates the "No JS Execution" or "Single Process" constraints.
- [ ] Add the feature to the correct architectural layer (e.g., parsing logic goes in `parser/`, not `servers/`).
- [ ] Write unit tests in `tests/` using Vitest.
- [ ] Run `pnpm lint` and `pnpm format` before declaring the task complete.
- [ ] Update `config.yml` schema if new configuration options are introduced.
