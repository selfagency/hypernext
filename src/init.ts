import fs from "node:fs";
import path from "node:path";

import { DEFAULT_TEMPLATES } from "./constants/default-templates.js";

export interface InitOptions {
  force: boolean;
  skipAgentSkill: boolean;
}

function writeFile(
  projectDir: string,
  filePath: string,
  content: string,
  force: boolean
): void {
  const relative = path.relative(projectDir, filePath);
  if (fs.existsSync(filePath) && !force) {
    console.log(`  SKIP  ${relative} (exists, use --force to overwrite)`);
    return;
  }
  if (fs.existsSync(filePath) && force) {
    const backupPath = `${filePath}.bak`;
    fs.copyFileSync(filePath, backupPath);
    console.log(`  BACKUP ${relative} → ${path.basename(backupPath)}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  CREATE ${relative}`);
}

export function scaffoldInit(projectDir: string, options: InitOptions): void {
  console.log(`\nScaffolding Hypernext project in: ${projectDir}\n`);

  // Create directory structure
  console.log("Directories:");
  const dirs = [
    path.join(projectDir, "templates"),
    path.join(projectDir, "content"),
    path.join(projectDir, "content", "blog"),
    path.join(projectDir, "content", "notes"),
    path.join(projectDir, "db"),
  ];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      console.log(`  EXISTS ${path.relative(projectDir, dir)}/`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  CREATE ${path.relative(projectDir, dir)}/`);
    }
  }

  // Copy templates
  console.log("\nTemplates:");
  for (const tmpl of DEFAULT_TEMPLATES) {
    writeFile(
      projectDir,
      path.join(projectDir, "templates", tmpl.filename),
      tmpl.content,
      options.force
    );
  }

  // Config
  console.log("\nConfig:");
  writeFile(
    projectDir,
    path.join(projectDir, "config.yml"),
    generateDefaultConfig(),
    options.force
  );

  // .gitignore
  console.log("\nGit:");
  writeFile(
    projectDir,
    path.join(projectDir, ".gitignore"),
    generateGitignore(),
    options.force
  );

  // README
  console.log("\nDocs:");
  writeFile(
    projectDir,
    path.join(projectDir, "README.md"),
    generateReadme(path.basename(projectDir)),
    options.force
  );

  // Sample content
  console.log("\nSample content:");
  writeFile(
    projectDir,
    path.join(projectDir, "content", "blog", "getting-started.mdx"),
    generateGettingStartedPost(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "blog", "markdown-basics.mdx"),
    generateMarkdownBasicsPost(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "blog", "using-templates.mdx"),
    generateTemplatesPost(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "about.mdx"),
    generateAboutPage(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "projects.mdx"),
    generateProjectsPage(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "notes", "protocol-overview.mdx"),
    generateProtocolsNote(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "notes", "cli-reference.mdx"),
    generateCliNote(),
    options.force
  );

  // Agent skill
  if (!options.skipAgentSkill) {
    console.log("\nAgent skill:");
    setupAgentSkill(projectDir, options.force);
  }

  console.log(
    "\nDone! Edit config.yml and templates/ to customize your site.\nRun `hypernext serve --project .` to start the server."
  );
}

function setupAgentSkill(projectDir: string, force: boolean): void {
  const agentDir = path.join(projectDir, ".opencode", "context");
  writeFile(
    projectDir,
    path.join(agentDir, "core", "project-intelligence", "navigation.md"),
    "# Hypernext Project\n\nThis is a Hypernext multi-protocol document server.",
    force
  );
  writeFile(
    projectDir,
    path.join(agentDir, "core", "project-intelligence", "architecture.md"),
    `# Architecture

Hypernext is a TypeScript-based, multi-protocol Markdown document server. It transforms Markdown files (.md and .mdx) into a unified interface accessible via HTTP, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB.

## Key directories

- \`content/\` — MDX source files organized in collections (blog, library)
- \`templates/\` — Layout templates with <slot /> for content injection
- \`db/\` — SQLite database
- \`config.yml\` — Site configuration`,
    force
  );
}

function generateDefaultConfig(): string {
  return `# Hypernext Configuration
# See https://github.com/selfagency/hypernext for documentation

site:
  canonicalBase: "http://localhost:8080"
  meta:
    title: "My Hypernext Site"
    description: "A multi-protocol document server"
    lang: "en"
  pdf:
    enabled: false
  ebooks:
    enabled: false

author:
  name: "Author Name"
  bio: ""
  url: ""

storage:
  type: local
  local:
    path: "./content"

database:
  type: sqlite
  path: "./db/hypernext.db"

collections:
  blog:
    path: "/blog/"
    rss: true
    syndicate: false
    layout: "blog.mdx"
  notes:
    path: "/notes/"
    rss: false
    syndicate: false
    layout: "default.mdx"

taxonomies:
  - name: tags
    singular: tag
    plural: tags

protocols:
  http:
    enabled: true
    port: 8080
  gemini:
    enabled: false
    port: 1965
  gopher:
    enabled: false
    port: 70
  spartan:
    enabled: false
    port: 300
  nex:
    enabled: false
    port: 1900
  text:
    enabled: false
    port: 79
  finger:
    enabled: false
    port: 79

api:
  enabled: true

micropub:
  enabled: false

mcp:
  enabled: true
  transport: stdio

syndication: {}
`;
}

function generateGitignore(): string {
  return `# Database
db/

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*.swo

# Dependencies
node_modules/

# Build output
dist/
`;
}

function generateReadme(projectName: string): string {
  const contentSection = `- **\`content/blog/\`** — Blog posts (appear in RSS, recent posts, date-indexed archives)
- **\`content/\` root** — Standalone pages (appear in navigation, ordered by frontmatter order)
- **Any named subfolder** — User-defined collections (add to \`collections\` in \`config.yml\`)`;

  return `# ${projectName}

A Hypernext multi-protocol document server. Serves MDX content over HTTP, Gemini, Gopher, Spartan, NEX, Text, and Finger.

## Quick start

\`\`\`bash
npx hypernext
\`\`\`

Open http://localhost:8080 in your browser.

## Content

${contentSection}

Each file can include frontmatter:

\`\`\`mdx
---
title: My Post
date: 2026-07-20
type: post
tags: [example]
---

Your content here.
\`\`\`

## Templates

Edit \`templates/\` to customize the site layout. Templates use MDX with \`<slot />\` for content injection. Available components: \`NavMenu\`, \`Breadcrumbs\`, \`Search\`, \`RecentPosts\`, \`PostList\`, \`TagCloud\`, \`AuthorBio\`, \`Footer\`, \`Sidebar\`, \`Comments\`, \`PostNav\`, \`RelatedPosts\`, \`TableOfContents\`, \`Include\`, \`Figure\`, \`Enclosure\`, \`Mermaid\`, \`Latex\`, \`IPFSLink\`, \`SyndicationLinks\`.

## Protocols

| Protocol | Port | Default |
|----------|------|---------|
| HTTP     | 8080 | Enabled |
| Gemini   | 1965 | Disabled |
| Gopher   | 70   | Disabled |
| Spartan  | 300  | Disabled |
| NEX      | 1900 | Disabled |
| Text     | 79   | Disabled |
| Finger   | 79   | Disabled |

Enable protocols in \`config.yml\`.
`;
}

function generateGettingStartedPost(): string {
  return `---
title: Getting Started with Hypernext
date: 2026-07-20
type: post
tags: [hypernext, getting-started]
---

# Getting Started with Hypernext

Hypernext is a **multi-protocol document server** that transforms Markdown into a unified interface across HTTP, Gemini, Gopher, Spartan, NEX, Text Protocol, Finger, RSS, PDF, and EPUB.

## Quick Start

1. Create Markdown files in \`content/blog/\`
2. Add frontmatter with \`title\` and \`type: post\`
3. Start the server: \`hypernext serve\`
4. Visit http://localhost:8080

## Frontmatter

Each document supports YAML frontmatter for metadata:

\`\`\`yaml
---
title: My Post
date: 2026-07-20
type: post
tags: [guide, tutorial]
order: 0
visibility: public
---
\`\`\`

## Layout System

Documents are wrapped in layout templates. The \`layout\` field in frontmatter selects which template to use. Default layout applies if not specified.

## Next Steps

- Add more pages to \`content/\`
- Customize templates in \`templates/\`
- Edit \`config.yml\` for site settings
`;
}

function generateMarkdownBasicsPost(): string {
  return `---
title: Markdown Basics
date: 2026-07-19
type: post
tags: [markdown, guide]
---

# Markdown Basics

Hypernext supports standard Markdown with GitHub-flavored extensions and MDX components.

## Text Formatting

**Bold**, *italic*, ~~strikethrough~~, and \`inline code\`.

## Lists

1. Ordered item
2. Another item

- Unordered item
- Nested item

## Code Blocks

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Links & Images

[Link text](https://example.com)

![Alt text](/media/image.jpg)

## Tables

| Feature | HTTP | Gemini |
|---------|------|--------|
| Layout  |  ✅   |   ✅   |
| Nav     |  ✅   |   ✅   |
| Search  |  ✅   |   —    |

## MDX Components

Use built-in components in your posts:

- \`<RecentPosts limit={5} />\` — latest posts
- \`<TableOfContents />\` — section navigation
- \`<TagCloud />\` — tag index
- \`<PostMeta />\` — author, date, tags byline
`;
}

function generateTemplatesPost(): string {
  return `---
title: Customizing Templates
date: 2026-07-18
type: post
tags: [templates, customization]
---

# Customizing Templates

Templates control how your content appears across all protocols.

## Available Templates

- \`default.mdx\` — Base layout with header, main, footer
- \`blog.mdx\` — Blog layout with sidebar

## Template Structure

Templates use a \`<slot />\` element where document content is injected:

\`\`\`mdx
<Header />

<main>
  <Breadcrumbs />
  <slot />
</main>

<Footer />
\`\`\`

## Built-in Components

| Component | Description |
|-----------|-------------|
| \`<NavMenu />\` | Auto-generated navigation |
| \`<Breadcrumbs />\` | Current path breadcrumbs |
| \`<PostMeta />\` | Author, date, tags byline |
| \`<Title />\` | Page title with permalink |
| \`<Search />\` | Search page link |
| \`<RecentPosts />\` | Latest blog posts |
| \`<RelatedPosts />\` | Related content |
| \`<TagCloud />\` | Tag index |
| \`<TableOfContents />\` | Section navigation |

## Custom Components

You can create custom components by registering them in the component resolvers.
`;
}

function generateAboutPage(): string {
  return `---
title: About
order: 0
visibility: public
---

# About This Site

This site is powered by **Hypernext**, a multi-protocol Markdown document server and IndieWeb publishing engine.

## Features

- **Single source, many protocols** — Write once, publish everywhere
- **IndieWeb-ready** — Webmention, Micropub, ActivityPub, AT Protocol
- **POSSE syndication** — Cross-post to Mastodon, Bluesky
- **Full-text search** — Built-in SQLite FTS5
- **Email newsletters** — Subscriber management and digests
- **PDF & EPUB generation** — Export content as ebooks

## How It Works

Content is written as Markdown files with frontmatter metadata. On startup, Hypernext indexes all content and serves it across every protocol simultaneously — no build step, no static generation.
`;
}

function generateProjectsPage(): string {
  return `---
title: Projects
order: 1
visibility: public
---

# Projects

This is a page listing projects. Pages like this appear in the navigation menu ordered by the \`order\` frontmatter field.

## Adding Pages

Create a new \`.md\` or \`.mdx\` file in \`content/\` with frontmatter:

\`\`\`yaml
---
title: Page Title
order: 2
visibility: public
---
\`\`\`

The page will automatically appear in the navigation.
`;
}

function generateProtocolsNote(): string {
  return `---
title: Protocol Overview
date: 2026-07-20
type: note
tags: [protocols, reference]
---

# Protocol Overview

Hypernext serves content across **seven protocols** simultaneously.

## Web

- **HTTP** — Full HTML with layouts, navigation, search, RSS
- **REST API** — JSON API at \`/api/v1/\`
- **MCP** — Model Context Protocol at \`/api/v1/mcp\`

## Smolnet

- **Gemini** — Gemini protocol on port 1965 (TLS)
- **Gopher** — Gopher protocol on port 70
- **Spartan** — Spartan protocol on port 300
- **NEX** — NEX protocol on port 1900
- **Text Protocol** — Textcasting on port 5011
- **Finger** — Finger protocol on port 79

## Federation

- **ActivityPub** — \`/api/v1/activitypub/\`
- **AT Protocol** — Bluesky/atproto publishing
- **Webmention** — \`/webmention\`
- **Pingback/Trackback** — Legacy protocols
`;
}

function generateCliNote(): string {
  return `---
title: CLI Reference
date: 2026-07-20
type: note
tags: [cli, reference]
---

# CLI Reference

## Commands

- \`hypernext serve\` — Start all protocol servers
- \`hypernext init\` — Scaffold a new project
- \`hypernext push\` — Upload to production
- \`hypernext sync\` — Two-way sync
- \`hypernext ingest <url>\` — Import a URL

## Serve Flags

\`\`\`
--port <port>    Override HTTP port
--[no-]http      Enable/disable HTTP
--[no-]gemini    Enable/disable Gemini
--[no-]gopher    Enable/disable Gopher
--[no-]spartan   Enable/disable Spartan
--[no-]nex       Enable/disable NEX
--[no-]finger    Enable/disable Finger
--[no-]text      Enable/disable Text
--[no-]mcp       Enable/disable MCP
\`\`\`

## Environment Variables

All flags can be set via \`HYPERNEXT_*\` environment variables.
`;
}
