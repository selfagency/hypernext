import { describe, expect, it, vi } from "vitest";
import { registerMcpSseTransport, startMcpServer } from "../src/mcp/index.js";
import type { HypernextConfig } from "../src/types/config.js";

const BASE_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {},
  database: { path: ":memory:", type: "sqlite" },
  mcp: { enabled: false, transport: "stdio" },
  micropub: { enabled: false },
  protocols: {
    finger: { enabled: false, port: 0 },
    gemini: { enabled: false, port: 0 },
    gopher: { enabled: false, port: 0 },
    http: { enabled: false, port: 0 },
    nex: { enabled: false, port: 0 },
    spartan: { enabled: false, port: 0 },
    text: { enabled: false, port: 0 },
  },
  site: {
    canonicalBase: "http://localhost:8080",
    ebooks: { enabled: false },
    meta: { description: "Test", lang: "en", title: "Test Site" },
    pdf: { enabled: false },
  },
  storage: { type: "local", local: { path: "./content" } },
  api: { enabled: false },
  syndication: {},
  taxonomies: [],
};

describe("MCP server", () => {
  it("startMcpServer returns early when agent is not enabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      // no-op
    });
    startMcpServer(BASE_CONFIG);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("startMcpServer logs when agent is enabled", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    startMcpServer({
      ...BASE_CONFIG,
      agent: { enabled: true },
    });
    expect(logs.some((l) => l.includes("MCP server active"))).toBe(true);
    spy.mockRestore();
  });

  it("registerMcpSseTransport returns early when agent is not enabled", async () => {
    const { default: Fastify } = await import("fastify");
    const fastify = Fastify();
    registerMcpSseTransport(fastify, BASE_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/mcp",
    });
    expect(res.statusCode).toBe(404);
    await fastify.close();
  });
});
