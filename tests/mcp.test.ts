import { describe, expect, it } from "vitest";
import { createTools } from "../src/mcp/tools.js";
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

describe("MCP tools", () => {
  it("creates tools without IPFS or AI", () => {
    const tools = createTools(BASE_CONFIG);
    expect(tools.length).toBeGreaterThanOrEqual(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("ingest_url");
    expect(names).toContain("list_media");
    expect(names).toContain("push_remote");
    expect(names).toContain("sync_remote");
    expect(names).toContain("syndicate_doc");
    expect(names).toContain("generate_format");
    expect(names).not.toContain("get_doc_cid");
    expect(names).not.toContain("pin_doc");
    expect(names).not.toContain("talk_to_docs");
  });

  it("includes IPFS tools when IPFS is enabled", () => {
    const config: HypernextConfig = {
      ...BASE_CONFIG,
      ipfs: { enabled: true },
    };
    const tools = createTools(config);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_doc_cid");
    expect(names).toContain("pin_doc");
  });

  it("includes AI tools when agent and AI are enabled", () => {
    const config: HypernextConfig = {
      ...BASE_CONFIG,
      agent: { enabled: true },
      ai: { enabled: true, openai: { baseUrl: "http://localhost" } },
    };
    const tools = createTools(config);
    const names = tools.map((t) => t.name);
    expect(names).toContain("talk_to_docs");
  });

  it("each tool has required properties", () => {
    const tools = createTools(BASE_CONFIG);
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });
});
