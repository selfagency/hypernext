// fallow-ignore-file circular-dependency

import { resolveFederatedComments } from "../comments/federated/component.js";
import { resolveWalineComments } from "../comments/waline/component.js";
import {
  getDocBySlug,
  getEm,
  getTermsForDoc,
  listDocSlugs,
} from "../database/index.js";
import { schedule } from "../jobs/queue.js";
import { buildNav } from "../nav.js";
import type { HypernextConfig } from "../types/config.js";
import type { IrNode } from "./ir.js";

export interface ComponentContext {
  body?: string;
  config: HypernextConfig;
  currentDocId?: number;
  currentSlug?: string;
  frontmatter?: Record<string, unknown>;
  includeStack?: Set<string>;
  slug?: string;
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
const LEADING_SLASH_REGEX = /^\//;
const MDX_EXTENSION_REGEX = /\.mdx$/;

/** HTML elements allowed in MDX templates — these map to native HTML tags. */
const HTML_ELEMENTS = new Set([
  "a",
  "article",
  "aside",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "img",
  "input",
  "label",
  "li",
  "link",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "ul",
]);

export const ALLOWED_COMPONENTS = new Set([
  "NavMenu",
  "RecentPosts",
  "TableOfContents",
  "Include",
  "Mermaid",
  "Latex",
  "AuthorBio",
  "Enclosure",
  "Breadcrumbs",
  "Search",
  "TagCloud",
  "PostNav",
  "RelatedPosts",
  "SyndicationLinks",
  "Figure",
  "Comments",
  "Archive",
  "PostList",
  "IPFSLink",
  "PostMeta",
  "Title",
  "Header",
  "Main",
  "Sidebar",
  "Footer",
  "EmailSubscribe",
  "ContactForm",
  "WalineComments",
  "FederatedComments",
  "slot",
  ...HTML_ELEMENTS,
]);

export const COMPONENT_RESOLVERS: Record<string, ComponentResolver> = {
  async NavMenu(_props, ctx) {
    const nav = await buildNav(ctx.config);
    if (nav.length === 0) {
      return [linkNode("/", [textNode("Home")])];
    }
    const items: IrNode[] = [];
    for (const entry of nav) {
      items.push(listItemNode([linkNode(entry.href, [textNode(entry.label)])]));
    }
    return [
      {
        type: "nav",
        className: "nav-menu",
        children: [listNode(false, items)],
      },
    ];
  },

  Breadcrumbs(_props, ctx) {
    if (!ctx.currentSlug || ctx.currentSlug === "index") {
      return [];
    }
    const parts = ctx.currentSlug.split("/");
    const crumbs: IrNode[] = [];
    // First crumb always links to root
    crumbs.push(listItemNode([linkNode("/", [textNode("Home")])]));
    let accumulated = "";
    for (const part of parts) {
      accumulated += `/${part}`;
      const label = part;
      crumbs.push(listItemNode([linkNode(accumulated, [textNode(label)])]));
    }
    return [
      {
        type: "nav",
        className: "breadcrumbs",
        children: [listNode(false, crumbs)],
      },
    ];
  },

  Search() {
    return [
      {
        type: "section",
        className: "search",
        children: [linkNode("/search", [textNode("Search")])],
      },
    ];
  },

  async TagCloud(props) {
    const taxonomy = typeof props.taxonomy === "string" ? props.taxonomy : "";
    const em = getEm();
    let terms: { taxonomy: string; slug: string; name: string }[];
    if (taxonomy) {
      terms = await em
        .getConnection()
        .execute<{ taxonomy: string; slug: string; name: string }[]>(
          "SELECT DISTINCT taxonomy, slug, name FROM terms WHERE taxonomy = ? ORDER BY name",
          [taxonomy]
        );
    } else {
      terms = await em
        .getConnection()
        .execute<{ taxonomy: string; slug: string; name: string }[]>(
          "SELECT DISTINCT taxonomy, slug, name FROM terms ORDER BY name"
        );
    }
    if (terms.length === 0) {
      return [paragraphNode([textNode("No tags yet.")])];
    }
    return [
      paragraphNode(
        terms
          .map((t: { taxonomy: string; slug: string; name: string }) =>
            linkNode(`/${t.taxonomy}/${t.slug}`, [textNode(t.name)])
          )
          .flatMap((n: IrNode, i: number) =>
            i < terms.length - 1 ? [n, textNode(" ")] : [n]
          )
      ),
    ];
  },

  async RecentPosts(props) {
    const limit = Number(props.limit) || 5;
    const em = getEm();
    const docs = await em
      .getConnection()
      .execute<{ slug: string; title: string; date: string | null }[]>(
        `SELECT slug, title, date FROM docs_meta WHERE type = 'post' ORDER BY date DESC LIMIT ?`,
        [limit]
      );
    if (docs.length === 0) {
      return [paragraphNode([textNode("No posts yet.")])];
    }
    const items: IrNode[] = [];
    for (const doc of docs) {
      const linkText = doc.date
        ? `${doc.title} (${doc.date.slice(0, 10)})`
        : doc.title;
      items.push(
        listItemNode([linkNode(`/${doc.slug}`, [textNode(linkText)])])
      );
    }
    return [
      {
        type: "section",
        className: "recent-posts",
        children: [listNode(false, items)],
      },
    ];
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
      if (!prev) {
        return [];
      }
      const doc = await getDocBySlug(prev);
      nav.push(
        linkNode(`/${prev}`, [
          textNode(`← ${(doc?.title as string | undefined) ?? prev}`),
        ])
      );
    }
    if (idx < allSlugs.length - 1) {
      const next = allSlugs[idx + 1];
      if (!next) {
        return [];
      }
      const doc = await getDocBySlug(next);
      if (nav.length > 0) {
        nav.push(textNode(" · "));
      }
      nav.push(
        linkNode(`/${next}`, [
          textNode(`${(doc?.title as string | undefined) ?? next} →`),
        ])
      );
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
        related.map((r: { slug: string; title: string }) =>
          listItemNode([linkNode(`/${r.slug}`, [textNode(r.title)])])
        )
      ),
    ];
  },

  async TableOfContents(props, ctx) {
    if (!ctx.body) {
      return [];
    }
    const { parseToIR } = await import("./pipeline.js");
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

  async Include(props, ctx) {
    const src = String(props.src ?? "");
    if (!src) {
      return [];
    }
    const stack = ctx.includeStack ?? new Set<string>();
    if (stack.has(src)) {
      return [paragraphNode([textNode(`[Circular include: ${src}]`)])];
    }
    if (stack.size >= MAX_INCLUDE_DEPTH) {
      return [];
    }
    stack.add(src);
    try {
      const doc = await getDocBySlug(
        src
          .replace(LEADING_SLASH_REGEX, "")
          .replace(MDX_EXTENSION_REGEX, "") as string
      );
      if (!doc) {
        return [paragraphNode([textNode(`[Include not found: ${src}]`)])];
      }
      const rawMdx = (doc.rawMdx as string | undefined) ?? "";
      const { parseToIR } = await import("./pipeline.js");
      const result = parseToIR(rawMdx, src);
      return result.ir.children ?? [];
    } finally {
      stack.delete(src);
    }
  },

  AuthorBio(_props, ctx) {
    const { author } = ctx.config;
    const children: IrNode[] = [];
    if (author.photo) {
      children.push({ type: "image", url: author.photo, alt: author.name });
    }
    if (author.name) {
      children.push({
        type: "heading",
        depth: 2,
        children: [textNode(author.name)],
      });
    }
    if (author.bio) {
      children.push(paragraphNode([textNode(author.bio)]));
    }
    if (author.url) {
      children.push(
        paragraphNode([linkNode(author.url, [textNode("Website")])])
      );
    }
    return [{ type: "section", className: "h-card author-bio", children }];
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
        ...records.flatMap(
          (r: { platform: string; url: string }, i: number) => {
            const nodes: IrNode[] = [linkNode(r.url, [textNode(r.platform)])];
            if (i < records.length - 1) {
              nodes.push(textNode(", "));
            }
            return nodes;
          }
        ),
      ]),
    ];
  },

  Figure(props) {
    const src = typeof props.src === "string" ? props.src : "";
    const caption = typeof props.caption === "string" ? props.caption : "";
    const alt = typeof props.alt === "string" ? props.alt : caption;
    const children: IrNode[] = [];
    if (src) {
      children.push({ type: "image", url: src, alt: alt || src });
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

  async IPFSLink(_props, ctx) {
    if (!ctx.currentSlug) {
      return [];
    }
    const doc = await getDocBySlug(ctx.currentSlug);
    if (!doc) {
      return [];
    }
    const cid =
      (doc.htmlCid as string | null) ?? (doc.contentCid as string | null);
    if (!cid) {
      return [];
    }
    const gatewayUrl = ctx.config.ipfs?.gatewayUrl ?? "https://ipfs.io/ipfs";
    const url = `${gatewayUrl}/${cid}`;
    return [paragraphNode([linkNode(url, [textNode("View on IPFS")])])];
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
    const em = getEm();

    let docs: { slug: string; title: string; date: string | null }[];
    if (collection) {
      docs = await em
        .getConnection()
        .execute<{ slug: string; title: string; date: string | null }[]>(
          "SELECT slug, title, date FROM docs_meta WHERE slug LIKE ? ORDER BY date DESC LIMIT ?",
          [`${collection}/%`, limit]
        );
    } else {
      docs = await em
        .getConnection()
        .execute<{ slug: string; title: string; date: string | null }[]>(
          "SELECT slug, title, date FROM docs_meta ORDER BY date DESC LIMIT ?",
          [limit]
        );
    }

    if (docs.length === 0) {
      return [paragraphNode([textNode("No posts found.")])];
    }

    const items: IrNode[] = docs.map((doc) => {
      const text = doc.date
        ? `${doc.title} — ${doc.date.slice(0, 10)}`
        : doc.title;
      return listItemNode([linkNode(`/${doc.slug}`, [textNode(text)])]);
    });

    return [
      {
        type: "section",
        className: "post-list",
        children: [listNode(false, items)],
      },
    ];
  },

  async Header(_props, ctx) {
    const nav = await buildNav(ctx.config);
    const navItems = nav.map((entry) =>
      listItemNode([linkNode(entry.href, [textNode(entry.label)])])
    );
    return [
      {
        type: "header",
        className: "site-header",
        children: [
          {
            type: "heading",
            depth: 1,
            children: [linkNode("/", [textNode(ctx.config.site.meta.title)])],
          },
          { type: "component", componentName: "NavMenu", componentProps: {} },
          { type: "component", componentName: "Search", componentProps: {} },
          listNode(false, navItems),
        ],
      },
    ];
  },

  Main() {
    return [
      {
        type: "main",
        className: "main-content",
        children: [
          {
            type: "component",
            componentName: "Breadcrumbs",
            componentProps: {},
          },
          { type: "component", componentName: "slot", componentProps: {} },
        ],
      },
    ];
  },

  Sidebar() {
    return [
      {
        type: "aside",
        className: "sidebar",
        children: [
          { type: "heading", depth: 2, children: [textNode("Recent Posts")] },
          {
            type: "component",
            componentName: "RecentPosts",
            componentProps: {},
          },
          { type: "heading", depth: 2, children: [textNode("Tags")] },
          { type: "component", componentName: "TagCloud", componentProps: {} },
        ],
      },
    ];
  },

  Title(_props, ctx) {
    const slug = ctx.currentSlug;
    const fm = ctx.frontmatter ?? {};
    const title = (fm.title as string) ?? slug?.split("/").pop() ?? "Untitled";
    const postUrl = slug ? `/${slug}` : "/";
    return [
      {
        type: "heading",
        depth: 1,
        className: "p-name",
        children: [textNode(title)],
      },
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: postUrl,
            className: "u-url",
            children: [textNode("Permalink")],
          },
        ],
      },
    ];
  },

  PostMeta(_props, ctx) {
    const fm = ctx.frontmatter ?? {};
    const parts: IrNode[] = [];
    const author = ctx.config.author?.name;
    const date = fm.date as string | undefined;
    const tags = fm.tags as string[] | undefined;

    if (author) {
      parts.push({ type: "text", value: `by ${author}` });
    }
    if (author && (date || tags)) {
      parts.push({ type: "text", value: " / " });
    }
    if (date) {
      const d = new Date(date);
      const display = Number.isNaN(d.getTime())
        ? date
        : d.toISOString().slice(0, 10);
      parts.push({
        type: "time",
        value: display,
        datetime: date,
        className: "dt-published",
      });
    }
    if (date && tags && tags.length > 0) {
      parts.push({ type: "text", value: " / " });
    }
    if (tags && tags.length > 0) {
      const tagLinks = tags.flatMap((tag, i) => {
        const nodes: IrNode[] = [linkNode(`/tags/${tag}`, [textNode(tag)])];
        if (i < tags.length - 1) {
          nodes.push({ type: "text", value: ", " });
        }
        return nodes;
      });
      for (const node of tagLinks) {
        parts.push(node);
      }
    }

    if (parts.length === 0) {
      return [];
    }
    return [{ type: "paragraph", className: "byline", children: parts }];
  },

  Footer(_props, ctx) {
    const year = new Date().getFullYear();
    const site = ctx.config.site.meta.title;
    const url = ctx.config.site.canonicalBase;
    const author = ctx.config.author?.name;
    const bio = ctx.config.author?.bio;
    const lines: string[] = [site];
    if (author && author !== site) {
      lines.push(author);
    }
    const footerText = lines.join(" — ");
    const children: IrNode[] = [
      paragraphNode([textNode(`© ${year} ${footerText}`)]),
    ];
    if (bio) {
      children.push(paragraphNode([textNode(bio)]));
    }
    if (url) {
      children.push(paragraphNode([linkNode(url, [textNode(url)])]));
    }
    return [
      {
        type: "footer",
        className: "site-footer",
        children,
      },
    ];
  },

  EmailSubscribe() {
    return [
      {
        type: "component",
        componentName: "form",
        componentProps: {
          action: "/api/v1/subscribe",
          method: "POST",
          className: "email-subscribe",
        },
        children: [
          {
            type: "component",
            componentName: "h3",
            componentProps: {},
            children: [{ type: "text", value: "Subscribe to Newsletter" }],
          },
          {
            type: "component",
            componentName: "input",
            componentProps: {
              type: "email",
              name: "email",
              placeholder: "your@email.com",
              required: true,
            },
          },
          {
            type: "component",
            componentName: "button",
            componentProps: { type: "submit" },
            children: [{ type: "text", value: "Subscribe" }],
          },
        ],
      },
    ];
  },

  ContactForm() {
    return [
      {
        type: "component",
        componentName: "form",
        componentProps: {
          action: "/api/v1/contact",
          method: "POST",
          className: "contact-form",
        },
        children: [
          {
            type: "component",
            componentName: "h3",
            componentProps: {},
            children: [{ type: "text", value: "Contact Me" }],
          },
          {
            type: "component",
            componentName: "input",
            componentProps: {
              type: "text",
              name: "name",
              placeholder: "Your Name",
              required: true,
            },
          },
          {
            type: "component",
            componentName: "input",
            componentProps: {
              type: "email",
              name: "email",
              placeholder: "your@email.com",
              required: true,
            },
          },
          {
            type: "component",
            componentName: "textarea",
            componentProps: {
              name: "message",
              placeholder: "Your message...",
              required: true,
              rows: 5,
            },
          },
          {
            type: "component",
            componentName: "button",
            componentProps: { type: "submit" },
            children: [{ type: "text", value: "Send" }],
          },
        ],
      },
    ];
  },

  async Comments(_props, ctx) {
    if (!ctx.currentSlug) {
      return [];
    }

    // Trigger background POSSE reply fetch (fire-and-forget via job queue)
    if (ctx.config.comments?.aggregation) {
      schedule("posse-replies", {
        slug: ctx.currentSlug,
        mastodon: ctx.config.comments.aggregation.mastodon,
        bluesky: ctx.config.comments.aggregation.bluesky,
      }).catch(() => {
        // Non-critical — replies will be fetched on next page load
      });
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

  WalineComments(props, ctx) {
    // Convert to IR node and resolve via the Waline component resolver
    const node: IrNode = {
      type: "component",
      componentName: "WalineComments",
      componentProps: props,
      children: [],
    };
    return resolveWalineComments(ctx, node);
  },

  FederatedComments(props, ctx) {
    // Convert to IR node and resolve via the FederatedComments resolver
    const node: IrNode = {
      type: "component",
      componentName: "FederatedComments",
      componentProps: props,
      children: [],
    };
    return resolveFederatedComments(ctx, node);
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
