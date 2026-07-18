import { getDocBySlug } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import { pushToRemote, syncTwoWay } from "../sync/sync-manager.js";
import type { HypernextConfig } from "../types/config.js";
import type { McpTool } from "./tools.js";

export function createSyncTools(config: HypernextConfig): McpTool[] {
  return [
    {
      name: "ingest_url",
      description:
        "Fetch a URL, convert to MDX via turndown, and save as a document",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch and convert" },
          collection: {
            type: "string",
            description: "Target collection (blog/library)",
          },
          filename: {
            type: "string",
            description: "Output filename without extension",
          },
          downloadMedia: {
            type: "boolean",
            description: "Download images and assets locally",
          },
        },
        required: ["url", "collection", "filename"],
      },
      async handler(args) {
        const { ingestUrlWithMeta } = await import(
          "../ingest/ingest-manager.js"
        );
        const payload = {
          url: String(args.url ?? ""),
          collection: String(args.collection ?? "library"),
          filename: String(args.filename ?? ""),
          downloadMedia: args.downloadMedia === true,
        };
        const result = await ingestUrlWithMeta(payload, config);
        const assetInfo =
          result.assets.length > 0
            ? ` (${result.assets.length} assets downloaded)`
            : "";
        return {
          content: [
            {
              type: "text",
              text: `Ingested ${payload.url} to ${result.slug}.mdx.${assetInfo}`,
            },
          ],
        };
      },
    },
    {
      name: "list_media",
      description: "List media assets in the assets directory",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const assetsDir = path.resolve("assets");
        if (!fs.existsSync(assetsDir)) {
          return { content: [{ type: "text", text: "[]" }] };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(fs.readdirSync(assetsDir), null, 2),
            },
          ],
        };
      },
    },
    {
      name: "push_remote",
      description: "Trigger one-way push to the production server",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        await pushToRemote(config, (msg) => console.error(msg));
        return { content: [{ type: "text", text: "Push complete." }] };
      },
    },
    {
      name: "sync_remote",
      description: "Trigger two-way sync between local and production",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        await syncTwoWay(config, (msg) => console.error(msg));
        return { content: [{ type: "text", text: "Two-way sync complete." }] };
      },
    },
    {
      name: "syndicate_doc",
      description: "Manually trigger POSSE syndication for a document",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Document slug to syndicate" },
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
        const { syndicate } = await import("../bridge/index.js");
        await syndicate(
          config,
          (doc.id as number) ?? 0,
          slug,
          (doc.rawMdx as string) ?? ""
        );
        return {
          content: [
            { type: "text", text: `Syndication triggered for ${slug}.` },
          ],
        };
      },
    },
    {
      name: "generate_format",
      description:
        "Generate and return a PDF or EPUB for a document/collection",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Document slug" },
          format: { type: "string", description: "Output format (pdf/epub)" },
        },
        required: ["slug", "format"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const format = String(args.format ?? "");
        if (format === "pdf") {
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
          const { mdToPdf } = await import("md-to-pdf");
          const pdf = await mdToPdf({ content: md });
          return {
            content: [
              {
                type: "text",
                text: `PDF generated for ${slug} (${pdf.content.length} bytes).`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Format ${format} not supported.` }],
        };
      },
    },
    {
      name: "list_collections",
      description: "List all configured collections and their document counts",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const { listDocSlugs } = await import("../database/index.js");
        const collections = Object.keys(config.collections);
        const result: Record<string, { path: string; count: number }> = {};
        for (const name of collections) {
          const prefix = `${name}/`;
          const slugs = (await listDocSlugs()).filter((s) =>
            s.startsWith(prefix)
          );
          const collection = config.collections[name];
          if (collection) {
            result[name] = { path: collection.path, count: slugs.length };
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    },
  ];
}
