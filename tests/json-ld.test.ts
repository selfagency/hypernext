import { describe, expect, it } from "vitest";
import {
  buildJsonLd,
  buildJsonLdPage,
  buildJsonLdWebsite,
} from "../src/renderers/json-ld.js";
import type { HypernextConfig } from "../src/types/config.js";

const cfg = {
  site: {
    canonicalBase: "https://example.com",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A", url: "https://a.com" },
  storage: { type: "local", local: { path: "./x" } },
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

describe("json-ld", () => {
  it("buildJsonLdWebsite returns WebSite schema", () => {
    const result = buildJsonLdWebsite(cfg);
    expect(result).toContain('"@type": "WebSite"');
    expect(result).toContain("https://example.com");
  });

  it("buildJsonLdPage returns BlogPosting schema with image", () => {
    const result = buildJsonLdPage(
      cfg,
      "test-slug",
      "Test",
      "Desc",
      "2026-07-20",
      "https://example.com/img.jpg",
      "Alt"
    );
    expect(result).toContain('"@type": "BlogPosting"');
    expect(result).toContain("https://example.com/img.jpg");
  });

  it("buildJsonLd returns combined graph with BlogPosting", () => {
    const result = buildJsonLd(
      cfg,
      { title: "Page", date: "2026-07-20" },
      "test"
    );
    expect(result).toContain('"@graph"');
    expect(result).toContain("BlogPosting");
  });

  it("buildJsonLd handles missing author gracefully", () => {
    const noAuthor = { ...cfg, author: {} } as any;
    const result = buildJsonLd(noAuthor, { title: "Page" }, "test");
    expect(result).toContain('"@graph"');
  });

  it("handles relative featuredImage URL", () => {
    const result = buildJsonLd(
      cfg,
      { title: "P", featuredImage: "/img.jpg", featuredImageAlt: "Alt" },
      "post"
    );
    expect(result).toContain("img.jpg");
  });
});
