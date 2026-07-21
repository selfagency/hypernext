import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLinkHeaders } from "../src/renderers/link-headers.js";
import { getStorageProvider } from "../src/storage/index.js";
import type { HypernextConfig } from "../src/types/config.js";

const testConfig = {
  site: {
    canonicalBase: "https://example.com",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: "./tmp-edge-test" } },
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
  it("returns empty string for unknown relation", () => {
    const result = addLinkHeaders(testConfig as any, "test-slug");
    expect(result).toBe("");
  });
});

describe("storage/index", () => {
  beforeAll(() => {
    fs.mkdirSync("./tmp-edge-test", { recursive: true });
  });

  afterAll(() => {
    fs.rmSync("./tmp-edge-test", { recursive: true, force: true });
  });

  it("returns a storage provider for local type", () => {
    const provider = getStorageProvider(testConfig);
    expect(provider).toBeDefined();
  });
});
