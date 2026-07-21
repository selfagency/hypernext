import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerMcpSseTransport } from "../../src/mcp/index.js";
import { registerWellKnownEndpoints } from "../../src/renderers/agent-readiness.js";
import type { HypernextConfig } from "../../src/types/config.js";

// ── Test Configurations ────────────────────────────────────────────────────

const BASE_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:0",
    meta: { title: "MCP E2E", description: "MCP integration test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "MCP Tester" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
  },
  taxonomies: [],
  protocols: {
    http: { enabled: true, port: 0 },
    gemini: { enabled: false, port: 1965 },
    gopher: { enabled: false, port: 70 },
    spartan: { enabled: false, port: 300 },
    nex: { enabled: false, port: 1900 },
    finger: { enabled: false, port: 79 },
    text: { enabled: false, port: 5011 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: true, transport: "sse" },
};

const AGENT_CONFIG: HypernextConfig = {
  ...BASE_CONFIG,
  agent: {
    enabled: true,
    markdownNegotiation: true,
    llmsTxt: true,
    sitemap: true,
    linkHeaders: true,
    hiddenAgentDirective: true,
    viewTransitions: true,
    wellKnown: {
      apiCatalog: true,
      agentSkills: true,
      mcpServerCard: true,
      webBotAuth: true,
      webmcp: true,
    },
  },
};

const DISABLED_CONFIG: HypernextConfig = {
  ...BASE_CONFIG,
  agent: { enabled: false },
};

// ── Module-level constants ────────────────────────────────────────────────

const SESSION_ID_REGEX = /sessionId=([^&\s]+)/;
const JSON_REGEX = /json/;

// ── SSE Helpers ────────────────────────────────────────────────────────────

/**
 * Parse a single SSE block (delimited by \n\n) into event type and data.
 */
function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      data = line.slice(6);
    }
  }
  if (!(event || data)) {
    return null;
  }
  return { event, data };
}

/**
 * Returns a promise that rejects after the given timeout.
 */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`SSE read timed out after ${ms}ms`)), ms);
  });
}

/**
 * Establish an SSE connection to the MCP endpoint and return helpers for
 * reading events and cleanup.
 */
