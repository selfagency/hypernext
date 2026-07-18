# POSSE Syndication

Hypernext supports POSSE (Publish on your Own Site, Syndicate Elsewhere) to automatically share new posts on Mastodon and Bluesky.

## Configuration

```yaml
syndication:
  mastodon:
    enabled: true
    instance: "https://mastodon.social"
    accessToken: "your-token"
  bluesky:
    enabled: true
    service: "https://bsky.social"
    identifier: "user.bsky.social"
    accessToken: "your-token"
```

## How It Works

1. A new post is indexed via the `indexing` workmatic queue
2. The indexing queue enqueues an `outbound-syndication` job
3. The syndication worker checks if the post has already been syndicated to each platform
4. If not, it posts to Mastodon and/or Bluesky via their APIs
5. The syndication record is stored in the database

## Per-Collection Control

```yaml
collections:
  blog:
    path: "/blog/"
    syndicate: true   # Auto-syndicate blog posts
  library:
    path: "/library/"
    syndicate: false  # Don't syndicate library pages
```

## MCP Tool

```
syndicate_doc(slug)
```

Manually trigger syndication for a specific document.

## POSSE Reply Aggregation

Replies to syndicated posts are fetched back and stored as mentions:

- **Mastodon** — Fetches replies via the Mastodon API context endpoint
- **Bluesky** — Fetches replies via the Bluesky AT Protocol getPostThread endpoint

Replies appear in the Comments section of the original post.
