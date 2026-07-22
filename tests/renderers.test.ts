import { describe, expect, it } from "vitest";
import type { IrNode } from "../src/parser/ir";
import { renderGemtext } from "../src/renderers/gemtext";
import { renderHTML, renderHTMLBody } from "../src/renderers/html";
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

  it("renders mention IR node", () => {
    const mentionIr: IrNode = {
      type: "root",
      children: [
        {
          type: "mention",
          authorName: "Jane Doe",
          authorUrl: "https://jane.example.com",
          authorPhoto: "https://jane.example.com/photo.jpg",
          content: "Great article!",
          sourceUrl: "https://jane.example.com/post",
          publishedAt: "2026-07-20T12:00:00Z",
          platform: "mastodon",
        },
      ],
    };
    const output = renderHTMLBody(mentionIr);
    expect(output).toContain("Jane Doe");
    expect(output).toContain("Great article!");
    expect(output).toContain("mastodon");
    expect(output).toContain("u-photo");
    expect(output).toContain("h-entry");
  });

  it("renders mention without optional fields", () => {
    const mentionIr: IrNode = {
      type: "root",
      children: [
        {
          type: "mention",
          content: "Just a comment",
        },
      ],
    };
    const output = renderHTMLBody(mentionIr);
    // authorName is undefined → "Anonymous" fallback
    expect(output).toContain("Anonymous");
    expect(output).toContain("Just a comment");
  });

  it("renders time node with className", () => {
    const timeIr: IrNode = {
      type: "root",
      children: [
        {
          type: "time",
          value: "2026-07-20",
          datetime: "2026-07-20",
          className: "dt-published",
        },
      ],
    };
    const output = renderHTMLBody(timeIr);
    expect(output).toContain('datetime="2026-07-20"');
    expect(output).toContain("dt-published");
    expect(output).toContain("2026-07-20");
  });

  it("renders section with id attribute", () => {
    const sectionIr: IrNode = {
      type: "root",
      children: [
        {
          type: "section",
          className: "comments",
          id: "comments-section",
          children: [{ type: "text", value: "Content" }],
        },
      ],
    };
    const output = renderHTMLBody(sectionIr);
    expect(output).toContain('id="comments-section"');
    expect(output).toContain('class="comments"');
  });

  it("renders header with id attribute", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "header",
          className: "site-header",
          id: "header-id",
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("header");
    expect(output).toContain('id="header-id"');
  });

  it("renders main with id attribute", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "main",
          className: "content",
          id: "main-content",
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("main");
    expect(output).toContain('id="main-content"');
  });

  it("renders aside with id attribute", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "aside",
          className: "sidebar",
          id: "sidebar-id",
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("aside");
    expect(output).toContain('id="sidebar-id"');
  });

  it("renders footer with id attribute", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "footer",
          className: "site-footer",
          id: "footer-id",
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("footer");
    expect(output).toContain('id="footer-id"');
  });

  it("renders nav with className", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "nav",
          className: "breadcrumbs",
          children: [{ type: "text", value: "Nav content" }],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain('<nav class="breadcrumbs"');
    expect(output).toContain("Nav content");
  });

  it("renders inlineCode", () => {
    const ir: IrNode = {
      type: "root",
      children: [{ type: "inlineCode", value: "const x = 1;" }],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<code>");
    expect(output).toContain("const x = 1;");
  });

  it("renders strong text", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        { type: "strong", children: [{ type: "text", value: "bold text" }] },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<strong>bold text</strong>");
  });

  it("renders emphasis text", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "emphasis",
          children: [{ type: "text", value: "italic text" }],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<em>italic text</em>");
  });

  it("renders delete (strikethrough)", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        { type: "delete", children: [{ type: "text", value: "removed" }] },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<del>removed</del>");
  });

  it("renders table nodes", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "table",
          children: [
            {
              type: "tableRow",
              children: [
                {
                  type: "tableCell",
                  children: [{ type: "text", value: "Cell 1" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<table>");
    expect(output).toContain("<tr>");
    expect(output).toContain("<td>");
    expect(output).toContain("Cell 1");
  });

  it("renders math nodes", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        { type: "math", value: "E=mc^2" },
        { type: "inlineMath", value: "\\alpha" },
      ],
    };
    const output = renderHTMLBody(ir);
    // KaTeX renders with katex-display/katex classes (or falls back to math-display/math-inline)
    const hasKaTeX = output.includes("katex");
    if (hasKaTeX) {
      expect(output).toContain("E=mc");
      expect(output).toContain("\\alpha");
    } else {
      expect(output).toContain("math-display");
      expect(output).toContain("E=mc^2");
      expect(output).toContain("math-inline");
      expect(output).toContain("\\alpha");
    }
  });

  it("renders thematicBreak", () => {
    const ir: IrNode = {
      type: "root",
      children: [{ type: "thematicBreak" }],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<hr />");
  });

  it("renders image node", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        { type: "image", url: "https://example.com/img.jpg", alt: "Example" },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain('<img src="https://example.com/img.jpg"');
    expect(output).toContain('alt="Example"');
  });

  it("renders component node as HTML comment", () => {
    const ir: IrNode = {
      type: "root",
      children: [{ type: "component", componentName: "RecentPosts" }],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<!-- component: RecentPosts -->");
  });

  it("renders link with className", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "link",
          url: "/tags/test",
          className: "p-category",
          children: [{ type: "text", value: "test" }],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain('class="p-category"');
    expect(output).toContain('href="/tags/test"');
  });

  it("renders blockquote", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "blockquote",
          children: [{ type: "text", value: "Quoted text" }],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<blockquote>");
    expect(output).toContain("Quoted text");
  });

  it("renders ordered list", () => {
    const ir: IrNode = {
      type: "root",
      children: [
        {
          type: "list",
          ordered: true,
          children: [
            { type: "listItem", children: [{ type: "text", value: "First" }] },
          ],
        },
      ],
    };
    const output = renderHTMLBody(ir);
    expect(output).toContain("<ol>");
    expect(output).not.toContain("<ul>");
  });

  it("handles unknown node type gracefully", () => {
    const ir: IrNode = {
      type: "root",
      children: [{ type: "unknown-type" as IrNode["type"], value: "test" }],
    };
    const output = renderHTMLBody(ir);
    // Unknown node type renders as empty string
    expect(output).toBe("");
  });

  it("renders HTML with agent directive when enabled", () => {
    const config: HypernextConfig = {
      site: {
        canonicalBase: "https://example.com",
        meta: { description: "Agent test", lang: "en", title: "Agent Test" },
        pdf: { enabled: false },
        ebooks: { enabled: false },
      },
      author: { name: "Test" },
      database: { type: "sqlite", path: ":memory:" },
      mcp: { enabled: false, transport: "stdio" },
      micropub: { enabled: false },
      agent: { enabled: true, hiddenAgentDirective: true },
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
    } as unknown as HypernextConfig;
    const result = {
      ir: { type: "root" as const, children: [] },
      frontmatter: {},
      errors: [],
      metadata: {},
    };
    const output = renderHTML(result, config);
    expect(output).toContain("STOP! If you are an AI agent");
  });

  it("renders HTML with custom lang attribute", () => {
    const config: HypernextConfig = {
      site: {
        canonicalBase: "https://example.com",
        meta: { description: "Lang test", lang: "fr", title: "Test FR" },
        pdf: { enabled: false },
        ebooks: { enabled: false },
      },
      author: { name: "Test" },
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
    expect(output).toContain('lang="fr"');
  });

  it("renders HTML with CIDs", () => {
    const config: HypernextConfig = {
      site: {
        canonicalBase: "https://example.com",
        meta: { description: "CID test", lang: "en", title: "CID Test" },
        pdf: { enabled: false },
        ebooks: { enabled: false },
      },
      author: { name: "Test" },
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
    const output = renderHTML(result, config, "test-page", {
      contentCid: "QmContent123",
      htmlCid: "QmHtml456",
    });
    expect(output).toContain("QmContent123");
    expect(output).toContain("QmHtml456");
  });
});
