# Comment Moderation

Hypernext provides a moderation API for managing inbound mentions (Webmentions, Pingbacks, Trackbacks) and POSSE reply aggregation.

## Comment Status

Each mention has a `spamStatus` field with three states:
- `pending` — Awaiting review (default for new mentions)
- `ham` — Approved, visible on the site
- `spam` — Rejected, hidden from all views

Mentions can also be `hidden: true` to hide them without changing spam status.

## API Endpoints

### List Comments

```
GET /api/v1/comments?status=pending
```

Query parameters:
- `status` — Filter by status: `ham`, `spam`, `pending`, `all` (default: `all`)

### Moderate Comment

```
PATCH /api/v1/comments/:id
Content-Type: application/json

{"status": "ham"}
```

Sets the spam status. Valid values: `ham`, `spam`.

### Hide Comment

```
POST /api/v1/comments/:id/hide
```

Sets `hidden: true` — comment is excluded from rendered output but preserved in the database.

### Unhide Comment

```
POST /api/v1/comments/:id/unhide
```

Sets `hidden: false`.

### Delete Comment

```
DELETE /api/v1/comments/:id
```

Permanently removes the comment from the database.

## Blocklist

### List Blocklist

```
GET /api/v1/blocklist
```

### Add Blocklist Entry

```
POST /api/v1/blocklist
Content-Type: application/json

{"type": "domain", "value": "spam-site.com"}
```

Supported types:
- `handle` — Partial match on author name (case-insensitive)
- `domain` — Substring match on source URL host
- `ip` — Exact match on sender IP

### Delete Blocklist Entry

```
DELETE /api/v1/blocklist/:id
```

## Frontmatter Controls

Per-document comment configuration via frontmatter:

```yaml
---
title: My Post
comments:
  enabled: false
  inbound:
    webmention: false
---
```

## Spam Detection

Akismet integration is configured globally:

```yaml
comments:
  akismet:
    enabled: true
    apiKey: "your-key"
```

## MCP Tools

- `list_mentions` — List mentions with optional slug/status filters
- `moderate_mention` — Set spam status on a mention
- `delete_mention` — Delete a mention
