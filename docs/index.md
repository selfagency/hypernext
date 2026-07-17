# Hypernext

**Multi-Protocol MDX Document Server and IndieWeb Publishing Engine**

Hypernext transforms MDX files into a unified interface accessible via HTTP, REST API, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB. It runs as a single Node.js process with zero external daemons.

## Features

- **Multi-Protocol** — Serve content over HTTP, Gemini, Gopher, Spartan, NEX, Text, and Finger simultaneously
- **MDX Powered** — Write in Markdown with JSX components, rendered to every protocol
- **IndieWeb Ready** — IndieAuth OAuth2, Micropub, WebFinger, ActivityPub Actor/Outbox
- **POSSE Syndication** — Auto-publish to Mastodon and Bluesky
- **Full-Text Search** — FTS5-powered search across all documents
- **PDF & EPUB** — Generate downloadable books and documents
- **MCP Server** — Model Context Protocol tools for AI agent access
- **Single Process** — SQLite + in-memory cache, no Redis or Elasticsearch needed

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
