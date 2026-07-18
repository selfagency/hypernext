import type { McpTool } from "./tools.js";

export function createModerationTools(): McpTool[] {
  return [
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
  ];
}
