---
name: hypernext
description: Configuration, deployment, and management for the Hypernext multi-protocol MDX document server. All renderers (HTTP, Gemini, Gopher, Spartan, NEX, Text, Finger) consume the same MDX content parsed into a common Intermediate Representation (IR) and translate it into each protocol's format. Use when the user asks to: (1) set up or modify config.yml, (2) deploy with Docker Compose or Node.js, (3) configure HTTP/Gemini/Gopher/Spartan/NEX/Text/Finger protocol servers, (4) set up local/S3/IPFS storage, (5) connect a database, (6) configure the REST API, (7) enable POSSE syndication to Mastodon or Bluesky, (8) set up ActivityPub federation, (9) configure the MCP server for AI agent access, (10) enable agent-readiness features (llms.txt, sitemap, robots.txt), (11) set up email newsletter and SMTP, (12) configure comment moderation and blocklists, (13) enable AI features (semantic search, RAG, auto-tagging), (14) configure IPFS pinning, (15) set up remote push/sync, (16) manage content collections and taxonomies, (17) set up OpenTelemetry and logging, (18) configure IndieAuth and Micropub, (19) schedule content publishing, or (20) configure security.txt and content signals.
---

# Hypernext

## Config Pipeline

```
config.yml → env var substitution → parse → validate → CLI override
```

- `${VAR}` in YAML resolves from environment. Missing vars → empty string.
- CLI flags (`--port`, `--no-gemini`) override config.
- Config rejects on missing required keys: `site.canonicalBase`, `site.meta.title`, `storage`, `database`.

## Quick Start

```bash
npx hypernext                # scaffolding
cd my-site
npx hypernext                # starts all protocol servers
```

## Common Tasks

### Deploy with Docker

```yaml
# docker-compose.yml — local storage
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
      - "1965:1965"
    volumes:
      - ./config.yml:/app/config.yml:ro
      - ./content:/app/content
    restart: unless-stopped
```

For S3: set `storage.type: "s3"` in config and pass `AWS_*` env vars.
For IPFS: set `ipfs.enabled: true` and point to a running kubo RPC endpoint.

See [deploy.md](references/deploy.md) for S3, IPFS, .env, and Coolify variants.

### Deploy bare-metal

```bash
pnpm build
NODE_ENV=production node dist/bin.js
```

Content at `./content`, DB at `./hypernext.db`. Override DB with `HYPERNEXT_DB_PATH`.

### Configure S3 storage

```yaml
storage:
  type: "s3"
  s3:
    bucket: "${S3_BUCKET}"
    region: "${AWS_REGION}"
    accessKeyId: "${AWS_ACCESS_KEY_ID}"
    secretAccessKey: "${AWS_SECRET_ACCESS_KEY}"
```

### Enable/disable a protocol

```yaml
protocols:
  gopher:
    enabled: false
```

Or `hypernext --no-gopher`. Gemini requires TLS cert+key paths:

```yaml
protocols:
  gemini:
    certPath: "/path/to/cert.pem"
    keyPath: "/path/to/key.pem"
```

### Set up syndication

```yaml
syndication:
  mastodon:
    enabled: true
    server: "https://mastodon.social"
    accessToken: "${MASTODON_TOKEN}"
  bluesky:
    enabled: true
    identifier: "user.bsky.social"
    password: "${BLUESKY_APP_PASSWORD}"
```

All syndication routes through the `outbound-syndication` workmatic queue.

### Enable MCP server

```yaml
mcp:
  enabled: true
  transport: "stdio"       # or "sse" with port: 3100
```

### Enable AI features

```yaml
ai:
  enabled: true
  apiUrl: "http://localhost:11434/v1"    # defaults to Ollama
  features:
    semanticSearch: true
    autoTagging: true
```

### Comment moderation blocklist

```yaml
comments:
  blocklist:
    handles: ["spammer"]
    domains: ["spam.example.com"]
    ips: ["10.0.0.1"]
```

Three independent list types. Also supports Akismet for automated spam detection.

### IPFS integration

```yaml
ipfs:
  enabled: true
  gatewayUrl: "https://ipfs.io/ipfs"
  rpcUrl: "http://127.0.0.1:5001/api/v0"
```

Requires an external kubo IPFS node. Features: CID pinning, HTML caching via CIDs, `<IPFSLink />` component, API endpoints, MCP tools.

### Remote push/sync

```yaml
remote:
  url: "https://production.example.com"
  token: "${REMOTE_TOKEN}"
```

```bash
hypernext push               # one-way upload
hypernext sync               # two-way sync
```

### Ingest a URL as MDX

```bash
hypernext ingest https://example.com/article
hypernext ingest https://example.com/article --collection blog --filename my-post
```

## Reference Files

- [Config schema](references/config.md) — Full YAML schema for all sections
- [Deployment](references/deploy.md) — Docker, bare-metal, Coolify, env vars, CI/CD
- [CLI reference](references/cli.md) — Commands, flags, npm scripts
