# Customization

## Configuration

The `config.yml` file controls all aspects of Hypernext.

### Site Metadata

```yaml
site:
  canonicalBase: "https://example.com"
  meta:
    title: "My Site"
    description: "A Hypernext-powered site"
    lang: "en"
  theme:
    cssPath: "./assets/style.css"
  pdf:
    enabled: true
    cssPath: "./assets/pdf-style.css"
  ebooks:
    enabled: true
```

### Custom Metadata Fields

Define custom metadata fields in `site.metadata`:

```yaml
site:
  metadata:
    - name: readTime
      label: "Reading Time"
      type: number
    - name: difficulty
      label: "Difficulty"
      type: string
      options: [beginner, intermediate, advanced]
    - name: featured
      label: "Featured"
      type: boolean
```

Use in frontmatter:

```yaml
---
title: My Post
metadata:
  readTime: 5
  difficulty: beginner
  featured: true
---
```

Use in content with template tags:

```
Read time: {{ metadata.readTime }} minutes
```

### Collections

```yaml
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
```

### Layout Templates

*Planned — not yet implemented.*

Templates will be MDX files in the `templates/` directory that wrap document content.
All renderers (HTTP, Gemini, Gopher, etc.) will consume the same common templates and
translate them into each protocol's format.

The planned template system uses `<slot />` to inject post content:

```mdx
<NavMenu />

# {frontmatter.title}

<slot />

<PostNav />
```

## Components

Built-in MDX components are resolved at the parser level (MDX → AST → IR) and included
in the Intermediate Representation that all renderers consume. They work **inline in
document content**, not as layout wrappers (templates are a planned feature above).

Built-in components:

- `<NavMenu />` — Site navigation
- `<Breadcrumbs />` — Breadcrumb trail
- `<RecentPosts limit={5} />` — Recent posts list
- `<PostNav />` — Previous/next navigation
- `<RelatedPosts limit={3} />` — Related posts by tags
- `<TagCloud />` — Tag cloud
- `<TableOfContents depth={3} />` — Table of contents
- `<AuthorBio />` — Author information
- `<SyndicationLinks />` — Syndication links
- `<Figure src="..." caption="..." />` — Figure with caption
- `<Mermaid chart="..." />` — Mermaid diagram
- `<Latex math="..." />` — LaTeX math
- `<Enclosure url="..." title="..." />` — File download link
- `<Include src="/library/header" />` — Include another document
