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
    path.join(projectDir, "content", "blog", "hello-world.mdx"),
    generateSamplePost(),
    options.force
  );
  writeFile(
    projectDir,
    path.join(projectDir, "content", "about.mdx"),
    generateSamplePage(),
    options.force
  );

  // Agent skill
  if (!options.skipAgentSkill) {
    console.log("\nAgent skill:");
    setupAgentSkill(projectDir, options.force);
  }

  console.log(
    "\nDone! Edit config.yml and templates/ to customize your site.\nRun `npx hypernext` to start the server."
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

function generateSamplePost(): string {
  return `---
title: Hello World
date: 2026-07-20
type: post
tags: [hypernext, getting-started]
---

# Hello World

Welcome to your Hypernext site! This post is rendered across every protocol.

## Features

- Single MDX source for all protocols
- Auto-generated navigation from pages
- Layout templates with header, nav, breadcrumbs, footer
- h-entry microformats for Webmention support
- RSS feeds for collections
`;
}

function generateSamplePage(): string {
  return `---
title: About
order: 0
---

# About

This is a standalone page. Pages appear in the navigation menu ordered by the \`order\` frontmatter field.
`;
}
