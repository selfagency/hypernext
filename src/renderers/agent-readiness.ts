import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";

const TRAILING_SLASH_REGEX = /\/+$/;

export function registerWellKnownEndpoints(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  if (!config.agent?.enabled) {
    return;
  }

  const base = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");

  // RFC 9727: API Catalog
  if (config.agent.wellKnown.apiCatalog) {
    fastify.get("/.well-known/api-catalog", (_request, reply) => {
      reply.send({
        apiCatalog: [
          {
            name: "Hypernext API",
            description:
              "REST API for document management, moderation, and stats",
            url: `${base}/api/v1/docs`,
            specUrl: `${base}/documentation/static/openapi.json`,
            statusUrl: `${base}/health`,
          },
        ],
      });
    });
  }

  // Agent Skills Discovery (v0.2.0)
  if (config.agent.wellKnown.agentSkills) {
    fastify.get("/.well-known/agent-skills/index.json", (_request, reply) => {
      reply.send({
        $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        skills: [
          {
            name: "content-management",
            type: "skill-md",
            description:
              "Create, update, and manage documents and posts on this Hypernext instance.",
            url: `${base}/.well-known/agent-skills/content-management/SKILL.md`,
            digest:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
          {
            name: "moderation",
            type: "skill-md",
            description: "Review and manage comments, spam, and blocklists.",
            url: `${base}/.well-known/agent-skills/moderation/SKILL.md`,
            digest:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
          {
            name: "search",
            type: "skill-md",
            description: "Search documents by keyword or full-text query.",
            url: `${base}/.well-known/agent-skills/search/SKILL.md`,
            digest:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
      });
    });
  }

  // MCP Server Card
  if (config.agent.wellKnown.mcpServerCard) {
    fastify.get("/.well-known/mcp/server-card.json", (_request, reply) => {
      reply.send({
        $schema:
          "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
        version: "1.0",
        protocolVersion: "2025-06-18",
        serverInfo: {
          name: "hypernext-mcp",
          title: "Hypernext MCP Server",
          version: "1.0.0",
        },
        description:
          "Manage documents, moderate comments, search content, and interact with a Hypernext publishing instance.",
        transport: {
          type: "streamable-http",
          endpoint: "/api/v1/mcp",
        },
        authentication: {
          required: true,
        },
        tools: [
          {
            name: "list_docs",
            title: "List Documents",
            description: "List documents with optional type and tag filters",
            inputSchema: {
              type: "object",
              properties: {
                type: { type: "string" },
                tag: { type: "string" },
                limit: { type: "number" },
              },
            },
          },
          {
            name: "search_docs",
            title: "Search Documents",
            description: "Full-text search across all documents",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                limit: { type: "number" },
              },
              required: ["query"],
            },
          },
          {
            name: "list_comments",
            title: "List Comments",
            description: "List comments with optional status and slug filters",
            inputSchema: {
              type: "object",
              properties: {
                status: { type: "string" },
                slug: { type: "string" },
                limit: { type: "number" },
              },
            },
          },
        ],
      });
    });
  }

  // Web Bot Auth: HTTP Message Signatures Directory
  if (config.agent.wellKnown.webBotAuth) {
    fastify.get(
      "/.well-known/http-message-signatures-directory",
      (_request, reply) => {
        reply.send({
          keys: [],
          description:
            "This site supports HTTP Message Signatures for automated traffic identification. Contact the site administrator to register your bot's public key.",
        });
      }
    );
  }

  // WebMCP
  if (config.agent.wellKnown.webmcp) {
    fastify.get("/.well-known/mcp.json", (_request, reply) => {
      reply.send({
        mcpServers: {
          hypernext: {
            url: `${base}/api/v1/mcp`,
            type: "sse",
          },
        },
      });
    });
  }
}
