# Supplementary Plan: Hypernext TUI Editor, Sync, Ingestion & Comprehensive MCP

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Provide a comprehensive, mouse-accessible, terminal-based MDX editing environment for Hypernext, built with `Ink`. Designed to be "stupid easy" for novices, it replaces raw YAML/JSX editing with structured forms, component intellisense, and click-to-fix tooltips. Supports dual workflows: authoring locally and syncing/pushing via API, or editing directly on the remote server. Includes file browsing, live preview (with smart image/ASCII support), linting, spellcheck, media management, wiki-link insertion, a command palette, a two-way sync engine, a URL-to-MDX ingestion feature, and a fully-featured MCP server exposing all platform capabilities to AI agents.

---

## 1. Core TUI Architecture & Tooling

The TUI is triggered via `hypernext editor`. It mounts a React application inside the terminal using `Ink` and `@inkjs/ui`.

### Layout Structure (3-Pane Yoga Flexbox)
1. **Left Pane (Explorer):** File tree, Collections, Blog Posts, Templates, Assets, and `config.yml`.
2. **Center Pane (Editor):** Split vertically into a structured Frontmatter Form (top) and a multi-line Markdown/MDX text editor (bottom) with syntax highlighting and cursor tracking.
3. **Right Pane (Preview / Diagnostics):** Toggles between:
   * **Preview:** Rendered Markdown via `@oakoliver/glow`.
   * **Diagnostics:** `rumdl-wasm` and `stylelint` errors, and `spellchecker` misspelled words.
4. **Bottom Bar (Status/Hotkeys):** Current file path, save status (`*` if unsaved), active mode (Local/Remote), and active hotkeys.
5. **Modal Overlays:** Command Palette, Sync Progress, Media Browser, Intellisense/Tooltips.

