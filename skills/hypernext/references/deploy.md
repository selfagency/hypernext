# Deployment Reference

## Docker Compose

All variants use the built-from-source Dockerfile. Expose ports for active protocols only.

### Local storage (default)

```yaml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
      - "1965:1965"
      - "70:70"
    volumes:
      - ./config.yml:/app/config.yml:ro
      - ./content:/app/content
      - ./hypernext.db:/app/hypernext.db
    restart: unless-stopped
```

### S3 storage

```yaml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./config.yml:/app/config.yml:ro
      - ./hypernext.db:/app/hypernext.db
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=us-east-1
      - S3_BUCKET=my-bucket
    restart: unless-stopped
```

Config for S3:

```yaml
storage:
  type: "s3"
  s3:
    bucket: "${S3_BUCKET}"
    region: "${AWS_REGION}"
    accessKeyId: "${AWS_ACCESS_KEY_ID}"
    secretAccessKey: "${AWS_SECRET_ACCESS_KEY}"
```

### With .env file

Add `env_file: .env` to any compose variant for env var injection.

## Node.js Production (no Docker)

```bash
pnpm build              # tsup → dist/
NODE_ENV=production pnpm start   # node dist/bin.js
```

Content lives at `./content` by default. DB at `./hypernext.db`.

## Coolify / PaaS

1. Set build command: `pnpm build`
2. Set start command: `node dist/bin.js`
3. Mount `config.yml` or bake into image at `./config.yml`
4. Set env vars from `references/env.md` as needed
5. Health check: `GET /health` on HTTP port
6. Expose protocol ports as needed

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `HYPERNEXT_DB_PATH` | `./hypernext.db` | SQLite database path |
| `AWS_ACCESS_KEY_ID` | — | S3 storage |
| `AWS_SECRET_ACCESS_KEY` | — | S3 storage |
| `AWS_REGION` | — | S3 bucket region |
| `S3_BUCKET` | — | S3 bucket name |
| `REMOTE_TOKEN` | — | Auth for push/sync to production |
| `MASTODON_TOKEN` | — | Mastodon API access token |
| `BLUESKY_APP_PASSWORD` | — | Bluesky app password |
| `SMTP_USER` | — | SMTP auth |
| `SMTP_PASS` | — | SMTP auth |

## IPFS

Hypernext connects to an external IPFS node via RPC (no embedded node).

```yaml
ipfs:
  enabled: true
  gatewayUrl: "https://ipfs.io/ipfs"
  rpcUrl: "http://127.0.0.1:5001/api/v0"
```

Features: content-addressed pinning, HTML caching via CIDs, `<IPFSLink />` component, MCP tools, API endpoints at `GET /api/v1/docs/:slug/ipfs` and `POST /api/v1/docs/:slug/pin`.

## CI/CD

```yaml
# .github/workflows/ci.yml — runs on push/PR to main/develop
# Jobs: pnpm check → pnpm test:run → pnpm test:e2e → pnpm build
```

Docker images build on `v*` tags: `ghcr.io/selfagency/hypernext:version`, `:major.minor`, `:latest`. Multi-platform (linux/amd64 + linux/arm64). NPM publish also on `v*` tags.

## Protocol Ports

| Protocol | Default Port | Notes |
|---|---|---|
| HTTP | 8080 | Web UI, REST API, RSS |
| Gemini | 1965 | TLS, requires cert+key |
| Gopher | 70 | Classic |
| Spartan | 300 | Minimal |
| NEX | 1900 | Headerless |
| Text | 5011 | Status codes |
| Finger | 79 | Author info |
