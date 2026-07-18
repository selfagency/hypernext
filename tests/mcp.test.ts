import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import { createTools } from "../src/mcp/tools";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
  },
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
  mcp: { enabled: true, transport: "stdio" },
};

const ipfsConfig: HypernextConfig = {
  ...testConfig,
  ipfs: {
    enabled: true,
    apiEndpoint: "http://127.0.0.1:5001",
    gatewayUrl: "https://ipfs.io/ipfs",
    pinning: true,
    cacheHtml: true,
  },
};

describe("MCP tools", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/hello",
      title: "Hello",
      rawMdx: "# Hello\n\nWorld.",
    });
    await insertDoc({
      slug: "blog/world",
      title: "World",
      rawMdx: "# World\n\nHello.",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("lists tools with correct names", () => {
    const tools = createTools(testConfig);
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_docs");
    expect(names).toContain("read_doc");
    expect(names).toContain("list_collections");
  });

  it("search_docs returns results", async () => {
    const tools = createTools(testConfig);
    // biome-ignore lint/style/noNonNullAssertion: search_docs tool is always present
    const searchTool = tools.find((t) => t.name === "search_docs")!;
    const result = await searchTool.handler({ query: "Hello", limit: 10 });
    expect(result.content[0].text).toContain("blog/hello");
  });

  it("read_doc returns markdown", async () => {
    const tools = createTools(testConfig);
    // biome-ignore lint/style/noNonNullAssertion: tool is always present in test config
    const docTool = tools.find((t) => t.name === "read_doc")!;
    const result = await docTool.handler({ slug: "blog/hello" });
    expect(result.content[0].text).toContain("Hello");
  });

  it("read_doc returns error for missing slug", async () => {
    const tools = createTools(testConfig);
    // biome-ignore lint/style/noNonNullAssertion: tool is always present in test config
    const docTool = tools.find((t) => t.name === "read_doc")!;
    const result = await docTool.handler({ slug: "missing" });
    expect(result.content[0].text).toContain("Not found");
  });

  it("list_collections returns configured collections", async () => {
    const tools = createTools(testConfig);
    // biome-ignore lint/style/noNonNullAssertion: tool is always present in test config
    const listTool = tools.find((t) => t.name === "list_collections")!;
    const result = await listTool.handler({});
    expect(result.content[0].text).toContain("blog");
  });
});

describe("MCP IPFS tools", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/ipfs-test",
      title: "IPFS Test",
      rawMdx: "# Test",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("includes IPFS tools when ipfs.enabled is true", () => {
    const tools = createTools(ipfsConfig);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_doc_cid");
    expect(names).toContain("pin_doc");
  });

  it("excludes IPFS tools when ipfs is not configured", () => {
    const tools = createTools(testConfig);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("get_doc_cid");
    expect(names).not.toContain("pin_doc");
  });

  it("get_doc_cid returns CIDs from database", async () => {
    await insertDoc({
      slug: "blog/has-cid",
      title: "Has CID",
      contentCid: "bafycontent123",
      htmlCid: "bafyhtml456",
    });
    const tools = createTools(ipfsConfig);
    // biome-ignore lint/style/noNonNullAssertion: tool is always present with ipfs config
    const tool = tools.find((t) => t.name === "get_doc_cid")!;
    const result = await tool.handler({ slug: "blog/has-cid" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contentCid).toBe("bafycontent123");
    expect(parsed.htmlCid).toBe("bafyhtml456");
  });

  it("get_doc_cid returns null CIDs when not pinned", async () => {
    const tools = createTools(ipfsConfig);
    // biome-ignore lint/style/noNonNullAssertion: tool is always present with ipfs config
    const tool = tools.find((t) => t.name === "get_doc_cid")!;
    const result = await tool.handler({ slug: "blog/ipfs-test" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contentCid).toBeNull();
    expect(parsed.htmlCid).toBeNull();
  });
});
