# Manual Smoke Test Plan

**Branch:** `feature/layout-templating-engine` (PR #1) → `main`
**Prep:** `pnpm build && pnpm dev`

---

## Phase 0: Prerequisites

```bash
# Terminal 1 — Start the server
cd hypernext
pnpm build && tsx src/bin.ts serve --http --gemini --gopher --spartan --nex --finger --text --mcp --port 8080
# If running against a test project:
tsx src/bin.ts serve --http --project ../hypertest --port 8080
```

Test project needs:
- `config.yml` with `site.canonicalBase`, `storage.local.path`, `database.path`
- At least 3 content files: a blog post, a page, and one with malformed MDX
- `templates/` directory with layout templates

---

## Phase 1: Core HTTP

### 1.1 Home Page
```bash
curl -s http://localhost:8080/ | head -20
```
- [ ] Returns 200
- [ ] Returns valid HTML with `<head>` + `<body>`
- [ ] Title matches config.site.meta.title

### 1.2 Document Page
```bash
curl -s http://localhost:8080/blog/my-post | head -20
```
- [ ] Returns 200
- [ ] Title in `<h1>` matches document frontmatter
- [ ] Content rendered as HTML

### 1.3 Collection Root
```bash
curl -s http://localhost:8080/blog/ | head -20
```
- [ ] Returns 200
- [ ] Lists posts

### 1.4 404
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/nonexistent
```
- [ ] Returns 404

### 1.5 Private Document
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/private-doc
```
- [ ] Returns 404 (private docs hidden from public)

### 1.6 RSS Feed
```bash
curl -s http://localhost:8080/rss.xml | head -30
```
- [ ] Returns 200
- [ ] Content-Type is `application/rss+xml`
- [ ] Contains `<item>` elements for blog posts
- [ ] Malformed MDX document is SKIPPED (not breaking the feed)

### 1.7 Sitemap
```bash
curl -s http://localhost:8080/sitemap.xml | head -20
```
- [ ] Returns 200 (if agent features enabled)
- [ ] Valid XML with `<url>` entries

### 1.8 robots.txt
```bash
curl -s http://localhost:8080/robots.txt
```
- [ ] Returns 200
- [ ] Contains `Disallow:` rules

### 1.9 llms.txt
```bash
curl -s http://localhost:8080/llms.txt
```
- [ ] Returns 200 (if agent features enabled)

### 1.10 security.txt
```bash
curl -s http://localhost:8080/.well-known/security.txt
curl -s http://localhost:8080/security.txt
```
- [ ] Returns 200 (if configured with contact + expires)

### 1.11 Markdown Content Negotiation
```bash
curl -s -H "Accept: text/markdown" http://localhost:8080/blog/my-post
```
- [ ] Returns 200
- [ ] Content-Type is `text/markdown`
- [ ] Body is raw markdown (not HTML)

### 1.12 Content-Signal Header
```bash
curl -s -I http://localhost:8080/blog/my-post 2>&1 | grep -i content-signal
```
- [ ] Header present (if contentSignals.enabled)

### 1.13 Health Check
```bash
curl -s http://localhost:8080/health
```
- [ ] Returns 200
- [ ] Body: `{"status":"ok"}`

---

## Phase 2: Malformed MDX Resilience

### 2.1 Indexer Handles Malformed Doc
```bash
# Create a doc with invalid MDX (unknown JSX component)
echo '# Bad\n<UnknownComponent />' > ../hypertest/content/bad-doc.mdx
# Wait for watcher, then hit the RSS feed
curl -s http://localhost:8080/rss.xml | head -10
```
- [ ] RSS feed still returns 200 (bad doc skipped)
- [ ] Indexer logged a warning about parse failure

### 2.2 HTTP Server Handles Malformed Doc (Markdown Route)
```bash
curl -s -H "Accept: text/markdown" http://localhost:8080/bad-doc -o /dev/null -w "%{http_code}"
```
- [ ] Returns 500 (graceful error, not crash)

---

## Phase 3: REST API

### 3.1 API Root
```bash
curl -s http://localhost:8080/api/v1/docs | head -30
```
- [ ] Returns 200
- [ ] JSON array of documents

### 3.2 Single Document by Slug
```bash
curl -s http://localhost:8080/api/v1/docs/blog/my-post
```
- [ ] Returns 200
- [ ] JSON with `slug`, `title`, `rawMdx`

### 3.3 PDF Generation (Sync Route)
```bash
curl -s -o /tmp/test.pdf http://localhost:8080/api/v1/docs/blog/my-post.pdf
file /tmp/test.pdf
```
- [ ] File is a valid PDF (starts with `%PDF`)

### 3.4 EPUB Generation (Sync Route)
```bash
curl -s -o /tmp/test.epub http://localhost:8080/api/v1/collections/blog.epub
file /tmp/test.epub
```
- [ ] File is a valid EPUB (ZIP archive with mimetype)

---

## Phase 4: Auth & Micropub

### 4.1 IndieAuth Token Endpoint
```bash
curl -s -X POST http://localhost:8080/auth/token \
  -d "grant_type=authorization_code&code=test&redirect_uri=http://localhost:8080/"
```
- [ ] Returns 200 or 400 with proper error (token flow)

### 4.2 Micropub — Create Post (requires auth)
```bash
JWT=$(curl -s -X POST http://localhost:8080/auth/token ...)
curl -s -X POST http://localhost:8080/micropub \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"type":["h-entry"],"properties":{"name":["Test Post"],"content":["Hello world"]}}'
```
- [ ] Returns 201
- [ ] Location header points to new slug

---

## Phase 5: Comment / Moderation

### 5.1 Webmention Endpoint
```bash
curl -s -X POST http://localhost:8080/webmention \
  -d "source=http://example.com/mention&target=http://localhost:8080/blog/my-post"
```
- [ ] Returns 202 (accepted)

### 5.2 Moderation — List Mentions
```bash
curl -s http://localhost:8080/api/v1/mentions
```
- [ ] Returns 200 with array

### 5.3 Moderation — Update Spam Status
```bash
curl -s -X PATCH http://localhost:8080/api/v1/mentions/<id> \
  -H "Content-Type: application/json" \
  -d '{"spam_status":"spam"}'
```
- [ ] Returns 200

---

## Phase 6: Smolnet Protocols

### 6.1 Gemini
```bash
# Requires openssl s_client or a Gemini client
echo -e "gemini://localhost:1965/\r\n" | openssl s_client -connect localhost:1965 -crlf -quiet 2>/dev/null | head -20
```
- [ ] Returns valid Gemtext (starts with `#` or `20 text/gemini`)
- [ ] Note: requires cert + key in config protocols.gemini

### 6.2 Gopher
```bash
echo -e "/\r\n" | nc -w 5 localhost 70
```
- [ ] Returns Gopher directory listing (lines starting with `i` or `1` or `0`)

### 6.3 Spartan
```bash
echo -e "spartan://localhost:300/\r\n" | nc -w 5 localhost 300
```
- [ ] Returns Spartan response with status code + content

### 6.4 NEX
```bash
echo -e "/\r\n" | nc -w 5 localhost 1900
```
- [ ] Returns content (headerless protocol)

### 6.5 Finger
```bash
echo -e "/\r\n" | nc -w 5 localhost 79
```
- [ ] Returns content

### 6.6 Text Protocol
```bash
echo -e "/\r\n" | nc -w 5 localhost 5011
```
- [ ] Returns plain text content

---

## Phase 7: Federation

### 7.1 WebFinger
```bash
curl -s "http://localhost:8080/.well-known/webfinger?resource=acct:user@localhost:8080"
```
- [ ] Returns 200
- [ ] JSON with `subject` and `links` array

### 7.2 Actor Object
```bash
curl -s -H "Accept: application/activity+json" http://localhost:8080/actor
```
- [ ] Returns 200
- [ ] JSON with `type: "Person"`, `inbox`, `outbox`, `publicKey`

### 7.3 Outbox
```bash
curl -s -H "Accept: application/activity+json" http://localhost:8080/outbox
```
- [ ] Returns 200
- [ ] `type: "OrderedCollection"` with `orderedItems`

---

## Phase 8: Background Jobs & AI

### 8.1 Job Queue Status
```bash
# Check that the worker pool initialized (see server startup logs)
# Look for: no "Worker pool initialization failed" message
```
- [ ] Worker pool started successfully
- [ ] Poll loop is active

### 8.2 AI Feature Scheduling (Auto-Tag)
```bash
# Index a document without tags (via Micropub or file watcher)
# Then check the jobs table:
curl -s http://localhost:8080/api/v1/jobs 2>/dev/null || echo "Check DB directly"
sqlite3 ../hypertest/db/hypernext.db "SELECT type, payload FROM jobs WHERE type='ai-text' LIMIT 5;"
```
- [ ] `ai-text` job enqueued with `op: "suggestTags"`

### 8.3 AI Embedding Job
```bash
sqlite3 ../hypertest/db/hypernext.db "SELECT type, payload FROM jobs WHERE type='ai-embedding' LIMIT 5;"
```
- [ ] `ai-embedding` job enqueued after document index

### 8.4 IPFS Pin Job
```bash
sqlite3 ../hypertest/db/hypernext.db "SELECT type, payload FROM jobs WHERE type='ipfs-pinning' LIMIT 5;"
```
- [ ] `ipfs-pinning` job enqueued (if ipfs.enabled in config)

---

## Phase 9: MCP Server

### 9.1 MCP Tool Listing
```bash
# Using MCP CLI inspector or direct connection
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | nc -w 5 localhost 3100
```
- [ ] Returns list of available MCP tools

---

## Phase 10: CLI Commands

### 10.1 Help
```bash
pnpm hypernext --help
pnpm hypernext serve --help
pnpm hypernext init --help
pnpm hypernext sync --help
pnpm hypernext push --help
pnpm hypernext ingest --help
pnpm hypernext token --help
```
- [ ] All commands show usage information

### 10.2 Init
```bash
mkdir -p /tmp/hypernext-test && cd /tmp/hypernext-test
pnpm hypernext init --path .
```
- [ ] Creates config.yml, content/, templates/, db/

### 10.3 Serve
```bash
pnpm hypernext serve --project /tmp/hypernext-test --http --port 8081 &
sleep 3
curl -s http://localhost:8081/ | head -5
kill %
```
- [ ] Server starts and responds to requests

---

## Edge Cases

### E1. Empty Content Directory
```bash
# Start server with empty content dir
curl -s http://localhost:8080/
```
- [ ] Returns home page (auto-generated from config)
- [ ] Lists no posts

### E2. Rapid File Changes (Watcher Throttling)
```bash
# Save the same file rapidly several times
for i in 1 2 3 4 5; do
  echo "# Update $i" > ../hypertest/content/blog/rapid-test.mdx
  sleep 0.1
done
sleep 2
curl -s http://localhost:8080/blog/rapid-test
```
- [ ] Last write wins — document is indexed with "# Update 5"
- [ ] No crash or double-index errors

### E3. Concurrent Protocol Access
```bash
# Hit HTTP, Gopher, and Finger simultaneously
curl -s http://localhost:8080/ & 
echo -e "/\r\n" | nc -w 3 localhost 70 &
echo -e "/\r\n" | nc -w 3 localhost 79 &
wait
```
- [ ] All three respond correctly (no cross-protocol interference)

### E4. Graceful Shutdown
```bash
# Hit the server with SIGTERM (from the start script)
kill -TERM $SERVER_PID
```
- [ ] Server logs "Shutting down gracefully..."
- [ ] All file descriptors closed
- [ ] Database connection closed cleanly
