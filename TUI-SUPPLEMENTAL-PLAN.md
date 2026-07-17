# Supplementary Plan: Hypernext TUI Editor, Sync, Ingestion, Analytics & Comprehensive MCP

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Provide a comprehensive, mouse-accessible, terminal-based MDX editing environment for Hypernext, built with `Ink`. Designed to be "stupid easy" for novices, it replaces raw YAML/JSX editing with structured forms, component intellisense, and click-to-fix tooltips. Supports dual workflows: authoring locally and syncing/pushing via API, or editing directly on the remote server. Includes file browsing, live preview (with smart image/ASCII support), linting, spellcheck, media management, wiki-link insertion, a command palette, a two-way sync engine, a URL-to-MDX ingestion feature, cross-protocol analytics, TUI management dashboards, comprehensive logging/telemetry, and a fully-featured, securely authenticated MCP server exposing all platform capabilities to AI agents.

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
5. **Modal Overlays:** Command Palette, Sync Progress, Media Browser, Intellisense/Tooltips, Dashboards.

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
* `Ctrl+D`: Open TUI Dashboard.
* `Ctrl+T`: Open Taxonomy Manager.
* `Ctrl+L`: Open System Logs.

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

## 9. Live Preview (`@oakoliver/glow`) & Smart Image Handling

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

### Smart Image Rendering Pipeline
Hypernext handles images intelligently based on the target protocol.
1. **`<Image src="..." alt="..." width={80} />` Component:**
   * **HTML:** Renders as `<img src="..." alt="...">`.
   * **Gemini/Gopher/NEX:** The `workmatic` worker uses `asciify-engine` to convert the image to ASCII art (respecting the `width` prop) and injects it as a preformatted code block.
2. **Standard Markdown `![alt text](/assets/img.png)`:**
   * **HTML:** Renders as `<img>`.
   * **Gemini/Gopher/NEX:** Renders as a link: `=> /assets/img.png alt text`.

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
* `> Open Dashboard` (Ctrl+D)
* `> Open Taxonomy Manager` (Ctrl+T)
* `> Open Moderation Queue`
* `> Edit Config (config.yml)`
* `> Lint File (rumdl)`

---

## 11. Cross-Protocol Analytics Engine (Umami-style)

To provide privacy-first, non-invasive analytics across HTTP, Gemini, Gopher, Spartan, NEX, and Text protocols, we implement a lightweight built-in analytics engine. No client-side JavaScript is used.

### Data Collection
Every time a protocol server handles a request, it fires an async event to the `workmatic` queue. 
* **Metrics Captured:** `slug`, `protocol` (http, gemini, gopher), `timestamp`, `referrer` (if available in HTTP/Gemini headers), `visitor_hash`.
* **Privacy/Hashing:** To count unique visitors without storing PII, the IP address is hashed with a daily rotating salt: `visitor_hash = sha256(ip + date_salt)`. This allows counting uniques per day, but prevents tracking users across days or identifying individuals.

### Database Schema (`@mikro-orm/sqlite`)
```typescript
// src/database/entities/Pageview.ts
import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core';

@Entity()
@Index({ properties: ['slug', 'protocol', 'timestamp'] })
export class Pageview {
  @PrimaryKey()
  id: number;

  @Property()
  slug: string;

  @Property()
  protocol: string; // 'http', 'gemini', 'gopher', etc.

  @Property()
  visitor_hash: string;

  @Property({ nullable: true })
  referrer: string;

  @Property({ onCreate: () => Date.now() })
  timestamp: number;
}
```

### API Access
Stats are queryable via the authenticated REST API.
* `GET /api/v1/stats?slug=blog/welcome&days=30`: Returns total views, unique visitors, and breakdown by protocol.
* `GET /api/v1/stats/overview`: Returns site-wide totals for the dashboard.

---

## 12. TUI Dashboard & Management Interfaces

The TUI gains a "Home" dashboard and dedicated management views, accessible via the Command Palette or hotkeys.

### A. The Dashboard View (`Ctrl+D`)
The default screen when opening the TUI. Provides a high-level overview of the site's health.

