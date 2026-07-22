import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { addLinkHeaders } from "../src/renderers/link-headers.js";
import type { HypernextConfig } from "../src/types/config.js";

const cfg = {
  site: {
    canonicalBase: "https://example.com",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  agent: {
    enabled: true,
    markdownNegotiation: true,
    linkHeaders: true,
    llmsTxt: true,
    sitemap: true,
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
  author: { name: "A" },
  storage: { type: "local", local: { path: "./tmp" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: false },
  collections: {},
  taxonomies: [],
  protocols: {
    http: { enabled: true, port: 0 },
    gemini: { enabled: false, port: 0 },
    gopher: { enabled: false, port: 0 },
    spartan: { enabled: false, port: 0 },
    nex: { enabled: false, port: 0 },
    finger: { enabled: false, port: 0 },
    text: { enabled: false, port: 0 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
} as unknown as HypernextConfig;

describe("link-headers", () => {
  it("adds Link header when agent is enabled", async () => {
    const fastify = Fastify({ logger: false });
    fastify.get("/test", (_req, reply) => {
      addLinkHeaders(reply, cfg, "test-slug");
      reply.send("ok");
    });
    await fastify.ready();
    const res = await fastify.inject({ method: "GET", url: "/test" });
    expect(res.headers.link).toContain('rel="api-catalog"');
    expect(res.headers.link).toContain('rel="service"');
    expect(res.headers.link).toContain('rel="alternate"');
    expect(res.headers.link).toContain('rel="canonical"');
    expect(res.headers.link).toContain('rel="mcp"');
    await fastify.close();
  });

  it("does not add Link header when agent is disabled", async () => {
    const disabledCfg = { ...cfg, agent: { ...cfg.agent, enabled: false } };
    const fastify = Fastify({ logger: false });
    fastify.get("/test", (_req, reply) => {
      addLinkHeaders(reply, disabledCfg as any, "test-slug");
      reply.send("ok");
    });
    await fastify.ready();
    const res = await fastify.inject({ method: "GET", url: "/test" });
    expect(res.headers.link).toBeUndefined();
    await fastify.close();
  });
});
