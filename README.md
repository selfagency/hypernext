# Hypernext

**Multi-Protocol Markdown Document Server and IndieWeb Publishing Engine**

Hypernext transforms MD and MDX files into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It runs as a single Node.js process with zero external daemons — designed for a $5 VPS.

[![CI](https://github.com/selfagency/hypernext/actions/workflows/ci.yml/badge.svg)](https://github.com/selfagency/hypernext/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/selfagency/hypernext/graph/badge.svg?token=UcOYEBhPq8)](https://codecov.io/gh/selfagency/hypernext) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/910ea1fed1da4965abed0b211350e95b)](https://app.codacy.com/gh/selfagency/hypernext/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade) [![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=selfagency_hypernext&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=selfagency_hypernext)

## Quick Start

### npx (no install)

```bash
npx @selfagency/hypernext
```

This starts all protocol servers with sensible defaults, creating a `content/` directory and `config.yml` on first run.

### Docker

```bash
docker run -p 8080:8080 -v ./content:/app/content -v ./config.yml:/app/config.yml ghcr.io/selfagency/hypernext
```

See [Deployment](docs/deployment.md) for Docker Compose variants (S3, env file).

### Install Globally

```bash
npm install -g @selfagency/hypernext
# or
pnpm add -g @selfagency/hypernext

hypernext
```

## Writing Content

Create MDX files in `content/blog/` or `content/library/`:

```mdx
---
title: My First Post
date: 2026-07-16
type: post
tags: [hypernext, indieweb]
---

<NavMenu />

This is my first post using Hypernext.

<AuthorBio />
```

Built-in components (resolved at the parser level into the IR that all renderers consume): `NavMenu`, `RecentPosts`, `TableOfContents`, `Include`, `Mermaid`, `Latex`, `AuthorBio`, `Enclosure`, `Breadcrumbs`, `Search`, `TagCloud`, `PostNav`, `RelatedPosts`, `SyndicationLinks`, `Figure`, `Comments`, `Archive`, `PostList`, `IPFSLink`, `EmailSubscribe`, `ContactForm`.

*Layout templates (wrapping documents in `<NavMenu />`, `<slot />`, etc.) are planned but not yet implemented — all renderers will consume the same common MDX templates translated into their protocol format.*

## CLI Commands

```bash
hypernext                    # Start all protocol servers
hypernext push               # Push content to production server
hypernext sync               # Two-way sync with production
hypernext ingest <url>       # Fetch a URL and convert to MDX
```

### URL Ingestion

```bash
hypernext ingest https://example.com/article --collection blog --filename my-article
```

With `--downloadMedia`, images are downloaded and stored locally:

```bash
hypernext ingest https://example.com/article --download-media
```

## Local Development

### Prerequisites

- Node.js 24+
- pnpm 10+

### Setup

```bash
git clone https://github.com/selfagency/hypernext.git
cd hypernext
pnpm install
```

### Run Dev Server

```bash
pnpm dev
```

Starts all protocol servers with hot-reload via `tsx watch`.

### Run TUI Editor in Dev Mode

```bash
pnpm dev:editor
```

### Run Tests

```bash
pnpm test:run       # Unit tests (50 files, 271 tests)
pnpm test:e2e       # E2E tests (14 files, browser + protocol)
pnpm check          # Lint + typecheck
pnpm build          # Production build via tsup
```

## Configuration

All configuration lives in `config.yml`:

```yaml
site:
  canonicalBase: "https://example.com"
  meta:
    title: "My Site"
    description: "A Hypernext-powered site"
    lang: "en"

protocols:
  http:
    enabled: true
    port: 8080
  gemini:
    enabled: false
    port: 1965
  gopher:
    enabled: false
    port: 70

storage:
  type: local
  local:
    path: "./content"
```

See [Customization](docs/customization.md) for the full config reference.

## Supported Protocols

| Protocol | Port | Description |
|----------|------|-------------|
| HTTP     | 8080 | Web interface with Microformats2 |
| Gemini   | 1965 | TLS-encrypted Gemini protocol |
| Gopher   | 70   | Classic Gopher protocol |
| Spartan  | 300  | Lightweight Spartan protocol |
| NEX      | 1900 | Headerless raw protocol |
| Text     | 5011 | Simple text with status codes |
| Finger   | 79   | Author info protocol |

## Features

- **Multi-Protocol** — Serve content over 7 protocols simultaneously
- **MDX Powered** — Write in Markdown with JSX components
- **IndieWeb Ready** — IndieAuth, Micropub, WebFinger, ActivityPub
- **POSSE Syndication** — Auto-publish to Mastodon and Bluesky
- **Full-Text Search** — FTS5-powered search across all documents
- **PDF & EPUB** — Generate downloadable books and documents
- **MCP Server** — Model Context Protocol tools for AI agents
- **IPFS Integration** — Content-addressed pinning and gateway links
- **TUI Editor** — Terminal-based content editor with command palette
- **Email Newsletter** — Subscriptions, digests, and contact forms
- **AI Features** — Semantic search, auto-tagging, alt text generation
- **Comment Moderation** — Spam detection, blocklist, hide/unhide
- **Scheduled Publishing** — Future-dated content with automatic visibility
- **Single Process** — SQLite + in-memory cache, no Redis or Elasticsearch

## Documentation

- [Getting Started](docs/getting-started.md)
- [API Reference](docs/api.md)
- [Customization](docs/customization.md)
- [Protocol Servers](docs/protocols.md)
- [IndieWeb Features](docs/indieweb.md)
- [IPFS Integration](docs/ipfs.md)
- [Comment Moderation](docs/moderation.md)
- [Scheduled Publishing](docs/scheduling.md)
- [POSSE Syndication](docs/syndication.md)
- [Email & Newsletter](docs/email.md)
- [AI Features](docs/ai.md)
- [MCP Tools](docs/mcp.md)
- [TUI Editor](docs/tui.md)
- [Deployment](docs/deployment.md)

## License

GPL-3.0-or-later