```text
┌─ Dashboard ───────────────────────────────────────────────┐
│ 📈 Analytics (Last 7 Days)                                 │
│   Total Views: 1,245 | Unique Visitors: 430               │
│   Top Protocols: HTTP (80%), Gemini (15%), Gopher (5%)    │
│   Top Content: /blog/welcome (320v), /library/api (210v)  │
│                                                            │
│ 💬 Moderation Queue                                        │
│   Pending Mentions: 4   [Press M to review]               │
│   Spam Caught:      12                                   │
│                                                            │
│ 📁 Content Stats                                           │
│   Total Posts: 45 | Total Library Docs: 120               │
└────────────────────────────────────────────────────────────┘
```

### B. Taxonomy Manager (`Ctrl+T`)
Allows users to view, create, rename, and delete taxonomies and terms without editing `config.yml` or frontmatter manually.

* **UI:** A split pane. Left side lists Taxonomies (`tags`, `categories`, `chapters`). Right side lists Terms within the selected taxonomy.
* **Actions:** 
  * `N`: Create new Term.
  * `R`: Rename Term (auto-updates all docs that use it via SQLite query).
  * `D`: Delete Term (removes from frontmatter of associated docs).
  * `M`: Merge Term (prompts for another term, updates all docs, deletes the old term).

### C. Comment & Spam Moderation Queue (`Ctrl+M` from Dashboard)
A dedicated interface for reviewing inbound mentions and POSSE replies.

* **UI:** A list of mentions sorted by `spam_status = 'pending'`.
* **List Item Format:** 
  `[Pending] Alice (Mastodon) - "Great post! I totally agree..."`
* **Actions:**
  * `Enter`: Open full mention text.
  * `A`: Approve (Mark as `ham`). Instantly appears on the website via `<Comments />`.
  * `S`: Mark as `spam`.
  * `D`: Delete mention from database.
  * `R`: Reply (Opens the editor with a prefilled Micropub payload to reply to the author via POSSE).

```typescript
// src/tui/components/ModerationQueue.tsx
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { getEntityManager } from '../../database';
import { Mention, SpamStatus } from '../../database/entities/Mention';

export function ModerationQueue() {
  const [mentions, setMentions] = useState<Mention[]>([]);

  useEffect(() => {
    const em = getEntityManager();
    em.find(Mention, { spam_status: SpamStatus.PENDING }, { limit: 50, orderBy: { published_at: 'DESC' } })
      .then(setMentions);
  }, []);

  const handleAction = async (id: string, status: SpamStatus) => {
    const em = getEntityManager();
    const mention = await em.findOne(Mention, { id });
    if (mention) {
      mention.spam_status = status;
      await em.persistAndFlush(mention);
      setMentions(prev => prev.filter(m => m.id !== id));
    }
  };

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold color="cyan">Moderation Queue ({mentions.length})</Text>
      {mentions.map(m => (
        <Box key={m.id} marginTop={1} flexDirection="column">
          <Text color="yellow">{m.author_name} ({m.platform})</Text>
          <Text color="white">{m.content.substring(0, 80)}...</Text>
          <Box>
            <Text color="green">[A] Approve</Text>
            <Text color="red"> [S] Spam</Text>
            <Text color="gray"> [D] Delete</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

---

## 13. Content Ingestion Engine (`hypernext ingest`)

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

## 14. File Publishing & Two-Way Sync Engine

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

## 15. Comprehensive Agent Access (MCP)

The Model Context Protocol (MCP) server exposes the *full* functionality of Hypernext to LLM agents (Claude, Cursor) via `stdio`. This allows agents to not just read, but author, ingest, moderate, publish, and manage the Hypernext instance programmatically.

### Authentication Rules (Local vs. Remote)
The MCP server dynamically adjusts its authentication requirements based on its transport mechanism.
* **Local `stdio` (No Auth):** When running locally (e.g., via Claude Desktop), the MCP server assumes trusted access. All tools (CRUD, sync, moderation) are available unconditionally.
* **Remote HTTP/SSE (Auth Required):** When exposed over HTTP/SSE, agents must send an `Authorization: Bearer <token>` header. Unauthenticated agents can only call `search_docs` and `read_doc` (for public docs). Token scopes (`create`, `update`, `delete`, `admin`) dictate access to management tools.

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

#### Analytics & Utilities
* `get_stats(slug?, days?)`: Retrieve cross-protocol analytics (views, uniques).
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
import { getStats } from '../analytics/stats-manager';
import { getMcpAuthContext } from './auth';

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
    { name: 'get_stats', description: 'Get analytics for a slug or site', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, days: { type: 'number' } } } },
    { name: 'generate_format', description: 'Generate PDF or EPUB', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, format: { type: 'string' } } } }
  ]
}));

server.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: args } = req.params;

  // 1. Authenticate & Authorize
  const { valid, scopes } = getMcpAuthContext(req);
  if (!valid && name !== 'search_docs' && name !== 'read_doc') {
    throw new Error('Unauthorized: Invalid or missing MCP token.');
  }

  const requiredScope = toolScopes[name];
  if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('admin')) {
    throw new Error(`Forbidden: Tool '${name}' requires the '${requiredScope}' scope.`);
  }

  // 2. Execute Tool
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
      await syncTwoWay(getConfig(), (msg) => console.error(msg));
      return { content: [{ type: 'text', text: 'Two-way sync complete.' }] };
    }
    case 'get_stats': {
      const stats = await getStats(args.slug, args.days || 7);
      return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
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

---

## 16. Observability: Logging (`tslog`) & OpenTelemetry

To ensure stability and debuggability across the main process, worker threads, and remote syncs, we implement comprehensive logging and optional tracing.

### Configuration (`config.yml`)
```yaml
# config.yml
logging:
  level: "info"           # "trace", "debug", "info", "warn", "error"
  format: "json"           # "json" or "pretty" (pretty is great for local dev/TUI)
  logToFile: true
  filePath: "./logs/hypernext.log"
  maskSecrets: true        # Prevents API keys/tokens from hitting the logs

