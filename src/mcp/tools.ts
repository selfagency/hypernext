import { getDocBySlug, listDocSlugs, searchDocs } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { HypernextConfig } from "../types/config.js";

export interface McpTool {
  description: string;
  handler: (
    args: Record<string, unknown>
  ) => Promise<{ content: { type: string; text: string }[] }>;
  inputSchema: Record<string, unknown>;
  name: string;
}

export function createTools(config: HypernextConfig): McpTool[] {
  return [
    {
      name: "search_docs",
      description: "Search documents using FTS5 full-text search",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 20)" },
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
      name: "get_doc_markdown",
      description: "Get a document rendered as Markdown by slug",
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
        return { content: [{ type: "text", text: md }] };
      },
    },
    {
      name: "list_collections",
      description: "List all configured collections and their document counts",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async handler() {
        const collections = Object.keys(config.collections);
        const result: Record<string, { path: string; count: number }> = {};
        for (const name of collections) {
          const prefix = `${name}/`;
          const slugs = (await listDocSlugs()).filter((s) =>
            s.startsWith(prefix)
          );
          result[name] = {
            path: config.collections[name].path,
            count: slugs.length,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    },
  ];
}
