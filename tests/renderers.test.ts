import { describe, expect, it } from "vitest";
import type { IrNode } from "../src/parser/ir";
import { renderGemtext } from "../src/renderers/gemtext";
import { renderHTML } from "../src/renderers/html";
import { renderMarkdown } from "../src/renderers/markdown";
import type { HypernextConfig } from "../src/types/config";

const testIr: IrNode = {
  type: "root",
  children: [
    { type: "heading", depth: 1, children: [{ type: "text", value: "Hello" }] },
    { type: "paragraph", children: [{ type: "text", value: "World." }] },
    {
      type: "link",
      url: "https://example.com",
      children: [{ type: "text", value: "Example" }],
    },
    {
      type: "list",
      ordered: false,
      children: [
        { type: "listItem", children: [{ type: "text", value: "Item 1" }] },
        { type: "listItem", children: [{ type: "text", value: "Item 2" }] },
      ],
    },
    { type: "code", lang: "ts", value: "const x = 1;" },
  ],
};

describe("renderers", () => {
  it("renders Gemtext", () => {
    const output = renderGemtext(testIr);
    expect(output).toContain("# Hello");
    expect(output).toContain("=> https://example.com Example");
    expect(output).toContain("* Item 1");
    expect(output).toContain("```ts");
  });

  it("renders Markdown", () => {
    const output = renderMarkdown(testIr);
    expect(output).toContain("# Hello");
    expect(output).toContain("[Example](https://example.com)");
    expect(output).toContain("- Item 1");
    expect(output).toContain("```ts");
  });

  it("renders JSON-LD structured data", () => {
    const config: HypernextConfig = {
      author: {
        bio: "A writer.",
        name: "Alice",
        photo: "/images/alice.jpg",
        socials: {
          mastodon: "https://mastodon.social/@alice",
          github: "https://github.com/alice",
        },
        url: "https://alice.example.com",
      },
      database: { type: "sqlite", path: ":memory:" },
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
        canonicalBase: "https://example.com",
        meta: { description: "A blog.", lang: "en", title: "My Blog" },
        organization: {
          name: "Example Org",
          logo: "/logo.png",
          sameAs: ["https://twitter.com/example"],
          contactPoint: { email: "hi@example.com" },
          founders: ["Alice"],
        },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "./data" } },
      api: { enabled: false },
      syndication: {},
      collections: {},
      comments: {
        enabled: false,
        inbound: { pingback: false, trackback: false, webmention: false },
        aggregation: { bluesky: false, cacheTtl: 300, mastodon: false },
        akismet: { enabled: false },
      },
      taxonomies: [],
    };
    const frontmatter: Record<string, unknown> = {
      title: "Hello World",
      description: "My first post.",
      date: "2026-07-16",
      featuredImage: "/images/hello.jpg",
      featuredImageAlt: "Hello image",
    };
    const result = {
      ir: {
        type: "root" as const,
        children: [{ type: "text" as const, value: "Content" }],
      },
      frontmatter,
      errors: [],
      metadata: {},
    };
    const output = renderHTML(result, config, "hello-world");

    // JSON-LD block
    expect(output).toContain('<script type="application/ld+json">');

    // WebSite
    expect(output).toContain('"@type": "WebSite"');
    expect(output).toContain('"potentialAction"');
    expect(output).toContain('"SearchAction"');
    expect(output).toContain(
      '"urlTemplate": "https://example.com/search?q={search_term_string}"'
    );

    // Organization
    expect(output).toContain('"@type": "Organization"');
    expect(output).toContain('"name": "Example Org"');
    expect(output).toContain('"sameAs"');
    expect(output).toContain('"https://twitter.com/example"');
    expect(output).toContain('"ContactPoint"');
    expect(output).toContain('"hi@example.com"');

    // Person
    expect(output).toContain('"@type": "Person"');
    expect(output).toContain('"name": "Alice"');
    expect(output).toContain('"https://mastodon.social/@alice"');
    expect(output).toContain('"https://github.com/alice"');
    expect(output).toContain('"description": "A writer."');

    // BlogPosting
    expect(output).toContain('"@type": "BlogPosting"');
    expect(output).toContain('"headline": "Hello World"');
    expect(output).toContain('"datePublished": "2026-07-16"');
    expect(output).toContain('"description": "My first post."');

    // BreadcrumbList
    expect(output).toContain('"@type": "BreadcrumbList"');
    expect(output).toContain('"position": 2');
    expect(output).toContain('"item": "https://example.com/hello-world"');

    // ImageObject
    expect(output).toContain('"@type": "ImageObject"');
    expect(output).toContain(
      '"contentUrl": "https://example.com/images/hello.jpg"'
    );
    expect(output).toContain('"caption": "Hello image"');
  });

  it("renders minimal JSON-LD without author/org", () => {
    const config: HypernextConfig = {
      database: { type: "sqlite", path: ":memory:" },
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
        canonicalBase: "https://minimal.example.com",
        meta: { description: "Minimal.", lang: "en", title: "Minimal" },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "./data" } },
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    } as unknown as HypernextConfig;
    const result = {
      ir: { type: "root" as const, children: [] },
      frontmatter: {},
      errors: [],
      metadata: {},
    };
    const output = renderHTML(result, config);

    // No page slug → WebPage, not BlogPosting
    expect(output).toContain('"@type": "WebPage"');
    expect(output).not.toContain('"BlogPosting"');

    // Minimal organization (auto-generated from site name)
    expect(output).toContain('"name": "Minimal"');

    // No author block
    expect(output).not.toContain('"@type": "Person"');

    // Breadcrumb with only Home
    expect(output).toContain('"position": 1');
    expect(output).not.toContain('"position": 2');

    // No featured image
    expect(output).not.toContain('"ImageObject"');
  });
});