telemetry:
  enabled: false           # Off by default to preserve $5 VPS resources
  serviceName: "hypernext-prod"
  otlpEndpoint: "http://localhost:4318" # Standard OTLP HTTP endpoint
  exportInterval: 5000     # Batch export every 5 seconds
```

### Central Logger Module (`tslog`)
We configure `tslog` to output structured JSON in production and colorized text in development. A centralized logger module ensures all processes use the same configuration.

```typescript
// src/utils/logger.ts
import { Logger } from 'tslog';
import { getConfig } from '../config';

const config = getConfig().logging;

export const logger = new Logger({
  name: 'hypernext',
  minLevel: config.level as any,
  type: config.format === 'json' ? 'json' : 'pretty',
  maskValuesRegEx: [
    /"(password|token|apiKey|secretAccessKey|authorization)":"[^]*"/g,
  ],
});

if (config.logToFile) {
  logger.attachTransport((logObj) => {
    fs.appendFileSync(config.filePath, JSON.stringify(logObj) + '\n');
  });
}
```

### OpenTelemetry Integration (Optional)
Because OTel can add memory overhead, it is strictly **opt-in**. It auto-instruments Fastify, HTTP `fetch`, and SQLite, allowing users to ship traces to Grafana Cloud or Honeycomb to debug slow Gemini handshakes or slow Mastodon API calls.

```typescript
// src/bin.ts (Top of file)
import { getConfig } from './config';

// 1. Load Config first
const config = getConfig();

