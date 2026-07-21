# Architecture

Hypernext is a TypeScript-based, multi-protocol Markdown document server. It transforms Markdown files (.md and .mdx) into a unified interface accessible via HTTP, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB.

## Key directories

- `content/` — MDX source files organized in collections (blog, library)
- `templates/` — Layout templates with <slot /> for content injection
- `db/` — SQLite database
- `config.yml` — Site configuration