# CLI Reference

## Commands

```bash
# Start all protocol servers (default)
hypernext

# One-way upload to production
hypernext push

# Two-way sync with production
hypernext sync

# Fetch a URL and convert to MDX
hypernext ingest <url>
hypernext ingest <url> --collection blog --filename my-post
```

## Global Flags

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `config.yml` | Config file path |
| `--port <port>` | 8080 | Override HTTP server port |
| `--no-gemini` | — | Disable Gemini server |
| `--no-gopher` | — | Disable Gopher server |

## NPM Scripts

```bash
pnpm dev              # tsx watch — hot-reload dev server
pnpm build            # tsup — production bundle
pnpm start            # node dist/bin.js
pnpm test:run         # Unit tests (Vitest)
pnpm test:e2e         # E2E tests (Vitest + Playwright)
pnpm lint             # Biome check
pnpm fix              # Biome auto-fix
pnpm check            # Ultracite check
pnpm docs             # VitePress dev server
pnpm docs:build       # Build docs site
```
