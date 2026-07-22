# Hypernext: Multi-Protocol MDX Document Server — Final Architecture Plan

**Current Date:** 2026-07-16  
**Status:** Ready for Implementation  
**Target Environment:** $5 VPS (1 CPU, 512MB-1GB RAM), Single Node.js Process, Zero External Daemons

## Overriding Decisions

The following decisions override the original plan text below. The plan body is preserved for historical context; these annotations are the source of truth.

| Area | Original Plan | Actual Implementation | See |
|------|--------------|---------------------|-----|
| Bundler | Vite SSR/Node build | tsup (esbuild-based) | `tsup.config.ts` |
| CLI framework | cac | oclif | `src/lib/base-command.ts` |
| EPUB library | `md-to-epub` | `@lesjoursfr/html-to-epub` | `package.json` |
| Job queue | workmatic (Kysely+fastq) | SQLite-persisted (`src/jobs/queue.ts`) + piscina worker pool | REMEDIATION-PLAN.md §P1-1 |
| AI master toggle | Independent `ai.enabled`/`mcp.enabled` toggles | `agent.enabled` gates all AI/MCP features | REMEDIATION-PLAN.md §P0-12 |
| TUI | TUI editor planned | Permanently canceled | REMEDIATION-PLAN.md §P3-1 |

---

## Executive Summary

Hypernext is a TypeScript-based, multi-protocol document server, headless CMS, and IndieWeb publishing engine. It transforms a single MDX source repository into a unified interface accessible via HTTP(S) REST API, Gemini, Gopher, Finger, Spartan, NEX, Text Protocol, RSS, PDF, EPUB, and federated social networks (ActivityPub, AT Protocol). 

Designed for the $5 VPS, it requires no external databases or caching servers. It utilizes SQLite for persistence, full-text search, and state management, and relies on a highly efficient AST-to-IR (Intermediate Representation) parsing pipeline that supports MDX layouts, a comprehensive built-in semantic component library (including auto-generated Tables of Contents, Breadcrumbs, Mermaid diagrams, LaTeX math, document includes, and RSS Enclosures) **without executing arbitrary untrusted JavaScript**. 

Hypernext supports both chronological **blogging** (with syndication and RSS) and hierarchical **static collections** (wikis, documentation, ebooks). HTML output natively supports **Microformats2** (h-entry, h-card, h-feed) for complete IndieWeb parser compatibility. A built-in JSON REST API allows Hypernext to act as a headless backend for React/Vue/Astro frontends. 

