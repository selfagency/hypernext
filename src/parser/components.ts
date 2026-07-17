import {
  getDocBySlug,
  getEm,
  getTermsForDoc,
  listDocSlugs,
} from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import type { IrNode } from "./ir.js";
import { parseToIR } from "./pipeline.js";

export interface ComponentContext {
  body?: string;
  config: HypernextConfig;
  currentDocId?: number;
  currentSlug?: string;
}

export type ComponentResolver = (
  props: Record<string, unknown>,
  ctx: ComponentContext
) => IrNode[] | Promise<IrNode[]>;

function textNode(value: string): IrNode {
  return { type: "text", value };
}

function linkNode(url: string, children: IrNode[]): IrNode {
  return { type: "link", url, children };
}

function listNode(ordered: boolean, children: IrNode[]): IrNode {
  return { type: "list", ordered, children };
}

function listItemNode(children: IrNode[]): IrNode {
  return { type: "listItem", children };
}

function paragraphNode(children: IrNode[]): IrNode {
  return { type: "paragraph", children };
}

const MAX_INCLUDE_DEPTH = 5;
const includeStack = new Set<string>();
const LEADING_SLASH_REGEX = /^\//;
const MDX_EXTENSION_REGEX = /\.mdx$/;

export const COMPONENT_RESOLVERS: Record<string, ComponentResolver> = {
  NavMenu() {
    return [
      paragraphNode([
        linkNode("/", [textNode("Home")]),
        textNode(" · "),
        linkNode("/blog/", [textNode("Blog")]),
        textNode(" · "),
        linkNode("/library/", [textNode("Library")]),
      ]),
    ];
  },

  Breadcrumbs(_props, ctx) {
    if (!ctx.currentSlug) {
      return [];
    }
    const parts = ctx.currentSlug.split("/");
    const crumbs: IrNode[] = [];
    let accumulated = "";
    for (const part of parts) {
      accumulated += `/${part}`;
      crumbs.push(linkNode(accumulated, [textNode(part)]));
      crumbs.push(textNode(" / "));
    }
    crumbs.pop(); // remove trailing separator
    return [paragraphNode(crumbs)];
  },

  Search() {
    return [
      paragraphNode([
        {
          type: "component",
          componentName: "Search",
          componentProps: {},
        } as IrNode,
      ]),
    ];
  },

  async TagCloud() {
    const em = getEm();
    const terms = await em
      .getConnection()
      .execute<{ taxonomy: string; slug: string; name: string }[]>(
        "SELECT DISTINCT taxonomy, slug, name FROM terms ORDER BY name"
      );
    if (terms.length === 0) {
      return [paragraphNode([textNode("No tags yet.")])];
    }
    return [
      paragraphNode(
        terms
          .map((t) => linkNode(`/${t.taxonomy}/${t.slug}`, [textNode(t.name)]))
          .flatMap((n, i) => (i < terms.length - 1 ? [n, textNode(" ")] : [n]))
      ),
    ];
  },

  async RecentPosts(props) {
    const limit = Number(props.limit) || 5;
    const slugs = (await listDocSlugs()).slice(0, limit);
    if (slugs.length === 0) {
      return [paragraphNode([textNode("No posts yet.")])];
    }
    const items: IrNode[] = [];
    for (const slug of slugs) {
      const doc = await getDocBySlug(slug);
      items.push(
        listItemNode([linkNode(`/${slug}`, [textNode(doc?.title ?? slug)])])
      );
    }
    return [listNode(false, items)];
  },

  async PostNav(_props, ctx) {
    if (!ctx.currentSlug) {
      return [];
    }
    const allSlugs = await listDocSlugs();
    const idx = allSlugs.indexOf(ctx.currentSlug);
    if (idx === -1) {
      return [];
    }
    const nav: IrNode[] = [];
    if (idx > 0) {
      const prev = allSlugs[idx - 1];
      const doc = await getDocBySlug(prev);
      nav.push(linkNode(`/${prev}`, [textNode(`← ${doc?.title ?? prev}`)]));
    }
    if (idx < allSlugs.length - 1) {
      const next = allSlugs[idx + 1];
      const doc = await getDocBySlug(next);
      if (nav.length > 0) {
        nav.push(textNode(" · "));
      }
      nav.push(linkNode(`/${next}`, [textNode(`${doc?.title ?? next} →`)]));
    }
    return [paragraphNode(nav)];
  },

  async RelatedPosts(props, ctx) {
    if (!ctx.currentDocId) {
      return [];
    }
    const limit = Number(props.limit) || 3;
    const terms = await getTermsForDoc(ctx.currentDocId, "tags");
    if (terms.length === 0) {
      return [paragraphNode([textNode("No related posts.")])];
    }
    const termIds = terms.map((t) => t.id);
    const placeholders = termIds.map(() => "?").join(",");
    const em = getEm();
    const related = await em
      .getConnection()
      .execute<{ slug: string; title: string }[]>(
        `SELECT DISTINCT m.slug, m.title FROM docs_meta m
       JOIN term_relationships tr ON tr.doc_id = m.id
       WHERE tr.term_id IN (${placeholders}) AND m.id != ?
       ORDER BY m.date DESC
       LIMIT ?`,
        [...termIds, ctx.currentDocId, limit]
      );
    if (related.length === 0) {
      return [paragraphNode([textNode("No related posts.")])];
    }
    return [
      listNode(
        false,
        related.map((r) =>
          listItemNode([linkNode(`/${r.slug}`, [textNode(r.title)])])
        )
      ),
    ];
  },

  TableOfContents(props, ctx) {
    if (!ctx.body) {
      return [];
    }
    const result = parseToIR(ctx.body);
    const headings =
      result.ir.children?.filter((n) => n.type === "heading") ?? [];
    if (headings.length === 0) {
      return [];
    }
    const maxDepth = Number(props.depth) || 3;
    return [
      listNode(
        false,
        headings
          .filter((h) => (h.depth ?? 1) <= maxDepth)
          .map((h) => {
            const text = h.children?.map((c) => c.value ?? "").join("") ?? "";
            const anchor = text
              .toLowerCase()
              .replace(/\s+/g, "-")
              .replace(/[^\w-]/g, "");
            return listItemNode([linkNode(`#${anchor}`, [textNode(text)])]);
          })
      ),
    ];
  },

  async Include(props, _ctx) {
    const src = String(props.src ?? "");
    if (!src) {
      return [];
    }
    if (includeStack.has(src)) {
      return [paragraphNode([textNode(`[Circular include: ${src}]`)])];
    }
    if (includeStack.size >= MAX_INCLUDE_DEPTH) {
      return [];
    }
    includeStack.add(src);
    try {
      const doc = await getDocBySlug(
        src.replace(LEADING_SLASH_REGEX, "").replace(MDX_EXTENSION_REGEX, "")
      );
      if (!doc) {
        return [paragraphNode([textNode(`[Include not found: ${src}]`)])];
      }
      const rawMdx = doc.rawMdx ?? "";
      const result = parseToIR(rawMdx, src);
      return result.ir.children ?? [];
    } finally {
      includeStack.delete(src);
    }
  },

  AuthorBio(_props, ctx) {
    const { author } = ctx.config;
    const bio: IrNode[] = [];
    if (author.photo) {
      bio.push({ type: "image", url: author.photo, alt: author.name });
    }
    bio.push(textNode(author.name));
    if (author.bio) {
      bio.push(textNode(` — ${author.bio}`));
    }
    if (author.url) {
      bio.push(textNode(" "));
      bio.push(linkNode(author.url, [textNode("Website")]));
    }
    return [paragraphNode(bio)];
  },

  async SyndicationLinks(_props, ctx) {
    if (!ctx.currentDocId) {
      return [];
    }
    const em = getEm();
    const records = await em
      .getConnection()
      .execute<{ platform: string; url: string }[]>(
        "SELECT platform, url FROM syndication WHERE doc_id = ? ORDER BY published_at DESC",
        [ctx.currentDocId]
      );
    if (records.length === 0) {
      return [];
    }
    return [
      paragraphNode([
        textNode("Also published on: "),
        ...records.flatMap((r, i) => {
          const nodes: IrNode[] = [linkNode(r.url, [textNode(r.platform)])];
          if (i < records.length - 1) {
            nodes.push(textNode(", "));
          }
          return nodes;
        }),
      ]),
    ];
  },

  Figure(props) {
    const src = String(props.src ?? "");
    const caption = String(props.caption ?? "");
    const children: IrNode[] = [];
    if (src) {
      children.push({ type: "image", url: src, alt: caption || src });
    }
    if (caption) {
      children.push(paragraphNode([textNode(caption)]));
    }
    return children;
  },

  Mermaid(props) {
    const chart = String(props.chart ?? "");
    return [{ type: "code", lang: "mermaid", value: chart }];
  },

  Latex(props) {
    const expr = String(props.math ?? "");
    return [{ type: "math", value: expr }];
  },

  Enclosure(props) {
    const url = String(props.url ?? "");
    const title = String(props.title ?? "Enclosure");
    const type = String(props.type ?? "application/octet-stream");
    return [
      paragraphNode([
        linkNode(url, [textNode(`📎 ${title}`)]),
        textNode(` (${type})`),
      ]),
    ];
  },

  async Archive(props, _ctx) {
    const filter = String(props.filter ?? "");
    const collection = String(props.collection ?? "");
    const limit = Number(props.limit) || 20;

    let slugs: string[] = [];

    if (filter.startsWith("year:")) {
      const year = Number(filter.split(":")[1]);
      if (!Number.isNaN(year)) {
        const { getArchiveDocs } = await import("../router.js");
        slugs = await getArchiveDocs(year);
      }
    } else if (filter.startsWith("tag:") || filter.startsWith("taxonomy:")) {
      const parts = filter.split(":");
      const taxonomy = parts[1] ?? "tags";
      const term = parts.slice(2).join(":");
      if (term) {
        const { getTaxonomyDocs } = await import("../router.js");
        slugs = await getTaxonomyDocs(taxonomy, term);
      }
    } else if (filter.startsWith("author:")) {
      const author = filter.split(":").slice(1).join(":");
      if (author) {
        const { getAuthorDocs } = await import("../router.js");
        slugs = await getAuthorDocs(author);
      }
    } else if (collection) {
      const { getCollectionDocs } = await import("../router.js");
      slugs = await getCollectionDocs(collection);
    }

    slugs = slugs.slice(0, limit);

    if (slugs.length === 0) {
      return [paragraphNode([textNode("No posts found.")])];
    }

    return [
      listNode(
        false,
        slugs.map((s) => {
          const display = s.split("/").pop() ?? s;
          return listItemNode([linkNode(`/${s}`, [textNode(display)])]);
        })
      ),
    ];
  },

  async PostList(props, _ctx) {
    const collection = String(props.collection ?? "");
    const limit = Number(props.limit) || 10;

    let slugs: string[];
    if (collection) {
      const { getCollectionDocs } = await import("../router.js");
      slugs = await getCollectionDocs(collection);
    } else {
      const { listDocSlugs } = await import("../database/index.js");
      slugs = await listDocSlugs();
    }

    slugs = slugs.slice(0, limit);

    if (slugs.length === 0) {
      return [paragraphNode([textNode("No posts found.")])];
    }

    return [
      listNode(
        false,
        slugs.map((s) => {
          const display = s.split("/").pop() ?? s;
          return listItemNode([linkNode(`/${s}`, [textNode(display)])]);
        })
      ),
    ];
  },

  async Comments(_props, ctx) {
    if (!ctx.currentSlug) {
      return [];
    }

    const em = getEm();
    const mentions = await em.getConnection().execute<
      {
        source_url: string;
        author_name: string;
        author_url: string;
        author_photo: string;
        content: string;
        published_at: number;
        platform: string;
      }[]
    >(
      `SELECT source_url, author_name, author_url, author_photo, content, published_at, platform
         FROM mentions
         WHERE target_slug = ? AND spam_status = 'ham' AND hidden = 0
         ORDER BY published_at ASC`,
      [ctx.currentSlug]
    );

    const children: IrNode[] = [
      { type: "heading", depth: 2, children: [textNode("Replies")] },
    ];

    if (mentions.length === 0) {
      children.push(paragraphNode([textNode("No replies yet.")]));
    }

    for (const mention of mentions) {
      children.push({
        type: "mention",
        sourceUrl: mention.source_url,
        authorName: mention.author_name,
        authorUrl: mention.author_url,
        authorPhoto: mention.author_photo,
        content: mention.content,
        publishedAt: new Date(mention.published_at).toISOString(),
        platform: mention.platform,
      });
    }

    return [
      {
        type: "section",
        className: "h-feed comments",
        id: "comments",
        children,
      },
    ];
  },
};

export function resolveComponent(
  name: string,
  props: Record<string, unknown>,
  ctx: ComponentContext
): IrNode[] | Promise<IrNode[]> {
  const resolver = COMPONENT_RESOLVERS[name];
  if (!resolver) {
    return [];
  }
  return resolver(props, ctx);
}
