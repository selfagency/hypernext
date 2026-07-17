# IndieWeb Features

Hypernext implements several IndieWeb standards for decentralized publishing.

## IndieAuth

OAuth2-based authentication using the IndieAuth profile:

- `/.well-known/oauth-authorization-server` — Server metadata
- `/auth/authorize` — Authorization endpoint
- `/auth/token` — Token endpoint
- `/auth/revoke` — Token revocation

## Micropub

Create posts via the Micropub API:

```bash
curl -X POST https://example.com/micropub \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": ["h-entry"],
    "properties": {
      "name": ["My Post"],
      "content": ["Hello world"],
      "category": ["indieweb"]
    }
  }'
```

## WebFinger

`/.well-known/webfinger?resource=acct:user@domain.com`

## ActivityPub

- `/actor` — Actor profile (JSON-LD)
- `/outbox` — Outbox collection

## POSSE Syndication

Auto-publish to Mastodon and Bluesky when `type: post` is set in frontmatter.
