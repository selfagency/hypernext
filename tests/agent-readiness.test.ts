import { describe, expect, it } from "vitest";
import { registerWellKnownEndpoints } from "../src/renderers/agent-readiness.js";
import type { HypernextConfig } from "../src/types/config.js";

const MINIMAL_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {},
  taxonomies: [],
  protocols: {
    http: { enabled: true, port: 8080 },
    gemini: { enabled: false, port: 1965 },
    gopher: { enabled: false, port: 70 },
    spartan: { enabled: false, port: 300 },
    nex: { enabled: false, port: 1900 },
    finger: { enabled: false, port: 79 },
    text: { enabled: false, port: 5011 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

describe("agent readiness", () => {
  it("does not register routes when agent is disabled", () => {
    const routes: string[] = [];
    const fastify = {
      get: (path: string) => {
        routes.push(path);
      },
    } as any;

    registerWellKnownEndpoints(fastify, MINIMAL_CONFIG);
    expect(routes).toHaveLength(0);
  });

  it("registers well-known endpoints when agent is enabled", () => {
    const routes: string[] = [];
    const fastify = {
      get: (path: string) => {
        routes.push(path);
      },
    } as any;

    registerWellKnownEndpoints(fastify, {
      ...MINIMAL_CONFIG,
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
    });

    expect(routes).toContain("/.well-known/api-catalog");
    expect(routes).toContain("/.well-known/agent-skills/index.json");
    expect(routes).toContain("/.well-known/mcp/server-card.json");
    expect(routes).toContain("/.well-known/http-message-signatures-directory");
    expect(routes).toContain("/.well-known/mcp.json");
  });
});