async function sseConnect(
  port: number,
  readTimeoutMs = 10_000
): Promise<{
  sessionId: string;
  readNextEvent: () => Promise<{ event: string; data: string } | null>;
  close: () => void;
}> {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readNextEvent(): Promise<{
    event: string;
    data: string;
  } | null> {
    while (true) {
      // Try to extract a complete SSE event from the buffer
      const sepIdx = buffer.indexOf("\n\n");
      if (sepIdx !== -1) {
        const block = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseSseBlock(block);
        if (parsed) {
          return parsed;
        }
        continue;
      }

      const result = await Promise.race([
        reader.read(),
        timeout(readTimeoutMs),
      ]);
      if (result.done) {
        return null;
      }
      buffer += decoder.decode(result.value, { stream: true });
    }
  }

  // Read the first event (must be "endpoint" containing sessionId)
  const endpointEvent = await readNextEvent();
  if (endpointEvent?.event !== "endpoint") {
    reader.cancel().catch(() => {
      /* expected */
    });
    throw new Error(
      `Expected SSE "endpoint" event, got ${endpointEvent?.event ?? "nothing"}`
    );
  }

  const match = endpointEvent.data.match(SESSION_ID_REGEX);
  const sessionId = match?.[1];
  if (!sessionId) {
    reader.cancel().catch(() => {
      /* expected */
    });
    throw new Error(
      `Could not extract sessionId from endpoint data: ${endpointEvent.data}`
    );
  }

  return {
    sessionId,
    readNextEvent,
    close: () => {
      reader.cancel().catch(() => {
        /* expected */
      });
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MCP Protocol E2E", () => {
  // ── MCP Discovery (well-known endpoints) ──────────────────────────────

  describe("MCP discovery", () => {
    it("GET /.well-known/mcp.json returns WebMCP server descriptor", async () => {
      const fastify = Fastify({ logger: false });
      registerWellKnownEndpoints(fastify, AGENT_CONFIG);
      await fastify.ready();

      const res = await fastify.inject({
        method: "GET",
        url: "/.well-known/mcp.json",
      });
      await fastify.close();

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(JSON_REGEX);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("mcpServers");
      const hypernext = body.mcpServers?.hypernext;
      expect(hypernext).toBeDefined();
      expect(hypernext).toHaveProperty("type", "sse");
      expect(hypernext).toHaveProperty("url");
      expect(hypernext.url).toContain("/api/v1/mcp");
    });

    it("GET /.well-known/mcp/server-card.json returns MCP server card", async () => {
      const fastify = Fastify({ logger: false });
      registerWellKnownEndpoints(fastify, AGENT_CONFIG);
      await fastify.ready();

      const res = await fastify.inject({
        method: "GET",
        url: "/.well-known/mcp/server-card.json",
      });
      await fastify.close();

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("protocolVersion");
      expect(body).toHaveProperty("serverInfo");
      expect(body.serverInfo).toHaveProperty("name", "hypernext-mcp");
      expect(body).toHaveProperty("tools");
      expect(Array.isArray(body.tools)).toBe(true);
      const toolNames = body.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("list_docs");
      expect(toolNames).toContain("search_docs");
    });

    it("returns 404 for well-known MCP routes when agent is disabled", async () => {
      const fastify = Fastify({ logger: false });
      registerWellKnownEndpoints(fastify, DISABLED_CONFIG);
      await fastify.ready();

      const res1 = await fastify.inject({
        method: "GET",
        url: "/.well-known/mcp.json",
      });
      const res2 = await fastify.inject({
        method: "GET",
        url: "/.well-known/mcp/server-card.json",
      });
      await fastify.close();

      expect(res1.statusCode).toBe(404);
      expect(res2.statusCode).toBe(404);
    });
  });

  // ── SSE Transport ─────────────────────────────────────────────────────

  describe("SSE transport", () => {
    let fastify: ReturnType<typeof Fastify>;
    let port: number;

    beforeAll(async () => {
      fastify = Fastify({ logger: false });
      registerMcpSseTransport(fastify, BASE_CONFIG);
      await fastify.listen({ port: 0, host: "127.0.0.1" });
      const addr = fastify.addresses()[0] as { port: number };
      port = addr.port;
    }, 15_000);

    afterAll(async () => {
      await fastify.close();
    }, 10_000);

    // ── Error handling ──────────────────────────────────────────────

    describe("error handling", () => {
      it("POST /api/v1/mcp/message without sessionId returns 400", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/v1/mcp/message",
          payload: { jsonrpc: "2.0", id: "1", method: "tools/list" },
        });

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty("error");
      });

      it("POST /api/v1/mcp/message with invalid sessionId returns 404", async () => {
        const res = await fastify.inject({
          method: "POST",
          url: "/api/v1/mcp/message?sessionId=nonexistent-session",
          payload: { jsonrpc: "2.0", id: "1", method: "tools/list" },
        });

        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty("error");
      });
    });

    // ── Tool execution via SSE ───────────────────────────────────────

    describe("tool execution", () => {
      beforeAll(async () => {
        const { initOrm, insertDoc } = await import(
          "../../src/database/index.js"
        );

        await initOrm(":memory:");

        await insertDoc({
          slug: "blog/hello",
          title: "Hello World",
          rawMdx: "# Hello\n\nWorld.",
        });
        await insertDoc({
          slug: "blog/typescript-tips",
          title: "TypeScript Tips",
          rawMdx: "# TypeScript Tips\n\nUse strict mode.",
        });
      }, 15_000);

      afterAll(async () => {
        const { closeOrm } = await import("../../src/database/index.js");
        await closeOrm();
      }, 10_000);

      // ── Tool list via SSE ───────────────────────────────────────

      it("returns expected tools via ListTools", async () => {
        const sse = await sseConnect(port);
        try {
          // Send JSON-RPC ListTools request
          const postRes = await fetch(
            `http://127.0.0.1:${port}/api/v1/mcp/message?sessionId=${sse.sessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: "list-tools-1",
                method: "tools/list",
              }),
            }
          );
          expect(postRes.status).toBe(200);

          // Read JSON-RPC response from SSE stream
          const msg = await sse.readNextEvent();
          expect(msg).not.toBeNull();
          expect(msg?.event).toBe("message");

          const parsed = JSON.parse(msg?.data);
          expect(parsed.id).toBe("list-tools-1");
          expect(parsed.result).toHaveProperty("tools");

          const tools = parsed.result.tools as Array<{ name: string }>;
          const names = tools.map((t) => t.name);
          expect(names).toContain("search_docs");
          expect(names).toContain("list_docs");
          expect(names).toContain("read_doc");
          expect(names).toContain("create_doc");
          expect(names).toContain("update_doc");
          expect(names).toContain("delete_doc");
          expect(names).toContain("list_mentions");
          expect(names).toContain("list_subscribers");

          // Every tool has name, description, and inputSchema
          for (const tool of tools) {
            expect(tool.name).toBeTruthy();
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema).toBeDefined();
          }
        } finally {
          sse.close();
        }
      }, 15_000);

      // ── Tool call via SSE ───────────────────────────────────────

      it("executes list_docs tool call and returns document slugs", async () => {
        const sse = await sseConnect(port);
        try {
          const postRes = await fetch(
            `http://127.0.0.1:${port}/api/v1/mcp/message?sessionId=${sse.sessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: "call-1",
                method: "tools/call",
                params: { name: "list_docs", arguments: {} },
              }),
            }
          );
          expect(postRes.status).toBe(200);

          const msg = await sse.readNextEvent();
          expect(msg).not.toBeNull();
          expect(msg?.event).toBe("message");

          const parsed = JSON.parse(msg?.data);
          expect(parsed.id).toBe("call-1");
          expect(parsed.result).toHaveProperty("content");
          expect(Array.isArray(parsed.result.content)).toBe(true);
          expect(parsed.result.content[0].type).toBe("text");

          const slugs = JSON.parse(parsed.result.content[0].text);
          expect(Array.isArray(slugs)).toBe(true);
          expect(slugs).toContain("blog/hello");
          expect(slugs).toContain("blog/typescript-tips");
        } finally {
          sse.close();
        }
      }, 15_000);

      // ── Unknown tool error ─────────────────────────────────────

      it("returns JSON-RPC error for unknown tool", async () => {
        const sse = await sseConnect(port);
        try {
          const postRes = await fetch(
            `http://127.0.0.1:${port}/api/v1/mcp/message?sessionId=${sse.sessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: "unknown-1",
                method: "tools/call",
                params: {
                  name: "nonexistent_tool",
                  arguments: {},
                },
              }),
            }
          );
          expect(postRes.status).toBe(200);

          const msg = await sse.readNextEvent();
          expect(msg).not.toBeNull();
          expect(msg?.event).toBe("message");

          const parsed = JSON.parse(msg?.data);
          expect(parsed.id).toBe("unknown-1");
          expect(parsed.error).toBeDefined();
          expect(parsed.error.message ?? "").toContain("Unknown tool");
        } finally {
          sse.close();
        }
      }, 15_000);

      // ── Invalid params error ───────────────────────────────────

      it("returns JSON-RPC error when required arguments are missing", async () => {
        const sse = await sseConnect(port);
        try {
          // search_docs requires "query"; call without it
          const postRes = await fetch(
            `http://127.0.0.1:${port}/api/v1/mcp/message?sessionId=${sse.sessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: "bad-args-1",
                method: "tools/call",
                params: { name: "search_docs", arguments: {} },
              }),
            }
          );
          expect(postRes.status).toBe(200);

          const msg = await sse.readNextEvent();
          expect(msg).not.toBeNull();
          expect(msg?.event).toBe("message");

          const parsed = JSON.parse(msg?.data);
          expect(parsed.id).toBe("bad-args-1");
          expect(parsed.error).toBeDefined();
          expect(parsed.error.code).toBeDefined();
        } finally {
          sse.close();
        }
      }, 15_000);
    });
  });
});
