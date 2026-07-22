import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveLayout } from "../src/parser/layout.js";
import type { HypernextConfig } from "../src/types/config.js";

const testConfig: HypernextConfig = {
  author: { name: "Test" },
  collections: {
    blog: { layout: "blog.mdx", path: "/blog/", rss: true, syndicate: false },
    library: {
      layout: "library.mdx",
      path: "/library/",
      rss: false,
      syndicate: false,
    },
  },
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

describe("resolveLayout", () => {
  const tmpDir = path.resolve(".tmp/test-templates");

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "default.mdx"),
      "---\ntitle: Default\n---\n\n\u003cHeader /\u003e\n\u003cMain /\u003e\n\u003cslot /\u003e\n\u003cFooter /\u003e\n"
    );
    fs.writeFileSync(
      path.join(tmpDir, "blog.mdx"),
      "---\ntitle: Blog\n---\n\n\u003cHeader /\u003e\n\u003cslot /\u003e\n\u003cFooter /\u003e\n"
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("wraps document content in default skeleton", () => {
    const result = resolveLayout(
      testConfig,
      { rawMdx: "# Hello\n\nWorld." },
      { templatesDir: tmpDir }
    );
    expect(result.ir.type).toBe("root");
    // Template: <Header />, <slot /> → content, <Footer />
    // (PascalCase components — not yet resolved, that's resolveLayoutWithComponents' job)
    const children = result.ir.children ?? [];
    expect(children.length).toBeGreaterThanOrEqual(1);
    // First child should be Header component
    expect(children[0]?.componentName).toBe("Header");
    // Content between Header and Footer contains the doc content (from <slot />)
    const docContent = children.filter(
      (n) => n.componentName !== "Header" && n.componentName !== "Footer"
    );
    expect(docContent.length).toBeGreaterThanOrEqual(1);
    const firstDocNode = docContent.find(
      (n) => n.type === "heading" || n.type === "paragraph"
    );
    expect(firstDocNode?.type).toBe("heading");
    expect(firstDocNode?.depth).toBe(1);
    // Last child should be Footer component
    const footerNode = children.find((n) => n.componentName === "Footer");
    expect(footerNode).toBeDefined();
  });

  it("selects collection layout for blog collection", () => {
    const result = resolveLayout(
      testConfig,
      { rawMdx: "---\ntitle: Post\n---\n\n# Post" },
      { collection: "blog", templatesDir: tmpDir }
    );
    expect(result.frontmatter.title).toBe("Post");
    // Blog layout uses <Header /> (PascalCase resolved component)
    const headerNode = (result.ir.children ?? []).find(
      (n) => n.componentName === "Header"
    );
    expect(headerNode).toBeDefined();
  });

  it("throws when layout file is missing from embedded defaults", () => {
    expect(() =>
      resolveLayout(
        testConfig,
        { rawMdx: "# Hello", layout: "nonexistent-layout" },
        { templatesDir: path.join(tmpDir, "nonexistent") }
      )
    ).toThrow("Layout not found");
  });

  it("throws when layout has no slot", () => {
    fs.writeFileSync(
      path.join(tmpDir, "library.mdx"),
      "---\n---\n\nNo slot here\n"
    );
    expect(() =>
      resolveLayout(
        testConfig,
        { rawMdx: "# Hello" },
        { collection: "library", templatesDir: tmpDir }
      )
    ).toThrow("missing <slot />");
  });
});
