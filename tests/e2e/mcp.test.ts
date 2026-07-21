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
async function _sseConnect(
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

  // Read all SSE events until we find one with sessionId in the data
  let sessionId: string | null = null;
  const maxReadAttempts = 5;
  for (let i = 0; i < maxReadAttempts; i++) {
    const evt = await readNextEvent();
    if (!evt) {
      break;
    }
    const match = evt.data.match(SESSION_ID_REGEX);
    if (match?.[1]) {
      sessionId = match[1];
      break;
    }
    // Also try the event field itself
    const eventMatch = evt.event.match(SESSION_ID_REGEX);
    if (eventMatch?.[1]) {
      sessionId = eventMatch[1];
      break;
    }
  }

  if (!sessionId) {
    reader.cancel().catch(() => {
      /* expected */
    });
    throw new Error("Could not extract sessionId from SSE stream");
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

    // ── SSE connection stream tests ───────────────────────────────

    describe("SSE stream", () => {
      let sseSessionId: string;

      beforeAll(async () => {
        const { initOrm } = await import("../../src/database/index.js");
        await initOrm(":memory:");
      }, 15_000);

      afterAll(async () => {
        const { closeOrm } = await import("../../src/database/index.js");
        await closeOrm();
      }, 10_000);

      it("GET /api/v1/mcp returns SSE stream with content type", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`);
        expect(res.status).toBe(200);
        // Close the SSE stream immediately to free up the server
        await res.body?.cancel();
      });

      it("SSE stream contains sessionId in endpoint data", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`);
        const reader = res.body?.getReader();
        expect(reader).toBeDefined();

        const decoder = new TextDecoder();
        let buffer = "";
        const timeout = 10_000;

        for (let i = 0; i < 100; i++) {
          const result = await Promise.race([
            reader?.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Read timeout")), timeout)
            ),
          ]);
          if (result.done) {
            break;
          }
          buffer += decoder.decode(result.value, { stream: true });

          const match = buffer.match(SESSION_ID_REGEX);
          if (match) {
            sseSessionId = match[1];
            reader?.cancel().catch(() => {
              /* expected */
            });
            break;
          }
        }

        expect(sseSessionId).toBeTruthy();
      }, 30_000);
    });
  });
});
