import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";
import { createTools } from "./tools.js";

// Track active SSE transports by session ID
const sseTransports = new Map<string, SSEServerTransport>();

export function startMcpServer(config: HypernextConfig): void {
  if (!config.mcp.enabled) {
    return;
  }

  const server = createMcpServer(config);

  if (config.mcp.transport === "stdio") {
    const transport = new StdioServerTransport();
    server.connect(transport);
    console.log("MCP server active (stdio)");
  }
}

export function registerMcpSseTransport(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  if (!config.mcp.enabled || config.mcp.transport !== "sse") {
    return;
  }

  const server = createMcpServer(config);

  // GET /api/v1/mcp — establish SSE stream
  fastify.get("/api/v1/mcp", async (_request, reply) => {
    const transport = new SSEServerTransport("/api/v1/mcp/message", reply.raw);
    console.log(`MCP server active (SSE, session ${transport.sessionId})`);
    // Track by session ID so POST handler can find it
    sseTransports.set(transport.sessionId, transport);
    transport.onclose = () => {
      sseTransports.delete(transport.sessionId);
    };
    await server.connect(transport);
  });

  // POST /api/v1/mcp/message — receive client messages
  fastify.post("/api/v1/mcp/message", async (request, reply) => {
    const sessionId = (request.query as Record<string, string | undefined>)
      .sessionId;
    if (!sessionId) {
      reply.code(400).send({ error: "Missing sessionId" });
      return;
    }
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      reply.code(404).send({ error: "No SSE session found" });
      return;
    }
    await transport.handlePostMessage(request.raw, reply.raw);
  });
}

function createMcpServer(config: HypernextConfig): Server {
  const server = new Server(
    { name: "hypernext", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const tools = createTools(config);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    return tool.handler(request.params.arguments ?? {});
  });

  return server;
}
