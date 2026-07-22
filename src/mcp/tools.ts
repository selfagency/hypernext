import type { HypernextConfig } from "../types/config.js";
import { createDocumentTools } from "./tools-documents.js";
import { createEmailTools } from "./tools-email.js";
import { createModerationTools } from "./tools-moderation.js";
import { createSyncTools } from "./tools-sync.js";

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
    ...createDocumentTools(),
    ...createSyncTools(config),
    ...createModerationTools(),
    ...createEmailTools(config),
  ];

  // Add IPFS tools if IPFS is enabled
  if (config.ipfs?.enabled) {
    tools.push({
      name: "get_doc_cid",
      description: "Get the IPFS CIDs (content and HTML cache) for a document",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string", description: "Document slug" } },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const { getDocCids } = await import("../storage/ipfs.js");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await getDocCids(slug), null, 2),
            },
          ],
        };
      },
    });

    tools.push({
      name: "pin_doc",
      description: "Pin a document and its rendered HTML to IPFS",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Document slug to pin" },
        },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        const { pinDoc } = await import("../storage/ipfs.js");
        const result = await pinDoc(config, slug);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "pinned", slug, ...result },
                null,
                2
              ),
            },
          ],
        };
      },
    });
  }

  // Add AI-powered tools if AI is enabled
  if (config.agent?.enabled && config.ai?.enabled) {
    tools.push({
      name: "talk_to_docs",
      description:
        "Ask a natural language question and get an answer based on your documents using semantic search and RAG.",
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
        return {
          content: [{ type: "text", text: await ragSearch(config, query) }],
        };
      },
    });
  }

  return tools;
}
