# Protocol Servers

Hypernext serves content over multiple protocols simultaneously. Each protocol is configured in `config.yml` under the `protocols` section.

## HTTP

The primary web interface serves HTML with Microformats2 classes (`h-entry`, `h-card`, `h-feed`). Routes:

- `/` — Home page
- `/:collection/:slug` — Document pages
- `/rss.xml` — RSS feed
- `/sitemap.xml` — XML sitemap
- `/health` — Health check

## Gemini

TLS-encrypted Gemini protocol. Requires `certPath` and `keyPath` in config. Serves Gemtext format.

## Gopher

Classic Gopher protocol. Serves menu listings and text content.

## Spartan

Lightweight Spartan protocol. Uses Gemtext format for responses.

## NEX

Headerless raw protocol. Sends content directly without headers.

## Text Protocol

Simple text protocol with 2-digit status codes (20 OK, 40 Not Found).

## Finger

Serves author information from `config.author` fields.
