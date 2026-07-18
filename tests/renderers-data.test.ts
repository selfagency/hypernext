import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database/index.js";
import { renderLlmsTxt } from "../src/renderers/llms-txt.js";
import { renderSitemap } from "../src/renderers/sitemap.js";
import type { HypernextConfig } from "../src/types/config.js";

const TEST_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test Site", description: "A test site", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
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

beforeAll(async () => {
  await initOrm(":memory:");
});

afterAll(async () => {
  await closeOrm();
});

describe("sitemap renderer", () => {
  it("renders empty sitemap when no docs", async () => {
    const result = await renderSitemap(TEST_CONFIG);
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result).toContain("<urlset");
    expect(result).not.toContain("<url>");
  });

  it("includes public posts in sitemap", async () => {
    await insertDoc({
      slug: "blog/test-post",
      title: "Test Post",
      date: "2026-01-15",
      type: "post",
      rawMdx:
        "---\ntitle: Test Post\ndate: 2026-01-15\ntype: post\n---\n\nHello",
    });

    const result = await renderSitemap(TEST_CONFIG);
    expect(result).toContain("<loc>http://localhost:8080/blog/test-post</loc>");
    expect(result).toContain("<priority>0.8</priority>");
    expect(result).toContain("<changefreq>monthly</changefreq>");
  });

  it("excludes private documents", async () => {
    await insertDoc({
      slug: "private/doc",
      title: "Private",
      rawMdx: "---\ntitle: Private\nvisibility: private\n---\n\nSecret",
    });

    const result = await renderSitemap(TEST_CONFIG);
    expect(result).not.toContain("private/doc");
  });
});

describe("llms.txt renderer", () => {
  it("renders header with site info", async () => {
    const result = await renderLlmsTxt(TEST_CONFIG);
    expect(result).toContain("# Test Site");
    expect(result).toContain("> A test site");
  });

  it("groups docs by collection", async () => {
    await insertDoc({
      slug: "blog/another-post",
      title: "Another Post",
      rawMdx: "---\ntitle: Another Post\n---\n\nContent",
    });

    const result = await renderLlmsTxt(TEST_CONFIG);
    expect(result).toContain("## blog");
    expect(result).toContain("[Another Post]");
  });

  it("excludes private documents", async () => {
    const result = await renderLlmsTxt(TEST_CONFIG);
    expect(result).not.toContain("private/doc");
  });
});
