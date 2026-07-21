# Config Schema Reference

Pipeline: `loadYAML → envSubst → parse → validate → mergeCliOverrides`

Env var substitution uses `${VAR}` syntax in YAML values.

Required keys (throws at startup if missing):
- `site.canonicalBase`, `site.meta.title`, `storage`, `database`

## Sections

### `site` — Site identity and metadata

```yaml
site:
  canonicalBase: "https://example.com"
  meta:
    title: "My Blog"
    description: "A personal blog."
    lang: "en"
  author:
    name: "Alice"
    email: "alice@example.com"
    url: "https://alice.example.com"
  organization:
    name: "Example Org"
    url: "https://org.example.com"
  pdf:
    enabled: false
  ebooks:
    enabled: false
  theme:
    primaryColor: "#00d4ff"
```

### `storage` — Content storage

```yaml
storage:
  type: "local"               # "local" | "s3" | "ipfs"
  local:
    path: "./content"
  s3:
    bucket: "${S3_BUCKET}"
    region: "${AWS_REGION}"
    accessKeyId: "${AWS_ACCESS_KEY_ID}"
    secretAccessKey: "${AWS_SECRET_ACCESS_KEY}"
  ipfs:
    endpoint: "/ip4/.../tcp/5001"
```

### `database` — SQLite

```yaml
database:
  type: "sqlite"
  path: "${HYPERNEXT_DB_PATH}"   # default: ./hypernext.db
```

### `protocols` — Server protocols

```yaml
protocols:
  http:
    enabled: true
    port: 8080
  gemini:
    enabled: true
    port: 1965
    certPath: "/path/to/cert.pem"
    keyPath: "/path/to/key.pem"
  gopher:
    enabled: true
    port: 70
  spartan:
    enabled: true
    port: 300
  nex:
    enabled: true
    port: 1900
  text:
    enabled: true
    port: 5011
  finger:
    enabled: true
    port: 79
```

CLI: `--no-gemini` / `--no-gopher` to disable at runtime.

### `api` — REST API

```yaml
api:
  enabled: true
  cors:
    origin: "*"
```

### `auth` — IndieAuth OAuth2

```yaml
auth:
  enabled: true
  tokenEndpoint: "https://example.com/auth/token"
  authorizationEndpoint: "https://example.com/auth/authorize"
  clientId: "https://example.com"
  me: "https://example.com"
```

### `micropub` — Inbound authoring

```yaml
micropub:
  enabled: false
```

### `syndication` — POSSE (Mastodon + Bluesky)

```yaml
syndication:
  mastodon:
    enabled: false
    server: "https://mastodon.social"
    accessToken: "${MASTODON_TOKEN}"
  bluesky:
    enabled: false
    identifier: "user.bsky.social"
    password: "${BLUESKY_APP_PASSWORD}"
```

All syndication goes through the `outbound-syndication` workmatic queue.

### `federation` — ActivityPub

```yaml
federation:
  enabled: true
  domain: "example.com"
```

### `comments` — Webmention + moderation

```yaml
comments:
  webmention: true
  pingback: true
  trackback: true
  aggregation: true
  akismet:
    apiKey: "${AKISMET_KEY}"
    blogUrl: "https://example.com"
    enabled: false
  blocklist:
    handles: []
    domains: []
    ips: []
```

Blocklist types: `handle` (partial author name, case-insensitive), `domain` (substring on source host), `ip` (exact match).

### `mcp` — MCP Server (AI agent tools)

```yaml
mcp:
  enabled: false              # master toggle
  transport: "stdio"           # "stdio" | "sse"
  port: 3100                   # SSE port when transport is "sse"
```

### `agent` — AI-readiness features

```yaml
agent:
  enabled: false              # master toggle
  markdownNegotiation: true   # Accept: text/markdown
  llmsTxt: true               # GET /llms.txt
  sitemap: true               # GET /sitemap.xml
  linkHeaders: true
  hiddenAgentDirective: true  # <!-- --> directive in HTML
  viewTransitions: true
  wellKnown:
    apiCatalog: true
    agentSkills: true
    mcpServerCard: true
    webBotAuth: true
    webmcp: true
```

robotsTxt is guarded by `agent.enabled` (only served when agent features are enabled).

### `robotsTxt` — Robots exclusion rules

```yaml
robotsTxt:
  enabled: false
  aiCrawlers: "block"         # "block" | "allow" | "selective"
  rules: []
```

### `securityTxt` — Security.txt (always served when configured)

```yaml
securityTxt:
  enabled: true
  contact: ["mailto:security@example.com"]
  expires: "2027-01-01T00:00:00Z"
```

Requires at least one contact and an expires date.

### `contentSignals` — Content metadata HTTP headers

```yaml
contentSignals:
  enabled: true
  aiTrain: false
  search: true
  aiInput: false
```

### `ipfs` — IPFS node connection

```yaml
ipfs:
  enabled: false
  gatewayUrl: "https://ipfs.io/ipfs"
  rpcUrl: "http://127.0.0.1:5001/api/v0"
  pinning: true
  cacheHtml: true
```

### `ai` — AI features (semantic search, RAG, auto-tagging)

```yaml
ai:
  enabled: false
  apiUrl: "http://localhost:11434/v1"   # OpenAI-compatible
  apiKey: ""
  models:
    embedding: "nomic-embed-text"
    utility: "llama3"
    vision: "llava"
    reasoning: "deepseek-r1"
  vectorDimensions: 768
  features:
    semanticSearch: true
    autoAltText: false
    autoTagging: false
    seo: false
    moderation: false
```

### `email` — SMTP + newsletter

```yaml
email:
  smtp:
    host: "smtp.example.com"
    port: 587
    secure: true
    user: "${SMTP_USER}"
    pass: "${SMTP_PASS}"
  from: "noreply@example.com"
  newsletter:
    enabled: false
    digestSchedule: "0 8 * * 1"     # cron: weekly Monday 8am
    instant: true
  contact:
    enabled: false
    captcha: true
    akismet: true
```

### `collections` — Content type routing

```yaml
collections:
  blog:
    directory: "blog/"
    type: "post"
    syndicate: true
    rss: true
  library:
    directory: "library/"
    type: "page"
```

### `taxonomies` — Taxonomies

```yaml
taxonomies:
  tags:
    label: "Tags"
  categories:
    label: "Categories"
```

### `remote` — Production server for push/sync

```yaml
remote:
  url: "https://production.example.com"
  token: "${REMOTE_TOKEN}"
```

### `logging` — Logging configuration

```yaml
logging:
  level: "info"                # "debug" | "info" | "warn" | "error"
  format: "pretty"             # "json" | "pretty"
  file: "hypernext.log"
  maskSecrets: true
```

### `telemetry` — OpenTelemetry

```yaml
telemetry:
  enabled: false
  otlpEndpoint: "http://localhost:4318"
  exportIntervalMs: 10000
```
