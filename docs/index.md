# Hypernext

**Multi-Protocol MDX Document Server and IndieWeb Publishing Engine**

Hypernext transforms MDX files into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It runs as a single Node.js process with zero external daemons.

## Features

- **Multi-Protocol** — Serve content over HTTP, Gemini, Gopher, Spartan, NEX, Text, and Finger simultaneously
- **MDX Powered** — Write in Markdown with JSX components, parsed into a common IR that all renderers translate to their protocol format
- **IndieWeb Ready** — IndieAuth OAuth2, Micropub, WebFinger, ActivityPub Actor/Outbox
- **POSSE Syndication** — Auto-publish to Mastodon and Bluesky
- **Full-Text Search** — FTS5-powered search across all documents
- **PDF & EPUB** — Generate downloadable books and documents
- **MCP Server** — Model Context Protocol tools for AI agent access
- **IPFS Integration** — Content-addressed pinning and gateway links
- **Email Newsletter** — Subscriptions, digests, and contact forms
- **AI Features** — Semantic search, auto-tagging, alt text generation
- **Comment Moderation** — Spam detection, blocklist, hide/unhide
- **Scheduled Publishing** — Future-dated content with automatic visibility
- **Single Process** — SQLite + in-memory cache, no Redis or Elasticsearch needed

## Documentation

- [Getting Started](getting-started.md) — Installation, configuration, writing content
- [API Reference](api.md) — REST API endpoints
- [Customization](customization.md) — Configuration reference
- [Protocol Servers](protocols.md) — HTTP, Gemini, Gopher, Spartan, NEX, Text, Finger
- [IndieWeb Features](indieweb.md) — IndieAuth, Micropub, WebFinger, ActivityPub
- [IPFS Integration](ipfs.md) — Content pinning and gateway
- [Comment Moderation](moderation.md) — Spam, blocklist, hide/unhide
- [Scheduled Publishing](scheduling.md) — Future-dated content
- [POSSE Syndication](syndication.md) — Mastodon and Bluesky
- [Email & Newsletter](email.md) — Subscriptions, digests, contact forms
- [AI Features](ai.md) — Semantic search, auto-tagging, moderation
- [MCP Tools](mcp.md) — AI agent tool reference
- [Deployment](deployment.md) — Docker Compose, CLI, CI/CD

## Quick Start

```bash
npx hypernext init
cd my-site
npx hypernext
```

## Supported Protocols

| Protocol | Port | Description |
|----------|------|-------------|
| HTTP     | 8080 | Web interface with Microformats2 |
| Gemini   | 1965 | Gemini protocol with TLS |
| Gopher   | 70   | Classic Gopher protocol |
| Spartan  | 300  | Spartan protocol |
| NEX      | 1900 | Headerless raw protocol |
| Text     | 5011 | Text Protocol with status codes |
| Finger   | 79   | Finger protocol for author info |
