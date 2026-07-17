# API Reference

Hypernext provides a REST API for accessing documents programmatically.

## Authentication

API endpoints require a Bearer token obtained via IndieAuth OAuth2 flow.

## Endpoints

### List Documents

```
GET /api/v1/docs
```

Query parameters:
- `type` — Filter by document type
- `tag` — Filter by taxonomy term slug
- `limit` — Max results (default 20, max 100)
- `offset` — Pagination offset

### Get Document

```
GET /api/v1/docs/:slug
```

Returns the document metadata as JSON.

### Get Document as PDF

```
GET /api/v1/docs/:slug.pdf
```

Returns a PDF generated from the document content.

### Get Collection as EPUB

```
GET /api/v1/collections/:name.epub
```

Returns an EPUB file containing all documents in the collection.

## MCP Tools

Hypernext exposes a Model Context Protocol server for AI agent access:

- `search_docs` — Full-text search across documents
- `get_doc_markdown` — Get document rendered as Markdown
- `list_collections` — List configured collections with document counts
