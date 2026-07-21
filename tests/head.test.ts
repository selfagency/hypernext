import { describe, expect, it } from "vitest";
import { buildHead } from "../src/renderers/head";
import type { HypernextConfig } from "../src/types/config";

function makeConfig(overrides: Partial<HypernextConfig> = {}): HypernextConfig {
  return {
    site: {
      canonicalBase: "https://example.com",
      meta: { title: "Test Site", description: "A test site.", lang: "en" },
      pdf: { enabled: false },
      ebooks: { enabled: false },
    },
    author: { name: "Test Author", bio: "A biographer" },
    storage: { type: "local", local: { path: "./content" } },
    database: { path: ":memory:", type: "sqlite" },
    protocols: {
      finger: { enabled: false, port: 0 },
      gemini: { enabled: false, port: 0 },
      gopher: { enabled: false, port: 0 },
      http: { enabled: false, port: 0 },
      nex: { enabled: false, port: 0 },
      spartan: { enabled: false, port: 0 },
      text: { enabled: false, port: 0 },
    },
    api: { enabled: false },
    syndication: {},
    collections: {},
    taxonomies: [],
    mcp: { enabled: false, transport: "stdio" },
    micropub: { enabled: false },
    ...overrides,
  } as unknown as HypernextConfig;
}

describe("buildHead", () => {
  it("builds minimal head with defaults", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      {},
      "Page Title",
      "Page description.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("<title>Page Title</title>");
    expect(head).toContain("Page description.");
    expect(head).toContain("og:type");
    expect(head).toContain("website");
    expect(head).not.toContain("article");
    // No OG image configured in defaults
    expect(head).not.toContain("og:image");
  });

  it("builds head with article og:type for slugged pages", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      { title: "My Post" },
      "My Post",
      "Post description.",
      "blog/my-post",
      "https://example.com/blog/my-post"
    );
    expect(head).toContain('og:type" content="article"');
  });

  it("includes og:image and og:image:alt when present", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      {
        ogImage: "https://example.com/image.jpg",
        ogImageAlt: "An example image",
      },
      "Title",
      "Desc.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("og:image");
    expect(head).toContain("og:image:alt");
  });

  it("includes featuredImage as og:image fallback", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      { featuredImage: "https://example.com/featured.jpg" },
      "Title",
      "Desc.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("og:image");
    expect(head).toContain("featured.jpg");
  });

  it("includes IPFS meta tags when CIDs provided", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      {},
      "Title",
      "Desc.",
      undefined,
      "https://example.com",
      { cids: { contentCid: "QmContent", htmlCid: "QmHtml" } }
    );
    expect(head).toContain("QmContent");
    expect(head).toContain("QmHtml");
  });

  it("includes only contentCid when htmlCid absent", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      {},
      "Title",
      "Desc.",
      undefined,
      "https://example.com",
      { cids: { contentCid: "QmContent" } }
    );
    expect(head).toContain("QmContent");
  });

  it("includes custom CSS path", () => {
    const config = makeConfig({
      site: {
        meta: { title: "Test", description: "Test", lang: "en" },
        canonicalBase: "https://example.com",
        theme: { cssPath: "/custom.css" },
        pdf: { enabled: false },
        ebooks: { enabled: false },
      },
    });
    const head = buildHead(
      config,
      {},
      "Title",
      "Desc.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("custom.css");
  });

  it("includes view transition CSS when agent with viewTransitions enabled", () => {
    const config = makeConfig({
      agent: { enabled: true, viewTransitions: true },
    });
    const head = buildHead(
      config,
      {},
      "Title",
      "Desc.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("view-transition");
    expect(head).toContain("fade-in");
  });

  it("resolves config-level ogTitle as fallback", () => {
    const config = makeConfig({
      site: {
        meta: {
          title: "Test",
          description: "Test",
          lang: "en",
          ogTitle: "Config OG Title",
        },
        canonicalBase: "https://example.com",
        pdf: { enabled: false },
        ebooks: { enabled: false },
      },
    });
    const head = buildHead(
      config,
      {},
      "Fallback Title",
      "Desc.",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("Config OG Title");
  });

  it("falls back to frontmatter description", () => {
    const config = makeConfig();
    const head = buildHead(
      config,
      { description: "Frontmatter desc" },
      "Title",
      "Default desc",
      undefined,
      "https://example.com"
    );
    expect(head).toContain("Frontmatter desc");
  });
});
