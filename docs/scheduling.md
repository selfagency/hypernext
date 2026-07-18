# Scheduled Publishing

Hypernext supports scheduling documents for future publication using the `publishAt` frontmatter field.

## Frontmatter

```yaml
---
title: Upcoming Post
date: 2026-07-16
publishAt: 2026-08-01T12:00:00Z
type: post
---
```

- `date` — Canonical publication date (used for display and sorting)
- `publishAt` — ISO 8601 timestamp for when the document should become visible

## Behavior

Documents with a future `publishAt` (or future `date`) are:

- **Excluded from all protocol servers** — HTTP, Gemini, Gopher, Spartan, NEX, Text, and Finger all return 404/Not Found
- **Excluded from listings** — `listDocSlugs()` filters them out by default
- **Excluded from RSS** — Future-dated posts don't appear in the feed
- **Excluded from archives** — Archive queries filter by date range
- **Excluded from sitemap** — Not included in XML sitemap

Pass `includeFuture: true` to `listDocSlugs()` to include future-dated documents in listings (e.g., for preview purposes).

## Archive Routes

```
/blog/archive/:year          — Posts from a specific year
/blog/archive/:year/:month   — Posts from a specific month
```

Archive routes respect scheduled publishing — future posts are excluded.

## Taxonomy Routes

```
/blog/:taxonomy/:term        — Posts with a specific tag/category
```

Taxonomy routes also respect scheduled publishing.