### Tool Integration Map
* **UI & Layout:** `ink`, `@inkjs/ui` (Select, TextInput, Spinner, Box, Text, Checkbox).
* **Markdown Preview:** `@oakoliver/glow` (Node wrapper for Go's `glow`, outputs ANSI-formatted Markdown).
* **Markdown Linting:** `rumdl-wasm` (Rust MD linter compiled to WASM).
* **Spellchecking:** `spellchecker` (Native node binding for fast proofing).
* **CSS Linting:** `stylelint` (Mighty CSS linter).
* **Typography:** `nerd-fonts` (Symbol support for icons, checking terminal capabilities).
* **HTML to Markdown:** `turndown` (Used for the URL ingestion feature).

---

## 2. Dual Operating Modes (Local vs. Remote Direct)

To support different user preferences, the TUI operates in two distinct modes, selectable via CLI flags or config.

### Mode A: Local Headless (`hypernext editor --local`)
1. **Starts Core Services:** Initializes the local SQLite database, the `workmatic` worker pool, and the File Watcher/Indexer.
2. **Disables Network Servers:** Overrides `config.yml` to force all protocol servers (HTTP, Gemini, etc.) off. The user is not serving a public site from their laptop.
3. **Background Indexing:** As the user writes and saves files, the local indexer updates the local `hypernext.db`. This keeps wiki-link fuzzy search and content queries instant.
4. **Saving:** `Ctrl+S` writes to the local filesystem.
5. **Publishing:** User must use `hypernext push` (one-way) or `hypernext sync` (two-way) to deploy changes to the remote server via the REST API.

### Mode B: Remote Direct (`hypernext editor --remote`)
1. **No Local Daemon:** Does not start the local SQLite database or `workmatic` pool. 
2. **API Proxy:** The TUI acts as a headless client. The Left Pane file tree is populated by `GET /api/v1/docs`. 
3. **Saving:** `Ctrl+S` pushes the file directly to the remote server via `PUT /api/v1/docs/:slug` using an OAuth2 Bearer token. The remote server's indexer handles all background processing immediately.
4. **Wiki-Links:** Fuzzy search queries the remote server's `GET /api/v1/docs?q=...` endpoint instead of local SQLite.
5. **Diagnostics:** Linting and spellchecking still run locally in the TUI for instant feedback, but preview rendering can optionally hit the remote API.

### Configuration (`config.yml`)
```yaml
# config.yml
editor:
  defaultMode: local # or "remote"
remote:
  enabled: true
  url: "https://myblog.com"
  token: ${REMOTE_OAUTH_TOKEN}
```

---

## 3. Structured Frontmatter Editor (Novice-Friendly)

Instead of forcing users to write raw YAML at the top of the file, the TUI Center Pane is split. The top section is a dynamically generated form. 

### How it Works
1. When an `.mdx` file is loaded, the TUI parses the frontmatter.
2. **Top Section (Metadata Form):** Rendered using `@inkjs/ui` components.
   * `Title`: Text input
   * `Type`: Select dropdown (`post`, `page`)
   * `Visibility`: Select dropdown (`public`, `private`)
   * `Tags`: Comma-separated text input
   * `Syndicate To`: Checkboxes (`[x] Mastodon`, `[x] Bluesky`)
3. **Bottom Section (Body Editor):** The standard multi-line text area for the Markdown content.
4. When the user saves (`Ctrl+S`), the TUI serializes the form state back into valid YAML frontmatter and merges it with the body text before writing to disk or pushing to the API.

```typescript
// src/tui/components/FrontmatterForm.tsx
import { Box, Text } from 'ink';
import { TextInput, SelectInput, Checkbox } from '@inkjs/ui';

export function FrontmatterForm({ meta, onUpdate }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold color="cyan">Document Metadata</Text>
      
      <Box marginTop={1}>
        <Text width={15}>Title:</Text>
        <TextInput value={meta.title} onChange={v => onUpdate('title', v)} />
      </Box>
      
      <Box marginTop={1}>
        <Text width={15}>Visibility:</Text>
        <SelectInput 
          items={[{label: 'Public', value: 'public'}, {label: 'Private', value: 'private'}]}
          onSelect={item => onUpdate('visibility', item.value)} 
        />
      </Box>
      
      <Box marginTop={1}>
        <Text width={15}>Syndicate To:</Text>
        <Checkbox 
          label="Mastodon" 
          checked={meta.syndicateTo?.includes('mastodon')} 
          onChange={v => toggleSyndication('mastodon', v)} 
        />
      </Box>
    </Box>
  );
}
```

---

## 4. MDX Component Intellisense & Autocomplete

When editing `.mdx` files, users shouldn't have to guess component names or props. The TUI provides a VS Code-like experience.

### Component Autocomplete
1. When the user types `<` in the editor, a dropdown modal appears listing all allowed built-in components (`NavMenu`, `RecentPosts`, `Enclosure`, `Figure`, `Image`, etc.).
2. The user can type to fuzzy-search the list. 
3. Pressing `Enter` auto-completes the component tag. If the component requires props (e.g., `<Image>` needs `src`), the TUI inserts a skeleton: `<Image src="/assets/logo.png" alt="Logo" width={80} />` and places the cursor on the path for easy editing.

### Component Tooltip/Reference
If the user places their cursor inside a component tag and presses `Ctrl+Space`, a modal pops up showing documentation:
```text
┌─ <Image /> ───────────────────────────────────────────┐
│ Smart image component.                                 │
│ Renders as <img> in HTML.                              │
│ Automatically converts to ASCII art for text-only      │
│ protocols (Gemini, Gopher, NEX).                       │
│                                                        │
│ Props:                                                 │
│  - src (string, required): Path to image file.         │
│  - alt (string, required): Fallback text/alt text.     │
│  - width (number, optional): Target char width for ASCII│
└────────────────────────────────────────────────────────┘
```

---

## 5. Inline Linting & "Click-to-Fix" Tooltips

Diagnostics shouldn't just live in a side pane. They need to be contextual and actionable.

### Inline Highlighting
As the user types, the `rumdl-wasm` and `spellchecker` run in the background. If an error is found (e.g., misspelled word, trailing spaces, invalid JSX prop), the specific text in the editor buffer is highlighted with a red background or red underline (using ANSI color codes).

### Intellisense Tooltip on Error
1. When the user clicks on the highlighted error (or moves their cursor to it and presses `Enter`), a tooltip modal appears directly above the text.
2. The tooltip explains the error in plain English.
3. If a fix is available (e.g., "Remove trailing spaces", "Correct spelling to 'IndieWeb'"), a button is provided: `[F] Apply Fix`.

```typescript
// src/tui/components/ErrorTooltip.tsx
import { Box, Text } from 'ink';

export function ErrorTooltip({ error, onApplyFix, onClose }) {
  return (
    <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
      <Text bold color="red">⚠ {error.rule}</Text>
      <Text color="white">{error.message}</Text>
      
      {error.suggestion && (
        <Box marginTop={1}>
          <Text>Suggested fix: </Text>
          <Text color="green">{error.suggestion}</Text>
          <Text backgroundColor="blue" color="white"> [F] Apply </Text>
        </Box>
      )}
      <Text marginTop={1} color="gray">[ESC] Dismiss</Text>
    </Box>
  );
}
```

---

## 6. The Editor Buffer & Hotkeys

The bottom half of the Center Pane is a custom `<Editor />` component wrapping `@inkjs/ui`'s `TextInput` (extended for multi-line). It manages a text buffer, cursor position, and an undo/redo history stack.

### Global Hotkeys
* `Ctrl+S`: Save file (serializes form + body, writes to local disk or pushes to remote API, triggers indexer).
* `Ctrl+Z` / `Ctrl+Y`: Undo / Redo.
* `Ctrl+C`: Cancel/Exit (prompts if unsaved changes).
* `Ctrl+W`: Close current tab.
* `Ctrl+Shift+P`: Open Command Palette.

### Markdown / MDX Hotkeys
* `Ctrl+B`: Wrap selection in `**bold**`.
* `Ctrl+I`: Wrap selection in `*italic*`.
* `Ctrl+K`: Insert link (prompts for URL, wraps selection in `[text](url)`).
* `Ctrl+L`: Toggle list item (prepends `- `).
* `Ctrl+/`: Insert Wiki Link (opens fuzzy search of all `.mdx` files).
* `Ctrl+M`: Insert Media (opens media browser modal, inserts standard markdown `![]()` or `<Image />`).
* `Ctrl+Space`: Open Component Reference/Intellisense.

---

## 7. File Browser & Management Tools (Left Pane)

The Left Pane uses `@inkjs/ui`'s `Select` component to render a tree view. In Local Mode, it reads `fs.readdir`. In Remote Mode, it fetches `GET /api/v1/docs` and builds a virtual tree.

### Capabilities
1. **File Browsing:** Navigate `content/`, `templates/`, `assets/`.
2. **Collection Management:** 
   * Press `N` to create a New Collection. Prompts for `name`, `path`, `layout`. 
   * Automatically updates `config.yml` (local) and scaffolds the directory.
3. **Blog/Post Creation:**
   * Press `P` to create a New Post. Prompts for `title`, `type`. 
   * Generates standard frontmatter and opens the file.
4. **Media File Selection:**
   * Press `M` to open the Media Browser modal.
   * Lists files in `assets/` (from local FS or remote API). 
   * Selecting a file inserts a standard markdown image `![alt text](/assets/filename.png)` or the `<Image />` component at the cursor.
5. **Configuration Management:**
   * Select `config.yml` to open it in the editor (Local Mode only).
   * Saving `config.yml` triggers a hot-reload of the local Hypernext server config.

---

## 8. Wiki-Like Link Selection (`Ctrl+/`)

Pressing `Ctrl+/` opens a modal overlay with a `TextInput` for fuzzy searching. 
* **Local Mode:** Queries the local SQLite `docs_meta` table.
* **Remote Mode:** Queries `GET /api/v1/docs?q=...` on the production server.

* Typing "api" filters the list to `/docs/api/auth`, `/docs/api/routing`, etc.
* Selecting a file inserts the appropriate MDX syntax:
  * If target is a post: `[API Auth](/blog/api-auth)`
  * If target is a wiki/doc: `<Link to="/docs/api/auth" />`

---

## 9. Live Preview (`@oakoliver/glow`) & Image Handling

The Right Pane toggles between Preview and Diagnostics using `Tab`.

Debounced (300ms after the user stops typing). The raw MDX text is passed to `@oakoliver/glow`, which returns an ANSI-formatted string. Ink renders this string, providing a rich, syntax-highlighted preview.

```typescript
// src/tui/components/PreviewPane.tsx
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import glow from '@oakoliver/glow';

export function PreviewPane({ mdxContent }: { mdxContent: string }) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const timer = setTimeout(async () => {
      const pureMd = stripMdx(mdxContent);
      const result = await glow(pureMd, { style: 'dark' });
      setPreview(result);
    }, 300);
    return () => clearTimeout(timer);
  }, [mdxContent]);

  return (
    <Box flexDirection="column" borderStyle="round">
      <Text>{preview}</Text>
    </Box>
  );
}
```

*Note on `<Image>`:* If the user inserts the `<Image>` component, the preview pane will display the actual ASCII art generated by the local background indexer (or fetched from the remote API), simulating exactly how it will look in Gopher/Gemini.

---

## 10. Command Palette (`Ctrl+Shift+P`)

Pressing `Ctrl+Shift+P` opens a modal overlay (similar to VS Code) that allows fuzzy-searching and executing any command in the TUI.

### Available Commands
* `> Save File` (Ctrl+S)
* `> New Post` (Ctrl+N)
* `> New Collection`
* `> Insert Media` (Ctrl+M)
* `> Insert Wiki Link` (Ctrl+/)
* `> Ingest URL` (Fetches a URL and converts to MDX)
* `> Toggle Preview` (Tab)
* `> Push to Production` (Local Mode only, one-way upload)
* `> Sync with Production` (Local Mode only, two-way merge)
* `> Edit Config (config.yml)`
* `> Lint File (rumdl)`

---

## 11. File Publishing & Two-Way Sync Engine

For users utilizing the Local Headless workflow, Hypernext includes a built-in API engine for deploying and synchronizing content. It handles Markdown files (`content/`), media assets (`assets/`), and templates (`templates/`), while explicitly ignoring local artifacts.

### `hypernext push` (One-Way Upload)
Reads local directories and pushes them to the remote server via `PUT /api/v1/docs/:slug`, `POST /api/v1/media`, etc.

### `hypernext sync` (Two-Way Merge)
1. **Fetch Remote Index:** Calls `GET /api/v1/docs` to get a list of all remote slugs and their `mtime` (modified time).
2. **Compare with Local:** 
   * If local is newer -> `PUT /api/v1/docs/:slug` (Upload local changes).
   * If remote is newer -> `GET /api/v1/docs/:slug` (Download remote changes to local FS).
   * If remote has a file local doesn't -> Download it.
   * If local has a file remote doesn't -> Upload it.
3. **Conflict Resolution:** Defaults to "remote wins" for conflicts, but logs the overwritten local file to a `.backup` folder.

```typescript
// src/sync/sync-manager.ts
import fs from 'fs';
import path from 'path';
import { getDb } from '../database';

export async function syncTwoWay(config: any, onProgress: (msg: string) => void) {
  const { url, token } = config.remote;
  const localPath = process.cwd();
  
  // 1. Fetch remote index
  onProgress('Fetching remote index...');
  const res = await fetch(`${url}/api/v1/docs?limit=1000`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { data: remoteDocs } = await res.json();
  
  // 2. Get local index
  const db = getDb();
  const localDocs = db.prepare('SELECT slug, mtime FROM docs_meta').all();
  
  // 3. Push local changes
  for (const local of localDocs) {
    const remote = remoteDocs.find(r => r.slug === local.slug);
    if (!remote || local.mtime > remote.mtime) {
      onProgress(`Pushing ${local.slug} to remote...`);
      const fileContent = fs.readFileSync(path.join(localPath, 'content', `${local.slug}.mdx`), 'utf-8');
      await fetch(`${url}/api/v1/docs${local.slug}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: fileContent
      });
    }
  }
  
  // 4. Pull remote changes
  for (const remote of remoteDocs) {
    const local = localDocs.find(l => l.slug === remote.slug);
    if (!local || remote.mtime > local.mtime) {
      onProgress(`Pulling ${remote.slug} from remote...`);
      const docRes = await fetch(`${url}/api/v1/docs/${remote.slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const { data } = await docRes.json();
      const localFilePath = path.join(localPath, 'content', `${remote.slug}.mdx`);
      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
      fs.writeFileSync(localFilePath, data.content.markdown);
    }
  }
}
```

---

## 12. Content Ingestion Engine (`hypernext ingest`)

To make populating a new instance easy, Hypernext includes an ingestion feature. It takes any URL, fetches the HTML, converts it to clean Markdown using `turndown`, generates standard frontmatter, and saves it as an MDX document.

### CLI Implementation
Accessible via standard CLI or the TUI Command Palette.
```bash
hypernext ingest https://en.wikipedia.org/wiki/IndieWeb --collection library --filename indie-web
```

### API Implementation
```http
POST /api/v1/ingest
Authorization: Bearer {token}
Content-Type: application/json

{
  "url": "https://en.wikipedia.org/wiki/IndieWeb",
  "collection": "library",
  "filename": "indie-web"
}
```

### Processing Pipeline (Runs in `workmatic` worker)
1. **Fetch URL:** Download HTML (SSRF protected, limit 5MB).
2. **Extract Content:** Strip `<script>`, `<nav>`, `<footer>` tags to isolate the main article content.
3. **Convert to Markdown:** Pass the cleaned HTML to `turndown`.
4. **Generate Frontmatter:** 
   * `title`: Extracted from `<h1>` or `<title>`.
   * `date`: Current timestamp.
   * `type`: `page` (or `post` if collection is `blog`).
   * `source_url`: The original URL (for canonical reference).
5. **Save:** Write to local storage (if Local Mode) or push via API (if Remote Mode).

```typescript
// src/ingest/ingest-manager.ts
import TurndownService from 'turndown';
import { writeStorage } from '../storage';

const turndown = new TurndownService({ headingStyle: 'atx' });

export async function ingestUrl(payload: any, onProgress: (msg: string) => void) {
  const { url, collection, filename } = payload;
  
  onProgress(`Fetching ${url}...`);
  const res = await fetch(url);
  let html = await res.text();
  
  onProgress('Cleaning HTML and converting to Markdown...');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '');
             
  const markdownBody = turndown.turndown(html);
  
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : filename;
  
  const slug = `/${collection}/${filename}`;
  const frontmatter = `---\ntitle: "${title}"\ndate: ${new Date().toISOString()}\ntype: page\nsource_url: "${url}"\n---\n\n`;
  const mdxContent = frontmatter + markdownBody;
  
  onProgress(`Saving to ${slug}.mdx...`);
  await writeStorage(`${slug}.mdx`, mdxContent);
}
```

---

## 13. Comprehensive Agent Access (MCP)

The Model Context Protocol (MCP) server exposes the *full* functionality of Hypernext to LLM agents (Claude, Cursor) via `stdio`. This allows agents to not just read, but author, ingest, moderate, publish, and manage the Hypernext instance programmatically.

### Tool Definitions

#### Documents & Collections
* `search_docs(query, limit?, type?)`: FTS5 search across blogs and static docs.
* `list_docs(collection?, tag?)`: List documents by collection or taxonomy.
* `read_doc(slug)`: Fetch document frontmatter, raw markdown, and rendered HTML.
* `create_doc(slug, title, content, type, tags?)`: Create a new MDX document.
* `update_doc(slug, content)`: Update an existing MDX document's body.
* `delete_doc(slug)`: Delete a document.
* `lint_doc(slug)`: Run `rumdl-wasm` and `spellchecker` on a document and return diagnostics.

#### Ingestion & Media
* `ingest_url(url, collection, filename)`: Fetch a URL, convert to MDX via `turndown`, and save.
* `list_media()`: List media assets in `assets/`.
* `upload_media(filename, base64data)`: Upload a media asset.

#### Sync & Publishing
* `push_remote()`: Trigger the one-way push to the production server.
* `sync_remote()`: Trigger the two-way sync between local and production.

#### Federation & Moderation
* `list_mentions(slug?, status?)`: List inbound webmentions/fediverse replies (filter by `pending`, `ham`, `spam`).
* `moderate_mention(id, status)`: Update a mention's spam status (e.g., approve a pending mention).
* `delete_mention(id)`: Delete a mention.
* `syndicate_doc(slug)`: Manually trigger POSSE syndication for a doc to Mastodon/Bluesky.

#### Utilities
* `generate_format(slug, format)`: Generate and return a PDF or EPUB for a document/collection.

### MCP Server Implementation

```typescript
// src/mcp/index.ts
import { Server } from '@modelcontextprotocol/sdk/server';
import { searchDocs, getDocMarkdown, listDocs } from '../database';
import { createDoc, updateDoc, deleteDoc } from '../storage';
import { ingestUrl } from '../ingest/ingest-manager';
import { syncTwoWay, pushToRemote } from '../sync/sync-manager';
import { listMentions, moderateMention, deleteMention } from '../federation/moderation';
import { generatePdf, generateEpub } from '../api/generators';

const server = new Server();

server.setRequestHandler('tools/list', async () => ({
  tools: [
    { name: 'search_docs', description: 'Search the blog and docs', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'read_doc', description: 'Read a document by slug', inputSchema: { type: 'object', properties: { slug: { type: 'string' } } } },
    { name: 'create_doc', description: 'Create a new MDX doc', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' } } } },
    { name: 'ingest_url', description: 'Convert a URL to MDX and save', inputSchema: { type: 'object', properties: { url: { type: 'string' }, collection: { type: 'string' }, filename: { type: 'string' } } } },
    { name: 'list_mentions', description: 'List inbound mentions for moderation', inputSchema: { type: 'object', properties: { status: { type: 'string' } } } },
    { name: 'moderate_mention', description: 'Approve or reject a mention', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } } },
    { name: 'sync_remote', description: 'Trigger two-way sync with production', inputSchema: { type: 'object' } },
    { name: 'generate_format', description: 'Generate PDF or EPUB', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, format: { type: 'string' } } } }
  ]
}));

server.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case 'search_docs': {
      const results = searchDocs(args.query);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
    case 'read_doc': {
      const md = await getDocMarkdown(args.slug);
      return { content: [{ type: 'text', text: md }] };
    }
    case 'create_doc': {
      await createDoc(args.slug, args.title, args.content, args.type);
      return { content: [{ type: 'text', text: `Document ${args.slug} created.` }] };
    }
    case 'ingest_url': {
      await ingestUrl(args, (msg) => console.error(msg)); // Log to stderr for MCP
      return { content: [{ type: 'text', text: `Ingested ${args.url} to ${args.filename}.mdx.` }] };
    }
    case 'list_mentions': {
      const mentions = await listMentions(args.status);
      return { content: [{ type: 'text', text: JSON.stringify(mentions) }] };
    }
    case 'moderate_mention': {
      await moderateMention(args.id, args.status);
      return { content: [{ type: 'text', text: `Mention ${args.id} updated to ${args.status}.` }] };
    }
    case 'sync_remote': {
      // Note: MCP runs synchronously, long-running tasks should be queued
      await syncTwoWay(getConfig(), (msg) => console.error(msg));
      return { content: [{ type: 'text', text: 'Two-way sync complete.' }] };
    }
    case 'generate_format': {
      if (args.format === 'pdf') {
        const buffer = await generatePdf(args.slug);
        return { content: [{ type: 'binary', mimeType: 'application/pdf', data: buffer.toString('base64') }] };
      } else if (args.format === 'epub') {
        const buffer = await generateEpub(args.slug);
        return { content: [{ type: 'binary', mimeType: 'application/epub+zip', data: buffer.toString('base64') }] };
      }
    }
  }
});
```

This comprehensive MCP surface ensures that an AI agent can act as a fully autonomous site administrator—capable of researching web pages, ingesting them, editing content, fixing linting errors, moderating spam comments, and generating ebooks, all through the standardized Model Context Protocol.

