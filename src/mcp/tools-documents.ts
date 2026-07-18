import { DocMeta } from "../database/entities/doc-meta.js";
import { Term } from "../database/entities/term.js";
import { TermRelationship } from "../database/entities/term-relationship.js";
import { getDocBySlug, listDocSlugs, searchDocs } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { McpTool } from "./tools.js";

export function createDocumentTools(): McpTool[] {
  return [
    {
      name: "search_docs",
      description: "Search documents using FTS5 full-text search",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 20)" },
          type: { type: "string", description: "Filter by type (post/page)" },
        },
        required: ["query"],
      },
      async handler(args) {
        const query = String(args.query ?? "");
        const limit = Number(args.limit) || 20;
        const results = await searchDocs(query, limit);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      },
    },
    {
      name: "list_docs",
      description: "List documents by collection or tag",
      inputSchema: {
        type: "object",
        properties: {
          collection: {
            type: "string",
            description: "Collection name (blog/library)",
          },
          tag: { type: "string", description: "Filter by tag slug" },
        },
      },
      async handler(args) {
        const collection = String(args.collection ?? "");
        const tag = String(args.tag ?? "");
        let slugs = await listDocSlugs();
        if (collection) {
          slugs = slugs.filter((s) => s.startsWith(`${collection}/`));
        }
        if (tag) {
          const em = (await import("../database/index.js")).getEm();
          const term = await em.findOne(Term, { slug: tag });
          if (term) {
            const rels = await em.find(TermRelationship, { termId: term.id });
            const docIds = new Set(
              rels.map((r: Record<string, unknown>) => r.docId as number)
            );
            const docs = await em.find(
              DocMeta,
              { id: { $in: [...docIds] } },
              { fields: ["slug"] }
            );
            slugs = docs.map((d: Record<string, unknown>) => d.slug as string);
          } else {
            slugs = [];
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(slugs, null, 2) }],
        };
      },
    },
    {
      name: "read_doc",
      description:
        "Read a document by slug — returns frontmatter, raw markdown, and rendered HTML",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Document slug (e.g. blog/my-post)",
          },
        },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const doc = await getDocBySlug(slug);
        if (!doc) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: "Not found" }) },
            ],
          };
        }
        const rawMdx = (doc.rawMdx as string) ?? "";
        const result = parseToIR(rawMdx, slug);
        const md = renderMarkdown(result.ir);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                frontmatter: result.frontmatter,
                markdown: md,
                rawMdx,
              }),
            },
          ],
        };
      },
    },
    {
      name: "create_doc",
      description: "Create a new MDX document",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Document slug (e.g. blog/my-post)",
          },
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Markdown body content" },
          type: { type: "string", description: "Document type (post/page)" },
          tags: { type: "string", description: "Comma-separated tags" },
        },
        required: ["slug", "title", "content"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const title = String(args.title ?? "");
        const content = String(args.content ?? "");
        const docType = String(args.type ?? "post");
        const tags = String(args.tags ?? "");
        const date = new Date().toISOString();
        const tagStr = tags
          ? `tags: [${tags
              .split(",")
              .map((t) => `"${t.trim()}"`)
              .join(", ")}]`
          : "";
        const mdxContent = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\ntype: ${docType}\n${tagStr}\n---\n\n${content}`;
        const { writeStorage } = await import("../storage/index.js");
        await writeStorage(slug, mdxContent);
        return {
          content: [{ type: "text", text: `Document ${slug} created.` }],
        };
      },
    },
    {
      name: "update_doc",
      description: "Update an existing MDX document's body content",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Document slug" },
          content: { type: "string", description: "New markdown body content" },
        },
        required: ["slug", "content"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const content = String(args.content ?? "");
        const { writeStorage } = await import("../storage/index.js");
        await writeStorage(slug, content);
        return {
          content: [{ type: "text", text: `Document ${slug} updated.` }],
        };
      },
    },
    {
      name: "delete_doc",
      description: "Delete a document",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Document slug to delete" },
        },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const { deleteStorage } = await import("../storage/index.js");
        await deleteStorage(slug);
        return {
          content: [{ type: "text", text: `Document ${slug} deleted.` }],
        };
      },
    },
  ];
}
