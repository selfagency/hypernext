# Getting Started

## Installation

```bash
npm install -g @selfagency/hypernext
# or
pnpm add -g @selfagency/hypernext
```

## Creating a Site

```bash
hypernext init
cd my-site
```

This creates a `config.yml`, `content/` directory, and `assets/` directory.

## Writing Content

Create MDX files in `content/blog/` or `content/library/`:

```mdx
---
title: My First Post
date: 2026-07-16
type: post
tags: [hypernext, indieweb]
---

# Welcome!

<NavMenu />

This is my first post using Hypernext.

<AuthorBio />
```

## Starting the Server

```bash
hypernext serve
```

This starts all enabled protocol servers defined in `config.yml`. Use `--project` to specify a different project root:

```bash
hypernext serve --project /path/to/my-site
```

## Configuration

Edit `config.yml` to customize your site:

```yaml
site:
  canonicalBase: "https://example.com"
  meta:
    title: "My Site"
    description: "A Hypernext-powered site"
    lang: "en"
```