// 2. Initialize OTel if enabled
if (config.telemetry?.enabled) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  // ... (setup metric readers and resource) ...
  const sdk = new NodeSDK({
    // ... config ...
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

// 3. Now import the rest of the app
import './app';
```

### TUI System Logs Pane (`Ctrl+L`)
A modal overlay in the TUI that tails the `tslog` output stream. It filters out noisy HTTP request logs and focuses on `warn` and `error` levels, as well as background job events (e.g., "Webmention processed", "Sync complete").

```typescript
// src/tui/components/LogsPane.tsx
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';

export function LogsPane() {
  const [logs, setLogs] = useState<{level: string, msg: string}[]>([]);

  useEffect(() => {
    logger.attachTransport((logObj) => {
      if (logObj._meta.minLevel >= 3) { // Warn or Error
        setLogs(prev => [...prev.slice(-20), { 
          level: logObj._meta.name, 
          msg: logObj[0] 
        }]);
      }
    });
  }, []);

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">System Logs (Warn/Error)</Text>
      {logs.map((log, i) => (
        <Text key={i} color={log.level === 'error' ? 'red' : 'yellow'}>
          [{log.level.toUpperCase()}] {log.msg}
        </Text>
      ))}
    </Box>
  );
}
```

You are exactly right. The `tslog` transport attaches to the *current* Node.js process. If you are running the TUI in `--local` mode, it only shows logs from your local headless daemon. If you are in `--remote` mode, it shows nothing (because no local daemon is running).

To make the TUI fully functional for remote management, we need to add a **Remote Log Streaming API** and update the TUI to fetch from it when in `--remote` mode.

Here is the update to the Observability section to support remote log streaming:

---

## Update: Remote Log Streaming via API

### 1. API Endpoint for Logs
We add a new endpoint to the Fastify REST API. It reads the recent logs from the log file (or an in-memory ring buffer) and returns them as JSON. This endpoint requires the `admin` scope.

```typescript
// src/api/logs.ts
import { FastifyInstance } from 'fastify';
import fs from 'fs';
import { getConfig } from '../config';

export default async function logRoutes(app: FastifyInstance) {
  // GET /api/v1/logs?level=warn&limit=50
  app.get('/api/v1/logs', async (req, reply) => {
    // Auth check (admin scope) is handled by global API preHandler
    const { level = 'info', limit = 50 } = req.query as any;
    
    const config = getConfig().logging;
    if (!config.logToFile) return { data: [] };

    // Read the log file and parse the last N lines
    // (In production, use a proper ring buffer or tail library to avoid reading huge files)
    const fileContent = fs.readFileSync(config.filePath, 'utf-8');
    const lines = fileContent.trim().split('\n').slice(-parseInt(limit));
    
    const logs = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    // Filter by level (1=trace, 2=debug, 3=info, 4=warn, 5=error)
    const levelMap = { trace: 1, debug: 2, info: 3, warn: 4, error: 5 };
    const filtered = logs.filter(log => log._meta.minLevel >= levelMap[level]);

    return { data: filtered };
  });
}
```

### 2. Updated TUI Logs Pane (Dual-Mode)
The TUI Logs Pane now checks the operating mode. 
* **Local Mode:** Attaches directly to the local `tslog` transport for instant, zero-latency streaming.
* **Remote Mode:** Polls the remote server's `GET /api/v1/logs` endpoint every 2 seconds and appends new logs to the TUI state.

```typescript
// src/tui/components/LogsPane.tsx
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { getConfig } from '../../config';

export function LogsPane({ mode }: { mode: 'local' | 'remote' }) {
  const [logs, setLogs] = useState<{level: string, msg: string}[]>([]);
  const config = getConfig();

  useEffect(() => {
    if (mode === 'local') {
      // LOCAL: Attach to in-process tslog
      logger.attachTransport((logObj) => {
        if (logObj._meta.minLevel >= 3) { // Warn or Error
          setLogs(prev => [...prev.slice(-20), { 
            level: logObj._meta.name, 
            msg: logObj[0] 
          }]);
        }
      });
    } else {
      // REMOTE: Poll the API every 2 seconds
      const fetchLogs = async () => {
        try {
          const res = await fetch(`${config.remote.url}/api/v1/logs?level=warn&limit=20`, {
            headers: { 'Authorization': `Bearer ${config.remote.token}` }
          });
          const { data } = await res.json();
          if (data) {
            setLogs(data.map((l: any) => ({ 
              level: l._meta.name, 
              msg: l[0] 
            })));
          }
        } catch (err) { /* ignore fetch errors to avoid spamming TUI */ }
      };
      
      fetchLogs();
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [mode]);

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">System Logs ({mode})</Text>
      {logs.map((log, i) => (
        <Text key={i} color={log.level === 'error' ? 'red' : 'yellow'}>
          [{log.level.toUpperCase()}] {log.msg}
        </Text>
      ))}
    </Box>
  );
}
```

This ensures that whether you are running the daemon on your laptop or managing your production $5 VPS from your laptop, the TUI Dashboard (`Ctrl+L`) always gives you real-time visibility into system health, worker errors, and failed API calls.