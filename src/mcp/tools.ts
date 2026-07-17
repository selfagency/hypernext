import { getDocBySlug, listDocSlugs, searchDocs } from "../database/index.js";
import { ingestUrl } from "../ingest/ingest-manager.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import { pushToRemote, syncTwoWay } from "../sync/sync-manager.js";
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
  const tools: McpTool[] = [
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
          const prefix = `${collection}/`;
          slugs = slugs.filter((s) => s.startsWith(prefix));
        }
        if (tag) {
          const em = (await import("../database/index.js")).getEm();
          const term = await em.findOne("Term", { slug: tag });
          if (term) {
            const rels = await em.find("TermRelationship", { termId: term.id });
            const docIds = new Set(
              rels.map((r: Record<string, unknown>) => r.docId as number)
            );
            const docs = await em.find(
              "DocMeta",
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
        const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${date}
type: ${docType}
${
  tags
    ? `tags: [${tags
        .split(",")
        .map((t) => `"${t.trim()}"`)
        .join(", ")}]`
    : ""
}
---

`;
        const mdxContent = frontmatter + content;
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
        },
        required: ["url", "collection", "filename"],
      },
      async handler(args) {
        const payload = {
          url: String(args.url ?? ""),
          collection: String(args.collection ?? "library"),
          filename: String(args.filename ?? ""),
        };
        const slug = await ingestUrl(payload, config);
        return {
          content: [
            { type: "text", text: `Ingested ${payload.url} to ${slug}.mdx.` },
          ],
        };
      },
    },
    {
      name: "list_media",
      description: "List media assets in the assets directory",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async handler() {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const assetsDir = path.resolve("assets");
        if (!fs.existsSync(assetsDir)) {
          return { content: [{ type: "text", text: "[]" }] };
        }
        const files = fs.readdirSync(assetsDir);
        return {
          content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
        };
      },
    },
    {
      name: "push_remote",
      description: "Trigger one-way push to the production server",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async handler() {
        await pushToRemote(config, (msg) => console.error(msg));
        return { content: [{ type: "text", text: "Push complete." }] };
      },
    },
    {
      name: "sync_remote",
      description: "Trigger two-way sync between local and production",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async handler() {
        await syncTwoWay(config, (msg) => console.error(msg));
        return { content: [{ type: "text", text: "Two-way sync complete." }] };
      },
    },
    {
      name: "list_mentions",
      description: "List inbound mentions for moderation",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Filter by target slug" },
          status: {
            type: "string",
            description: "Filter by status (pending/ham/spam)",
          },
        },
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Mention } = await import("../database/entities/mention.js");
        const slug = String(args.slug ?? "");
        const status = String(args.status ?? "");
        const em = getEm();
        const where: Record<string, unknown> = {};
        if (slug) {
          where.targetSlug = slug;
        }
        if (status) {
          where.spamStatus = status;
        }
        const mentions = await em.find(Mention, where, {
          orderBy: { publishedAt: "DESC" },
          limit: 50,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(mentions, null, 2) }],
        };
      },
    },
    {
      name: "moderate_mention",
      description: "Approve or reject a mention (set spam status)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mention ID" },
          status: {
            type: "string",
            description: "New status (ham/spam/pending)",
          },
        },
        required: ["id", "status"],
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Mention } = await import("../database/entities/mention.js");
        const id = String(args.id ?? "");
        const status = String(args.status ?? "");
        const em = getEm();
        const mention = await em.findOne(Mention, { id });
        if (!mention) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: "Not found" }) },
            ],
          };
        }
        mention.spamStatus = status;
        await em.flush();
        return {
          content: [
            { type: "text", text: `Mention ${id} updated to ${status}.` },
          ],
        };
      },
    },
    {
      name: "delete_mention",
      description: "Delete a mention",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mention ID to delete" },
        },
        required: ["id"],
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Mention } = await import("../database/entities/mention.js");
        const id = String(args.id ?? "");
        const em = getEm();
        const mention = await em.findOne(Mention, { id });
        if (!mention) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: "Not found" }) },
            ],
          };
        }
        await em.remove(mention).flush();
        return { content: [{ type: "text", text: `Mention ${id} deleted.` }] };
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
    {
      name: "list_subscribers",
      description: "List all email subscribers",
      inputSchema: {
        type: "object",
        properties: {
          frequency: {
            type: "string",
            description: "Filter by frequency (instant/weekly)",
          },
        },
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const frequency = String(args.frequency ?? "");
        const em = getEm();
        const where: Record<string, unknown> = {};
        if (frequency) {
          where.frequency = frequency;
        }
        const subs = await em.find(Subscriber, where, {
          orderBy: { subscribedAt: "DESC" },
          limit: 100,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(subs, null, 2) }],
        };
      },
    },
    {
      name: "add_subscriber",
      description: "Manually add a subscriber (bypasses opt-in)",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Email address" },
          frequency: {
            type: "string",
            description: "Frequency (instant/weekly)",
          },
        },
        required: ["email"],
      },
      async handler(args) {
        const crypto = await import("node:crypto");
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const email = String(args.email ?? "");
        const frequency = String(args.frequency ?? "instant");
        const em = getEm();
        const existing = await em.findOne(Subscriber, { email });
        if (existing) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Email already subscribed" }),
              },
            ],
          };
        }
        const sub = em.create(Subscriber, {
          id: crypto.randomUUID(),
          email,
          frequency: frequency === "weekly" ? "weekly" : "instant",
          verified: true,
          verificationToken: null,
          unsubscribeToken: crypto.randomBytes(32).toString("hex"),
          subscribedAt: Date.now(),
        });
        await em.flush();
        return {
          content: [{ type: "text", text: JSON.stringify(sub, null, 2) }],
        };
      },
    },
    {
      name: "delete_subscriber",
      description: "Remove a subscriber by email",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Email address to remove" },
        },
        required: ["email"],
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const email = String(args.email ?? "");
        const em = getEm();
        const sub = await em.findOne(Subscriber, { email });
        if (!sub) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Subscriber not found" }),
              },
            ],
          };
        }
        await em.remove(sub).flush();
        return {
          content: [{ type: "text", text: `Subscriber ${email} deleted.` }],
        };
      },
    },
    {
      name: "send_test_email",
      description: "Send a test email to verify SMTP configuration",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
        },
        required: ["to"],
      },
      async handler(args) {
        const to = String(args.to ?? "");
        const { sendTestEmail } = await import("../federation/email-tasks.js");
        await sendTestEmail(config, to);
        return {
          content: [{ type: "text", text: `Test email sent to ${to}.` }],
        };
      },
    },
  ];

  // Add AI-powered tools if AI is enabled
  if (config.ai?.enabled) {
    tools.push({
      name: "talk_to_docs",
      description:
        "Ask a natural language question and get an answer based on the content of your documents using semantic search and RAG.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Your question about the document content",
          },
        },
        required: ["query"],
      },
      async handler(args) {
        const query = String(args.query ?? "");
        const { ragSearch } = await import("../federation/ai-tasks.js");
        const answer = await ragSearch(config, query);
        return {
          content: [{ type: "text", text: answer }],
        };
      },
    });
  }

  return tools;
}
