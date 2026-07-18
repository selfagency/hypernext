# MCP Server

Hypernext implements the Model Context Protocol (MCP), allowing AI agents to interact with your content programmatically.

## Configuration

```yaml
mcp:
  enabled: true
  transport: stdio
```

Two transport modes:
- `stdio` — Standard I/O (for local agent integration)
- `sse` — Server-Sent Events over HTTP (for remote access)

## Tools

### Document Management

| Tool | Description |
|------|-------------|
| `search_docs(query, limit?, type?)` | Full-text search across documents |
| `list_docs(collection?, tag?)` | List documents by collection or tag |
| `read_doc(slug)` | Read document frontmatter and content |
| `create_doc(slug, title, content, type?, tags?)` | Create a new MDX document |
| `update_doc(slug, content)` | Update document body content |
| `delete_doc(slug)` | Delete a document |

### Ingestion

| Tool | Description |
|------|-------------|
| `ingest_url(url, collection, filename)` | Fetch a URL and convert to MDX |

### Media

| Tool | Description |
|------|-------------|
| `list_media()` | List assets in the assets directory |

### Syndication & Sync

| Tool | Description |
|------|-------------|
| `push_remote()` | One-way push to production server |
| `sync_remote()` | Two-way sync with production server |
| `syndicate_doc(slug)` | Trigger POSSE syndication |

### Moderation

| Tool | Description |
|------|-------------|
| `list_mentions(slug?, status?)` | List inbound mentions |
| `moderate_mention(id, status)` | Approve/reject a mention |
| `delete_mention(id)` | Delete a mention |

### Publishing

| Tool | Description |
|------|-------------|
| `generate_format(slug, format)` | Generate PDF or EPUB |
| `list_collections()` | List collections with document counts |

### IPFS (when enabled)

| Tool | Description |
|------|-------------|
| `get_doc_cid(slug)` | Get IPFS CIDs for a document |
| `pin_doc(slug)` | Pin document to IPFS |

### Email (when configured)

| Tool | Description |
|------|-------------|
| `list_subscribers(frequency?)` | List email subscribers |
| `add_subscriber(email, frequency?)` | Add a subscriber |
| `delete_subscriber(email)` | Remove a subscriber |
| `send_test_email(to)` | Send a test email |

### AI (when enabled)

| Tool | Description |
|------|-------------|
| `talk_to_docs(query)` | Semantic search with RAG |
