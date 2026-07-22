# Hypernext Agent Guide

This document provides essential guidelines, architectural rules, and workflows for AI agents (Claude, Cursor, Copilot, etc.) contributing to the Hypernext project.

## 1. Project Overview

Hypernext is a TypeScript-based, multi-protocol Markdown document server and IndieWeb publishing engine. It transforms Markdown files (`.md` and `.mdx`) into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It is designed to run on a $5 VPS as a single [Node.js](https://Node.js) process with zero external daemons (using SQLite and in-memory caching).

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


# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm dlx ultracite fix` before committing to ensure compliance.
