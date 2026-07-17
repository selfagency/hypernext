import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { HypernextConfig } from "../types/config.js";
import { createTools } from "./tools.js";

export function startMcpServer(config: HypernextConfig): void {
  if (!config.mcp.enabled) {
    return;
  }

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

  const transport = new StdioServerTransport();
  server.connect(transport);
}