Configuration is handled via a central `config.yml`, which can be overridden ad-hoc using CLI flags powered by `cac`. The project is built with a modern, strict TypeScript toolchain: bundled with **Vite**, linted with **Biome (Ultracite)**, tested with **Vitest**, documented with **VitePress**, and orchestrated via **pnpm** and **GitHub Actions**. It is designed to be run instantly via `npx hypernext` or `pnpm hypernext` with zero initial configuration.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Zero-Config CLI & Initialization](#2-zero-config-cli--initialization)
3. [Core Configuration (`config.yml`)](#3-core-configuration-configyml)
4. [Headless REST API, PDF & EPUB Generation](#4-headless-rest-api-pdf--epub-generation)
5. [Content Collections & Dynamic Taxonomies](#5-content-collections--dynamic-taxonomies)
6. [Content Model & MDX Component Library](#6-content-model--mdx-component-library)
7. [Parsing & Rendering Pipeline](#7-parsing--rendering-pipeline)
8. [Database, Indexing & Caching](#8-database-indexing--caching)
9. [Authentication & Inbound Authoring (Micropub)](#9-authentication--inbound-authoring-micropub)
10. [Syndication & Outbound Federation (POSSE)](#10-syndication--outbound-federation-posse)
11. [Canonical URL Strategy](#11-canonical-url-strategy)
12. [Textcasting & RSS 2.0](#12-textcasting--rss-20)
13. [Protocol Servers Implementation](#13-protocol-servers-implementation)
14. [Agent Access (MCP)](#14-agent-access-mcp)
15. [Tooling & Developer Experience](#15-tooling--developer-experience)
16. [Testing Strategy (Vitest)](#16-testing-strategy-vitest)
17. [Dockerization](#17-dockerization)
18. [CI/CD & NPM Publishing](#18-cicd--npm-publishing)
19. [Documentation (VitePress)](#19-documentation-vitepress)
20. [Directory Structure](#20-directory-structure)
21. [Dependencies](#21-dependencies)
22. [Roadmap](#22-roadmap)

---

## 1. Architecture Overview

Hypernext runs as a single, asynchronous Node.js process. All TCP/TLS servers (HTTP, Gemini, Gopher, etc.) and the Headless API run concurrently. PDF and EPUB Generation are handled on-demand.

```text
┌──────────────────────────────────────────────────────────────┐
│                    $5 VPS (Single Process)                    │
│                                                              │
│  ┌────────────────────────┐    ┌──────────────────────────┐ │
│  │  Storage (Local/S3)    │    │  SQLite (hypernext.db)   │ │
│  │  - Blog Posts (MDX)    │    │  - FTS5 Search Index     │ │
│  │  - Collections (MDX)   │    │  - Taxonomies & Terms    │ │
│  │  - Media attachments   │    │  - Syndication State     │ │
│  └───────────┬────────────┘    │  - OAuth Tokens          │ │
│              │                 └───────────┬──────────────┘ │
│              ▼                             │                 │
│  ┌──────────────────────────────────────────┐               │
│  │         Parsing & Indexer Worker          │               │
│  │  1. Parse MDX -> AST (remark)             │               │
│  │  2. Inject Layouts & <Components>         │               │
│  │  3. Transform AST -> IR (Intermediate)    │               │
│  │  4. Update FTS5 & Taxonomies & LRU Cache  │               │
│  │  5. Trigger Outbound POSSE Bridge (Blog)  │               │
│  └───────────┬──────────────────────────────┘               │
│              │                                                 │
│              ▼                                                 │
│  ┌──────────────────────────────────────────┐               │
│  │         Multi-Protocol Renderers          │               │
│  │  IR -> HTML (mf2) / Gem / JSON / Markdown │               │
│  └───────────┬──────────────────────────────┘               │
│              │                                                 │
│              ▼                                                 │
│  ┌──────────────────────────────────────────┐               │
│  │           Async Network Servers           │               │
│  │  HTTP(S) (Fastify) -> HTML, REST, PDF, EPUB│              │
│  │  Gemini (TLS) -> Gemtext                  │               │
│  │  Gopher (TCP) -> Menus                    │               │
│  │  Spartan (TCP) -> Gemtext                 │               │
│  │  NEX / Text / Finger (TCP)                │               │
│  └──────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Zero-Config CLI & Initialization

Hypernext is designed to be run instantly via `npx hypernext` or `pnpm hypernext`. It utilizes `cac` for command-line argument parsing. The CLI loads `config.yml` by default, but any setting can be overridden via CLI flags (e.g., `hypernext --port 9090 --no-gemini`).

### CLI Entry Point (`bin.ts`)

```typescript
#!/usr/bin/env node
import cac from 'cac';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { startServer } from './app';
import { deepMerge } from './utils';

const cli = cac('hypernext');

cli
  .option('--port <port>', 'Override HTTP server port')
  .option('--no-gemini', 'Disable Gemini server')
  .option('--no-gopher', 'Disable Gopher server')
  .option('--config <path>', 'Path to config file', { default: 'config.yml' })
  .help()
  .version('1.0.0');

const parsed = cli.parse();

async function init() {
  const cwd = process.cwd();
  const configPath = path.join(cwd, parsed.options.config);

  // 1. Scaffolding if missing
  if (!fs.existsSync(configPath)) {
    console.log('No config.yml found. Scaffolding default configuration...');
    fs.writeFileSync(configPath, defaultConfigYaml);
    fs.mkdirSync(path.join(cwd, 'content/blog'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'content/library'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'content/blog/welcome.mdx'), '---\ntitle: Welcome\ntype: post\n---\n\nHello!');
    fs.mkdirSync(path.join(cwd, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'assets/style.css'), 'body { font-family: sans-serif; }');
  }

  // 2. Load YAML
  const fileConfig = yaml.parse(fs.readFileSync(configPath, 'utf-8'));

  // 3. Override with CLI flags
  let finalConfig = fileConfig;
  if (parsed.options.port) finalConfig.protocols.http.port = parseInt(parsed.options.port);
  if (parsed.options.gemini === false) finalConfig.protocols.gemini.enabled = false;
  if (parsed.options.gopher === false) finalConfig.protocols.gopher.enabled = false;

  await startServer(finalConfig);
}

init();
```

---

## 3. Core Configuration (`config.yml`)

The entire application is driven by `config.yml` (overridable by CLI). Secrets can be injected via environment variables using `${VAR}` syntax.

```yaml
# config.yml
site:
  canonicalBase: "https://myblog.com"
  meta:
    title: "My Hypernext Site"
    description: "A multi-protocol blog and static content library."
    lang: "en"
    ogImage: "/assets/og-image.png"
  theme:
    cssPath: "./assets/style.css"
  pdf:
    enabled: true
    cssPath: "./assets/pdf-style.css"
  ebooks:
    enabled: true
    coverImage: "/assets/book-cover.png"

author:
  name: "Alice Doe"
  bio: "Software engineer and smolnet enthusiast."
  email: "alice@example.com"
  url: "https://alice-personal-site.com"
  photo: "/assets/avatar.png"
  socials:
    mastodon: "https://mastodon.social/@alice"
    bluesky: "https://bsky.app/profile/alice.bsky.social"
    github: "https://github.com/alice-dev"

storage:
  type: local
  local:
    path: "./content"

database:
  type: sqlite
  path: "./hypernext.db"

api:
  enabled: true
  apiKey: ${REST_API_KEY}

collections:
  blog:
    path: "/blog/"
    syndicate: true
    rss: true
    layout: "blog.mdx"
  library:
    path: "/library/"
    syndicate: false
    rss: false
    layout: "library.mdx"
    compileToEbook: true

taxonomies:
  - name: tags
    plural: tags
    singular: tag
  - name: categories
    plural: categories
    singular: category
  - name: chapters
    plural: chapters
    singular: chapter

protocols:
  http:
    enabled: true
    port: 8080
  gemini:
    enabled: true
    port: 1965
    certPath: "./certs/gemini.pem"
    keyPath: "./certs/gemini-key.pem"
  gopher:
    enabled: true
    port: 70
  spartan:
    enabled: true
    port: 300
  nex:
    enabled: true
    port: 1900
  finger:
    enabled: true
    port: 79
  text:
    enabled: true
    port: 5011

micropub:
  enabled: true

syndication:
  mastodon:
    enabled: true
    instance: "https://mastodon.social"
  bluesky:
    enabled: true
    service: "https://bsky.social"
    identifier: "myblog.bsky.social"
    standardSite: true

mcp:
  enabled: true
  transport: stdio
```

---

## 4. Headless REST API, PDF & EPUB Generation

To allow Hypernext to power other websites and provide downloadable documentation/books, a JSON REST API, PDF, and EPUB generation endpoints are built into Fastify.

### Fastify Route Implementation Example

```typescript
// src/api/routes.ts
import { FastifyInstance } from 'fastify';
import { getDb } from '../database';
import { parseToIR, renderHTML, renderMarkdown } from '../parser';
import mdToPdf from 'md-to-pdf';
import mdToEpub from 'md-to-epub';
import path from 'path';
import fs from 'fs';

export default async function apiRoutes(app: FastifyInstance) {
  app.get('/api/v1/docs', async (req, reply) => {
    const { type, tag, limit = 20, offset = 0 } = req.query as any;
    const db = getDb();
    let query = `SELECT slug, title, description, type, tags FROM docs_meta WHERE 1=1`;
    const params: any[] = [];
    if (type) { query += ` AND type = ?`; params.push(type); }
    if (tag) { query += ` AND tags LIKE ?`; params.push(`%${tag}%`); }
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const docs = db.prepare(query).all(...params);
    return { data: docs, meta: { limit, offset } };
  });

  app.get('/api/v1/docs/:slug.pdf', async (req, reply) => {
    const { slug } = req.params as any;
    const markdown = await storage.read(`${slug}.mdx`);
    const ir = await parseToIR(markdown, slug);
    const pureMarkdown = renderMarkdown(ir);

    const tempPath = path.join(__dirname, `../cache/${slug.replace(/\//g, '_')}.md`);
    await fs.promises.writeFile(tempPath, pureMarkdown);
    
    const pdf = await mdToPdf({ path: tempPath }, { stylesheet: config.site.pdf.cssPath });
    if (!pdf) return reply.code(500).send({ error: 'PDF generation failed' });

    reply.header('Content-Type', 'application/pdf');
    return reply.send(pdf.content);
  });

  app.get('/api/v1/collections/:name.epub', async (req, reply) => {
    const { name } = req.params as any;
    const collection = config.collections[name];
    if (!collection || !collection.compileToEbook) return reply.code(404).send({ error: 'Not found' });

    const db = getDb();
    const docs = db.prepare(`SELECT slug, title FROM docs_meta WHERE slug LIKE ? ORDER BY slug ASC`).all(`${collection.path}%`);

    const tempFiles: string[] = [];
    for (const doc of docs) {
      const mdx = await storage.read(`${doc.slug}.mdx`);
      const ir = await parseToIR(mdx, doc.slug);
      const md = renderMarkdown(ir);
      const tempPath = path.join(__dirname, `../cache/${doc.slug.replace(/\//g, '_')}.md`);
      await fs.promises.writeFile(tempPath, md);
      tempFiles.push(tempPath);
    }

    const epubPath = path.join(__dirname, `../cache/${name}.epub`);
    await mdToEpub(tempFiles, epubPath, { title: `${config.site.meta.title} - ${name}` });

    reply.header('Content-Type', 'application/epub+zip');
    reply.header('Content-Disposition', `attachment; filename="${name}.epub"`);
    return reply.sendFile(epubPath);
  });
}
```

---

## 5. Content Collections & Dynamic Taxonomies

Hypernext distinguishes between chronological blogs and static collections based on the `collections` config. Taxonomies are fully user-defined.

### Blogging (Type: `post`)

- **Behavior:** Sorted by date, included in RSS feeds, eligible for POSSE syndication. Wrapped in `h-entry` microformats in HTML.
- **Routing:** `/blog/{slug}`

### Static Collections (Type: `page`)

- **Behavior:** Sorted hierarchically by path/slug, excluded from RSS, ignored by the syndication bridge. Ideal for wikis, libraries, and about pages.
- **Routing:** `/library/{slug}` or `/{slug}` (e.g., `/about`)

### Dynamic Taxonomies

Users define taxonomies in `config.yml`. The indexer parses these arrays in frontmatter and creates routes for them automatically.

```yaml
# Frontmatter Example
---
title: "Chapter 1: Introduction"
type: page
chapters: [1]        # Custom taxonomy defined in config
categories: [setup]  # Standard taxonomy
---
```

Routes generated: `/categories/setup`, `/chapters/1`.

---

## 6. Content Model & MDX Component Library

### MDX Layouts

Users define site structure in `templates/`. The parser uses AST injection to replace `<slot />` with the post content.

```
---
siteName: "My Hypernext Site"
---

<header>
  <NavMenu />
  <h1>{frontmatter.siteName}</h1>
</header>

<main>
  <slot /> {/* Post/Collection content injected here */}
</main>
```

### Built-in MDX Component Library

Hypernext includes semantic components resolved at parse-time into IR nodes. HTML rendering automatically applies appropriate Microformats2 classes.

Component Description HTML Rendering (Microformats2) Gemini/Gopher / RSS Rendering `<NavMenu />` Links to main sections `<nav class="h-feed"><ul>...</ul></nav>` Flattened list of `=>` links `<Breadcrumbs />` Hierarchical trail for wikis/libraries `<nav class="breadcrumbs"><a href="/">Home</a> / ...</nav>` Flattened list of parent links `<Search />` Renders a search input form `<form action="/search"><input .../></form>` `=> /search Search the site` `<TagCloud taxonomy="tags" />` Lists all terms in a taxonomy `<div class="tag-cloud"><a href="/tags/foo">foo</a>...` Flattened list of `=> /tags/foo foo` links `<RecentPosts limit={5} />` Lists recent blog posts `<ul class="h-feed"><li class="h-entry">...</li></ul>` List of `=> /blog/{slug}` links `<PostNav />` Previous/Next chronological navigation `<nav class="post-nav"><a href="...">← Older</a>...</nav>` `=> /blog/prev Older` / `=> /blog/next Newer` `<RelatedPosts limit={3} />` Posts sharing taxonomies `<aside class="related"><ul>...</ul></aside>` Flattened list of related links `<TableOfContents />` Builds outlined TOC from downward folder structure `<ul class="toc">...` Nested menu of `1` links `<Include src="/library/header" />` Wiki-style macro to inject another doc's content (Merged into AST) (Merged into AST) `<AuthorBio />` Pulls from global `config.yml` author block `<div class="h-card"><img class="u-photo" />...</div>` Flattened text bio & contact links `<SyndicationLinks />` Outputs `u-syndication` links from SQLite `<a rel="syndication" href="...">Mastodon</a>` Flattened list of syndication links `<Figure src="..." alt="..." caption="..." />` Groups images and captions `<figure><img src="..." /><figcaption>...</figcaption></figure>` `=> {src} {caption}` `<Mermaid graph="..." />` Renders Mermaid diagrams `<pre class="mermaid">` Link to [mermaid.ink](https://mermaid.ink) `<Latex math="..." />` Renders LaTeX equations `katex.renderToString()` Raw math text block `<Enclosure url="..." type="..." length="..." />` Podcast/media enclosure `<a href="...">Enclosure</a>` Promoted to RSS `<enclosure>`

---

## 7. Parsing & Rendering Pipeline

The core architectural security boundary is that MDX is parsed into an Abstract Syntax Tree (AST), transformed into a standard Intermediate Representation (IR), and then rendered. **MDX is never compiled to executable JavaScript.**

The IR carries semantic metadata (e.g., `node.type = 'author'` or `node.type = 'enclosure'`) so the HTML renderer knows where to inject Microformats2 classes, and the RSS renderer knows to promote enclosures to the item level.

```typescript
// src/parser/pipeline.ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { getDb } from '../database';
import { storage } from '../storage';

const processor = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkMath);

export async function parseToIR(mdxContent: string, currentSlug: string) {
  const ast = processor.parse(mdxContent);
  
  visit(ast, 'mdxJsxFlowElement', async (node) => {
    const allowedComponents = [
      'NavMenu', 'Breadcrumbs', 'Search', 'TagCloud', 'RecentPosts', 
      'PostNav', 'RelatedPosts', 'TableOfContents', 'Include', 
      'AuthorBio', 'SyndicationLinks', 'Figure', 'Mermaid', 'Latex', 'Enclosure'
    ];
    if (!allowedComponents.includes(node.name)) {
      throw new Error(`Security Error: Unknown component <${node.name}>`);
    }
    
    if (node.name === 'TableOfContents') {
      const db = getDb();
      const basePath = currentSlug.includes('/') 
        ? currentSlug.substring(0, currentSlug.lastIndexOf('/')) 
        : '';
      const docs = db.prepare(`
        SELECT slug, title FROM docs_meta 
        WHERE slug LIKE ? AND slug != ? AND type = 'page'
      `).all(`${basePath}/%`, currentSlug);
      
      node.data = { hChildren: buildTocAst(docs, basePath) };
    }

    if (node.name === 'Breadcrumbs') {
      const parts = currentSlug.split('/').filter(Boolean);
      let path = '';
      const links = parts.map((part, i) => {
        path += `/${part}`;
        return { type: 'link', url: path, children: [{ type: 'text', value: part }] };
      });
      node.data = { hChildren: buildNavListAst(links) };
    }

    // Wiki-style includes (transclusion)
    if (node.name === 'Include') {
      const src = node.attributes.find(a => a.name === 'src')?.value;
      if (src) {
        const includedMdx = await storage.read(`${src}.mdx`);
        const includedAst = processor.parse(includedMdx);
        // Replace the <Include> node with the included AST children
        node.data = { hChildren: includedAst.children };
      }
    }
  });
  
  return transformAstToIR(ast);
}
```

---

## 8. Database, Indexing & Caching

To maintain the $5 VPS constraint, Hypernext uses SQLite (`better-sqlite3`) for all persistence and an in-memory LRU cache for rendering.

### SQLite Schema & Query Example

```typescript
// src/database/index.ts
import Database from 'better-sqlite3';

const db = new Database('./hypernext.db');

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    slug, title, description, content, tags UNINDEXED, type UNINDEXED
  );
  CREATE TABLE IF NOT EXISTS docs_meta (
    slug TEXT PRIMARY KEY,
    mtime INTEGER,
    excerpt TEXT,
    tags TEXT,
    type TEXT,
    visibility TEXT
  );
  CREATE TABLE IF NOT EXISTS terms (
    id INTEGER PRIMARY KEY,
    taxonomy TEXT,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS term_relationships (
    slug TEXT,
    term_id INTEGER,
    FOREIGN KEY (term_id) REFERENCES terms(id)
  );
  CREATE TABLE IF NOT EXISTS syndication (
    slug TEXT,
    platform TEXT,
    platform_post_id TEXT,
    PRIMARY KEY (slug, platform)
  );
`);

export function searchDocs(query: string, limit: number = 10) {
  const stmt = db.prepare(`
    SELECT meta.slug, meta.title, meta.type,
           snippet(docs_fts, 3, '<mark>', '</mark>', '...', 10) as excerpt
    FROM docs_fts
    JOIN docs_meta AS meta ON docs_fts.slug = meta.slug
    WHERE docs_fts MATCH ?
    LIMIT ?
  `);
  return stmt.all(query, limit);
}
```

---

## 9. Authentication & Inbound Authoring (Micropub)

Hypernext uses standard W3C IndieAuth (OAuth 2.0 profile) for inbound authoring, replacing legacy XML-RPC.

### Micropub Endpoint Pipeline

```typescript
// src/micropub/index.ts
import TurndownService from 'turndown';
import { writeStorage } from '../storage';

const turndown = new TurndownService();

app.post('/micropub', async (req, reply) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!isValidToken(token)) return reply.code(401).send({ error: 'Invalid token' });

  const { properties } = req.body;
  const title = properties.name?.[0] || 'Untitled';
  const content = properties.content?.[0] || '';
  const categories = properties.category || [];

  const markdownBody = turndown.turndown(content);
  const slug = generateSlug(title);
  const frontmatter = `---\ntitle: "${title}"\ndate: ${new Date().toISOString()}\ntype: post\ntags: [${categories.join(',')}]\n---\n\n`;
  const mdxContent = frontmatter + markdownBody;

  await writeStorage(`/blog/${slug}.mdx`, mdxContent);
  triggerIndexer(`/blog/${slug}.mdx`);

  reply.code(201).header('Location', `/blog/${slug}`).send({ status: 'created' });
});
```

---

## 10. Syndication & Outbound Federation (POSSE)

Hypernext automatically syndicates blog posts (`type: post`) to configured services (Mastodon, Bluesky) based on `config.yml`, unless overridden by frontmatter. Static collections are ignored.

### POSSE Bridge Logic

```typescript
// src/bridge/mastodon.ts
import { getDb } from '../database';

export async function syndicateToMastodon(doc: DocIR) {
  const db = getDb();
  const token = db.prepare('SELECT access_token FROM oauth_tokens WHERE service = ?').get('mastodon');
  
  const existing = db.prepare('SELECT platform_post_id FROM syndication WHERE slug = ? AND platform = ?').get(doc.slug, 'mastodon');
  const statusText = `${doc.frontmatter.title}\n\n${doc.canonicalUrl}`;
  
  if (existing) {
    await fetch(`https://mastodon.social/api/v1/statuses/${existing.platform_post_id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: statusText })
    });
  } else {
    const response = await fetch('https://mastodon.social/api/v1/statuses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: statusText })
    });
    const data = await response.json();
    db.prepare('INSERT INTO syndication (slug, platform, platform_post_id) VALUES (?, ?, ?)').run(doc.slug, 'mastodon', data.id);
    await updateFrontmatterSyndicationLink(doc.slug, 'mastodon', data.url);
  }
}
```

---

## 11. Canonical URL Strategy

To prevent SEO duplication across protocols, proxies, syndication, and headless API consumption:

- **HTML Renderer:** Every page emits `<link rel="canonical" href="{canonicalBase}/{slug}">`.
- **Search/Tag Pages:** Parameterized views emit `<meta name="robots" content="noindex">`.
- **Smolnet Privacy:** If `visibility: private`, Gopher/Spartan/NEX/Text/Finger servers return 404/Not Found.

---

## 12. Textcasting & RSS 2.0

The RSS renderer is upgraded to be fully textcasting-conformant. Only `type: post` documents are included. The `<Enclosure />` IR node is extracted from the content tree and promoted to an item-level `<enclosure>` tag.

```xml
<item>
  <title>My Podcast Episode</title>
  <link>https://myblog.com/blog/my-episode</link>
  <guid isPermaLink="false">blog:my-episode</guid>
  <pubDate>Wed, 16 Jul 2026 15:30:00 +0000</pubDate>
  <description><![CDATA[
    <p>In this episode, we discuss the IndieWeb.</p>
  ]]></description>
  <enclosure url="https://cdn.example.com/podcast.mp3" type="audio/mpeg" length="5242880" />
</item>
```

---

## 13. Protocol Servers Implementation

All servers run in the main Node process via async TCP/TLS sockets.

### HTTP(S) Server (Fastify)

- **Routes:** `/`, `/blog/{slug}`, `/library/{slug}`, `/search`, `/rss.xml`, `/sitemap.xml`, `/.well-known/*`, `/micropub`, `/api/v1/*` (including `.pdf` and `.epub` generation).
- **HTML Output:** Injects Microformats2 classes (`h-entry`, `h-card`, `h-feed`, `p-name`, `e-content`, `u-url`, `u-photo`) natively into the rendered HTML.

### Gemini Server (TLS 1.2+)

- **Port:** 1965
- **Request:** `<URI><CRLF>` (Max 1024 bytes, UTF-8, reject BOM).

```typescript
// src/servers/gemini.ts
import tls from 'tls';
import { URL } from 'url';

const server = tls.createServer({
  cert: fs.readFileSync(config.protocols.gemini.certPath),
  key: fs.readFileSync(config.protocols.gemini.keyPath),
}, (socket) => {
  let data = '';
  socket.setEncoding('utf8');
  socket.on('data', async (chunk) => {
    data += chunk;
    if (data.includes('\r\n')) {
      const reqUrl = new URL(data.split('\r\n')[0]);
      if (data.length > 1024 || data.startsWith('\uFEFF')) {
        return socket.end('59 Bad Request\r\n');
      }
      const slug = reqUrl.pathname;
      const doc = await getDoc(slug);
      if (!doc) return socket.end('51 Not Found\r\n');
      const gemtext = renderGemtext(doc.ir);
      socket.end('20 text/gemini; charset=utf-8\r\n' + gemtext);
    }
  });
});
server.listen(1965);
```

### NEX / Text / Finger Servers

- **NEX:** Port 1900. Raw bytes, no header.
- **Text:** Port 5011. DNS-SD advertised. 2-digit status codes.
- **Finger:** Port 79. Pulls from global config.

---

## 14. Agent Access (MCP)

Model Context Protocol server exposes tools to LLM agents (Claude, Cursor) via `stdio` transport.

```typescript
// src/mcp/index.ts
import { Server } from '@modelcontextprotocol/sdk/server';
import { searchDocs, getDocMarkdown } from '../database';

const server = new Server();

server.setRequestHandler('tools/call', async (req) => {
  if (req.params.name === 'search_docs') {
    const results = searchDocs(req.params.arguments.query);
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  }
});
```

---

## 15. Tooling & Developer Experience

Hypernext uses a strict, modern TypeScript toolchain to ensure high code quality and developer ergonomics.

- **Package Manager:** `pnpm` (strict, fast, disk-efficient).
- **Bundler:** `Vite` configured for SSR/Node library building.
- **Linting/Formatting:** `Biome` configured with `Ultracite` rules.
- **Git Hooks:** `Husky` manages git hooks. `lint-staged` runs Biome auto-fix and Vitest on changed files.

```json
// package.json
{
  "name": "hypernext",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "hypernext": "dist/bin.js"
  },
  "scripts": {
    "dev": "tsx watch src/bin.ts",
    "build": "vite build",
    "start": "node dist/bin.js",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest",
    "test:run": "vitest run",
    "prepare": "husky install",
    "docs": "vitepress dev docs"
  },
  "lint-staged": {
    "*.{ts,tsx,js,json}": ["biome check --apply", "biome format --write"]
  }
}
```

---

## 16. Testing Strategy (Vitest)

Comprehensive unit and integration testing using `Vitest`.

- **Unit Tests:** Parser pipelines (AST to IR), SQLite wrappers, Renderers (HTML/Microformats, Gemtext, RSS, EPUB generation).
- **Integration Tests:** Spinning up the Fastify HTTP server on a random port and testing REST APIs and Micropub flows.

```typescript
// tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../src/parser/pipeline';

describe('MDX Parser Pipeline', () => {
  it('should reject untrusted JSX components', async () => {
    const mdx = '<script>alert(1)</script>';
    await expect(parseToIR(mdx, 'test')).rejects.toThrow('Security Error: Unknown component <script>');
  });

  it('should flatten nested lists for Gemtext compatibility', async () => {
    const mdx = '- Item 1\n  - Sub Item 1';
    const ir = await parseToIR(mdx, 'test');
    const gemtext = renderGemtext(ir);
    expect(gemtext).toContain('* Item 1');
    expect(gemtext).toContain('* Sub Item 1');
  });
});
```

---

## 17. Dockerization

A multi-stage Dockerfile ensures a small production image suitable for deployment.

```
# Build Stage
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production Stage
FROM node:20-alpine AS runner
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --prod --frozen-lockfile
COPY --from=builder /app/dist ./dist
EXPOSE 8080 1965 70 300 1900 79 5011
CMD ["node", "dist/bin.js"]
```

---

## 18. CI/CD & NPM Publishing

GitHub Actions automates testing, quality checks, and publishing to NPM.

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Lint (Biome)
        run: pnpm lint
      - name: Fallow Code Quality
        run: npx fallow analyze
      - name: Test (Vitest)
        run: pnpm test:run
      - name: Build (Vite)
        run: pnpm build

  publish:
    needs: quality
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 19. Documentation (VitePress)

Project documentation is written in Markdown and served via VitePress.

- **Getting Started:** Installation, `npx` usage, `config.yml` generation, CLI flag overrides, first post creation.
- **Protocols Guide:** How to configure Gemini, Gopher, Spartan, NEX, etc.
- **IndieWeb Guide:** Setting up Micropub clients (Quill, Indigenous) and POSSE syndication to Mastodon/Bluesky.
- **API Reference:** Auto-generated via TypeDoc for the Headless REST API and MCP tools.
- **Customization:** Writing custom MDX layouts, using the built-in component library, and compiling EPUBs.

---

## 20. Directory Structure

```
hypernext/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI/CD
├── .husky/
│   └── pre-commit               # Runs lint-staged
├── docs/                        # VitePress documentation
├── src/
│   ├── bin.ts                   # CLI entry point (cac + npx hypernext)
│   ├── app.ts                   # Bootstrap & server startup
│   ├── config.ts                # YAML loader & merger
│   ├── utils/                   # deepMerge, etc.
│   ├── storage/                 # Local & S3 read/write
│   ├── parser/                  # remark-mdx -> AST -> IR
│   ├── database/                # SQLite (better-sqlite3) wrapper
│   ├── indexer/                 # FS/S3 watcher -> Parse -> SQLite update
│   ├── api/                     # Fastify REST API routes, PDF & EPUB gen
│   ├── auth/                    # IndieAuth OAuth2, API key validation
│   ├── micropub/                # POST /micropub JSON -> MDX converter
│   ├── bridge/                  # POSSE syndication (Mastodon, Bluesky)
│   ├── renderers/               # IR -> HTML (mf2), Gemtext, Gopher, RSS
│   ├── servers/                 # TCP/TLS socket implementations
│   ├── federation/              # ActivityPub Outbox, standard.site push
│   └── mcp/                     # MCP server tools
├── templates/
│   ├── blog.mdx                 # Layout for chronological posts
│   └── library.mdx              # Layout for static content collections
├── tests/                       # Vitest unit & integration tests
├── assets/                      # Static assets for HTTP server & PDFs/EPUBs
├── Dockerfile                   # Container definition
├── biome.json                   # Biome + Ultracite config
├── vite.config.ts               # Vite bundler config
├── package.json
└── pnpm-lock.yaml
```

---

## 21. Dependencies

Kept intentionally lean to fit the $5 VPS constraint.

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "@atproto/api": "^0.x",
    "better-sqlite3": "^11.x",
    "cac": "^6.x",
    "fastify": "^4.x",
    "gray-matter": "^4.x",
    "katex": "^0.16.x",
    "lru-cache": "^10.x",
    "md-to-pdf": "^5.x",
    "md-to-epub": "^1.x",
    "remark": "^15.x",
    "remark-mdx": "^3.x",
    "remark-math": "^6.x",
    "remark-parse": "^11.x",
    "turndown": "^7.x",
    "yaml": "^2.x"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.x",
    "ultracite": "^0.x",
    "husky": "^9.x",
    "lint-staged": "^15.x",
    "tsx": "^4.x",
    "typescript": "^5.x",
    "vite": "^5.x",
    "vitepress": "^1.x",
    "vitest": "^1.x"
  }
}
```

---

## 22. Roadmap

### Phase 1: Core Pipeline & Tooling (1 week)

- [ ] Initialize project with `pnpm`, `Vite`, `Biome/Ultracite`, `Husky`, `Vitest`.
- [ ] Implement `bin.ts` for zero-config `npx` execution, `cac` CLI flags, and scaffolding.
- [ ] `config.yml` loader, environment bootstrap, and CLI override merging.
- [ ] Local/S3 storage providers (read/write).
- [ ] SQLite database initialization (FTS5, metadata, taxonomies, syndication tables).
- [ ] Parser pipeline: `remark-mdx` to AST, AST to IR.
- [ ] HTML Renderer + Fastify HTTP server (with CSS, Meta tag, and Microformats2 injection).

### Phase 2: Headless API, Templating, & Indexing (1 week)

- [ ] Implement `/api/v1/*` JSON REST endpoints, PDF route, and EPUB compilation route.
- [ ] Implement collection routing (`/blog/` vs `/library/`) and dynamic taxonomy routing.
- [ ] MDX Layout `<slot />` AST injection.
- [ ] Built-in MDX Component library (`<NavMenu>`, `<Breadcrumbs>`, `<Search>`, `<TagCloud>`, `<RecentPosts>`, `<PostNav>`, `<RelatedPosts>`, `<TableOfContents>`, `<Include>`, `<SyndicationLinks>`, `<Figure>`, `<Mermaid>`, `<Latex>`, `<Enclosure>`).
- [ ] File watcher / S3 poller indexer.
- [ ] LRU cache integration.

### Phase 3: Inbound Auth & Micropub (1 week)

- [ ] IndieAuth OAuth2 endpoints.
- [ ] `POST /micropub` JSON parser and HTML-to-MDX converter.
- [ ] Trigger immediate indexer re-scan on write.

### Phase 4: Smolnet Protocols (1 week)

- [ ] Gemini (TLS, status codes, list flattening).
- [ ] Gopher (menus, selectors).
- [ ] Spartan (port 300, `host path length` format).
- [ ] NEX (headerless), Text Protocol (DNS-SD), Finger (pulls from global config).

### Phase 5: Syndication & Federation (1 week)

- [ ] Outbound OAuth setup flow for Mastodon/Bluesky.
- [ ] POSSE Bridge (Create/Update/Delete) with SQLite state tracking.
- [ ] ActivityPub WebFinger, Actor, and static Outbox.
- [ ] [standard.site](https://standard.site) record publishing to ATProto.
- [ ] Textcasting RSS 2.0 conformance (CDATA, RFC 822, stable GUIDs, Enclosure extraction).

### Phase 6: CI/CD, Docs & Polish (3 days)

- [ ] Write unit/integration tests (Vitest) for all parsers and servers.
- [ ] Configure GitHub Actions for linting, testing, and NPM publishing.
- [ ] Write Dockerfile and publish to Docker Hub/GHCR.
- [ ] Build VitePress documentation site.
- [ ] Canonical URL enforcement across all renderers.

### Phase 7: Comment Moderation, Scheduled Publishing, Archives & Deployment Flexibility (1 week)

- [ ] **Comment moderation & blocklists**
  - Rename/extend the existing spam-management API (`src/api/moderation.ts`) into a general **comments API**.
  - Add `comments.blocklist` config keys: `handles`, `domains`, and `ips`.
  - Enforce the blocklist during inbound Webmention/Pingback/Trackback processing.
  - Add moderation endpoints: `GET /api/comments`, `POST /api/comments/:id/hide`, `POST /api/comments/:id/unhide`, `POST /api/comments/:id/spam`, `POST /api/comments/:id/ham`, `DELETE /api/comments/:id`.
  - Add blocklist endpoints: `GET /api/blocklist`, `POST /api/blocklist`, `DELETE /api/blocklist`.
  - Update the `Comments` resolver to exclude hidden and deleted comments from rendered output.
  - Protect all moderation endpoints with IndieAuth bearer tokens.
  - Write unit and E2E tests for blocklist matching and moderation state changes.

- [ ] **Scheduled publishing**
  - The existing `date` frontmatter already determines the post's canonical publication date; add `publishAt` frontmatter (ISO 8601 date/time) to control when a post becomes publicly visible.
  - Filter future-dated documents (where `publishAt` or, if absent, `date` is in the future) out of `listDocSlugs`, `getDocBySlug`, RSS, and archive queries until the publish time is reached.
  - Add a lightweight scheduled re-index trigger (workmatic or interval) to publish posts automatically when their `publishAt` time arrives.
  - Ensure private/future posts return 404 across HTTP and smolnet protocols.
  - Write unit and E2E tests for future-date filtering and auto-publication.

- [ ] **Archive routes, templates, and components**
  - Add `order` frontmatter field for manual sorting of pages within a collection and at the page root.
  - Add routes: `/blog/archive/:year`, `/blog/archive/:year/:month`, `/blog/:taxonomy/:term`, `/:collection/:taxonomy/:term`.
  - Add components: `<Archive />`, `<PostList />`.
  - Add templates: `templates/archive.mdx`, `templates/taxonomy.mdx`, `templates/author.mdx`.
  - Add database queries for year/month, taxonomy term, author, and manual `order` filtering/sorting.
  - Render archive pages through the existing IR pipeline so all protocols can serve them.
  - Write unit and E2E tests for archive routing, taxonomy routing, and component output.

- [ ] **Docker Compose deployment examples**
  - Create `docker-compose.yml` (local storage + mounted `config.yml`).
  - Create `docker-compose.s3.yml` (S3 storage + mounted `config.yml`).
  - Create `docker-compose.env.yml` (local storage + environment variables).
  - Create `docker-compose.s3.env.yml` (S3 storage + environment variables).
  - Ensure `config.yml` supports `${VAR}` substitution from `.env` files or the process environment.
  - Document the compose variants in `docs/deployment.md`.
  - Add a CI smoke test that validates at least one compose file with `docker compose config`.
