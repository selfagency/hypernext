import type { McpTool } from "../../mcp/tools.js";
import type { HypernextConfig } from "../../types/config.js";

/**
 * Create Waline MCP tools.
 * Gated by comments.waline.enabled only (per D2 — not gated by agent.enabled).
 */
export function createWalineTools(config: HypernextConfig): McpTool[] {
  const walineConfig = config.comments?.waline;
  if (!walineConfig?.enabled) {
    return [];
  }

  const mode = walineConfig.mode ?? "embedded";
  const serverUrl =
    mode === "embedded"
      ? `http://127.0.0.1:${walineConfig.port ?? 8360}`
      : walineConfig.serverURL;

  return [
    {
      name: "waline_comments",
      description: `List comments from Waline for a given path. ${
        mode === "embedded"
          ? "Requires Waline server running."
          : `Uses external server: ${serverUrl}`
      }`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "URL path to fetch comments for (e.g., '/blog/my-post')",
          },
          page: {
            type: "number",
            description: "Page number (default: 1)",
          },
          limit: {
            type: "number",
            description: "Number of comments per page (default: 10)",
          },
        },
        required: ["path"],
      },
      async handler(args) {
        const path = String(args.path ?? "");
        if (!path) {
          return {
            content: [{ type: "text", text: "Error: path is required" }],
          };
        }

        const page = Number(args.page ?? 1);
        const limit = Number(args.limit ?? 10);

        try {
          const url = new URL("/api/comment", serverUrl);
          url.searchParams.set("type", "list");
          url.searchParams.set("path", path);
          url.searchParams.set("page", String(page));
          url.searchParams.set("limit", String(limit));

          const response = await fetch(url.toString(), {
            headers: { "Content-Type": "application/json" },
          });

          if (!response.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Waline API returned ${response.status}`,
                },
              ],
            };
          }

          const data = await response.json();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching comments: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },
    {
      name: "waline_moderate",
      description: `Moderate a Waline comment (approve, reject, or mark as spam). ${
        mode === "embedded"
          ? "Requires Waline server running."
          : `Uses external server: ${serverUrl}`
      }`,
      inputSchema: {
        type: "object",
        properties: {
          commentId: {
            type: "string",
            description: "Comment ID to moderate",
          },
          action: {
            type: "string",
            enum: ["approve", "reject", "spam"],
            description: "Moderation action",
          },
        },
        required: ["commentId", "action"],
      },
      async handler(args) {
        const commentId = String(args.commentId ?? "");
        const action = String(args.action ?? "");

        if (!commentId) {
          return {
            content: [{ type: "text", text: "Error: commentId is required" }],
          };
        }

        if (!["approve", "reject", "spam"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action must be approve, reject, or spam",
              },
            ],
          };
        }

        try {
          const url = new URL("/api/comment", serverUrl);
          const response = await fetch(url.toString(), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commentId,
              status: action === "approve" ? "approved" : action,
            }),
          });

          if (!response.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Waline API returned ${response.status}`,
                },
              ],
            };
          }

          const data = await response.json();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    commentId,
                    action,
                    ...(data as Record<string, unknown>),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error moderating comment: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },
    {
      name: "waline_count",
      description: `Get comment count for a path. ${
        mode === "embedded"
          ? "Requires Waline server running."
          : `Uses external server: ${serverUrl}`
      }`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "URL path to count comments for",
          },
        },
        required: ["path"],
      },
      async handler(args) {
        const path = String(args.path ?? "");
        if (!path) {
          return {
            content: [{ type: "text", text: "Error: path is required" }],
          };
        }

        try {
          const url = new URL("/api/comment", serverUrl);
          url.searchParams.set("type", "count");
          url.searchParams.set("path", path);

          const response = await fetch(url.toString(), {
            headers: { "Content-Type": "application/json" },
          });

          if (!response.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Waline API returned ${response.status}`,
                },
              ],
            };
          }

          const count = await response.json();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ path, count }, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching count: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },
    {
      name: "waline_status",
      description: `Check Waline server status. ${
        mode === "embedded"
          ? "Returns process status and comment counts."
          : `Checks connectivity to external server: ${serverUrl}`
      }`,
      inputSchema: {
        type: "object",
        properties: {},
      },
      async handler() {
        try {
          // Try to hit the health endpoint
          const url = new URL("/api/comment", serverUrl);
          url.searchParams.set("type", "count");
          url.searchParams.set("path", "__health");

          const response = await fetch(url.toString(), {
            headers: { "Content-Type": "application/json" },
          });

          // Waline returns 400 even when healthy for invalid paths like __health
          const isHealthy = response.status === 400;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    mode,
                    serverUrl,
                    status: isHealthy ? "healthy" : "unhealthy",
                    httpStatus: response.status,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    mode,
                    serverUrl,
                    status: "unreachable",
                    error: err instanceof Error ? err.message : String(err),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      },
    },
  ];
}
