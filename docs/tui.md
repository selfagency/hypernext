# TUI Editor

Hypernext includes a terminal-based editor built with Ink and React for managing content directly from the command line.

## Launching

```bash
hypernext editor --local    # Local mode (reads/writes content/ directory)
hypernext editor --remote   # Remote mode (API proxy to production server)
```

Or via npm script:

```bash
pnpm dev:editor
```

## Layout

The editor has a three-column layout:

- **Left pane** — File explorer showing open documents
- **Center** — Frontmatter form (top) and body editor (bottom)
- **Right pane** — Preview or diagnostics

## Keybindings

| Key | Action |
|-----|--------|
| `Ctrl+B` | Toggle file explorer pane |
| `Ctrl+P` | Toggle preview pane |
| `Ctrl+K` | Open command palette |
| `Ctrl+S` | Save current file |
| `Ctrl+I` | Copy IPFS gateway URL |
| `Ctrl+Q` | Quit editor |
| `Tab` | Cycle preview/diagnostics mode |

## Command Palette

Press `Ctrl+K` to open the command palette with fuzzy search. Available commands:

- Toggle Explorer
- Toggle Preview
- Toggle Diagnostics
- Save File
- New Post
- Open Dashboard
- Open Moderation Queue
- Open Taxonomy Manager
- Open System Logs
- Push to Production
- Sync with Production
- Pin to IPFS (when IPFS enabled)
- Copy IPFS Gateway URL (when IPFS enabled)
- Quit

## Frontmatter Form

The frontmatter form allows editing document metadata:
- Title
- Description
- Date
- Type (post/page)
- Tags
- Visibility (public/private)

## Body Editor

Multi-line text editor for the document body content. Supports Markdown syntax.

## Preview

The preview pane shows rendered content or diagnostics for the current document.
