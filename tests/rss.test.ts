import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database/index.js";
import { renderRSS } from "../src/renderers/rss.js";
import type { HypernextConfig } from "../src/types/config.js";

const TEST_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "My Blog", description: "A blog", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Author" },
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

describe("RSS renderer", () => {
  it("renders empty RSS feed when no posts", async () => {
    const result = await renderRSS(TEST_CONFIG);
    expect(result).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(result).toContain('<rss version="2.0"');
    expect(result).toContain("<title>My Blog</title>");
    expect(result).not.toContain("<item>");
  });

  it("includes public posts in RSS feed", async () => {
    await insertDoc({
      slug: "blog/hello-world",
      title: "Hello World",
      date: "2026-06-15",
      type: "post",
      rawMdx:
        "---\ntitle: Hello World\ndate: 2026-06-15\ntype: post\n---\n\nHello!",
    });

    const result = await renderRSS(TEST_CONFIG);
    expect(result).toContain("<item>");
    expect(result).toContain("<title>Hello World</title>");
    expect(result).toContain(
      "<link>http://localhost:8080/blog/hello-world</link>"
    );
    expect(result).toContain('<guid isPermaLink="false">');
  });

  it("excludes private posts", async () => {
    await insertDoc({
      slug: "blog/secret",
      title: "Secret",
      type: "post",
      rawMdx: "---\ntitle: Secret\nvisibility: private\n---\n\nShh",
    });

    const result = await renderRSS(TEST_CONFIG);
    expect(result).not.toContain("Secret");
  });

  it("excludes non-post types", async () => {
    await insertDoc({
      slug: "library/page",
      title: "A Page",
      type: "page",
      rawMdx: "---\ntitle: A Page\ntype: page\n---\n\nContent",
    });

    const result = await renderRSS(TEST_CONFIG);
    expect(result).not.toContain("A Page");
  });

  it("includes enclosure tags when present", async () => {
    await insertDoc({
      slug: "blog/podcast",
      title: "Podcast Episode",
      date: "2026-07-01",
      type: "post",
      rawMdx:
        "---\ntitle: Podcast Episode\ndate: 2026-07-01\ntype: post\nenclosure:\n  url: https://example.com/audio.mp3\n  type: audio/mpeg\n  length: 12345\n---\n\nListen!",
    });

    const result = await renderRSS(TEST_CONFIG);
    expect(result).toContain("<enclosure");
    expect(result).toContain('url="https://example.com/audio.mp3"');
    expect(result).toContain('type="audio/mpeg"');
  });
});
