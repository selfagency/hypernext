import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database/index.js";
import type { IrNode } from "../src/parser/ir.js";
import { resolveComponent } from "../src/parser/resolver.js";
import type { HypernextConfig } from "../src/types/config.js";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "https://example.com",
    meta: { title: "Test", description: "A test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author", bio: "A biographer", url: "https://a.com" },
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
  taxonomies: [{ name: "tags", plural: "tags", singular: "tag" }],
  mcp: { enabled: false, transport: "stdio" },
  micropub: { enabled: false },
} as unknown as HypernextConfig;

beforeAll(async () => {
  await initOrm(":memory:");
});

afterAll(async () => {
  await closeOrm();
});

describe("Breadcrumbs", () => {
  it("returns empty when no slug", async () => {
    const nodes = await resolveComponent(
      "Breadcrumbs",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns nav with breadcrumb items", async () => {
    const nodes = await resolveComponent(
      "Breadcrumbs",
      {},
      { config: testConfig, currentSlug: "blog/welcome" }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("nav");
    expect(nodes[0]?.className).toBe("breadcrumbs");
    const list = nodes[0]?.children?.[0];
    expect(list?.type).toBe("list");
    expect(list?.children?.length).toBe(3);
    expect(list?.children?.[0]?.children?.[0]?.url).toBe("/");
    expect(list?.children?.[1]?.children?.[0]?.url).toBe("/blog");
  });
});

describe("Search", () => {
  it("returns link to search page", async () => {
    const nodes = await resolveComponent("Search", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("section");
    expect(nodes[0]?.className).toBe("search");
    expect(nodes[0]?.children?.[0]?.url).toBe("/search");
  });
});

describe("AuthorBio", () => {
  it("returns section with author info from config", async () => {
    const nodes = await resolveComponent(
      "AuthorBio",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("section");
    expect(nodes[0]?.className).toBe("h-card author-bio");
    expect(nodes[0]?.children?.[0]?.type).toBe("heading");
    expect(nodes[0]?.children?.[0]?.children?.[0]?.value).toBe("Test Author");
    expect(nodes[0]?.children?.[1]?.children?.[0]?.value).toBe("A biographer");
    expect(nodes[0]?.children?.[2]?.children?.[0]?.url).toBe("https://a.com");
  });
});

describe("Figure", () => {
  it("returns image with caption", async () => {
    const nodes = await resolveComponent(
      "Figure",
      { src: "img.jpg", caption: "Fig 1" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.type).toBe("image");
    expect(nodes[0]?.url).toBe("img.jpg");
    expect(nodes[1]?.children?.[0]?.value).toBe("Fig 1");
  });

  it("returns image only when no caption", async () => {
    const nodes = await resolveComponent(
      "Figure",
      { src: "img.jpg" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("image");
  });
});

describe("Mermaid", () => {
  it("returns code block with chart", async () => {
    const nodes = await resolveComponent(
      "Mermaid",
      { chart: "graph TD; A-->B;" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("code");
    expect(nodes[0]?.lang).toBe("mermaid");
    expect(nodes[0]?.value).toBe("graph TD; A-->B;");
  });
});

describe("Latex", () => {
  it("returns math node", async () => {
    const nodes = await resolveComponent(
      "Latex",
      { math: "E=mc^2" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("math");
    expect(nodes[0]?.value).toBe("E=mc^2");
  });
});

describe("Enclosure", () => {
  it("returns link with type info", async () => {
    const nodes = await resolveComponent(
      "Enclosure",
      {
        url: "https://example.com/file.pdf",
        title: "Doc",
        type: "application/pdf",
      },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[0]?.children?.[0]?.url).toBe("https://example.com/file.pdf");
  });
});

describe("TagCloud", () => {
  it("returns no tags message when empty", async () => {
    const nodes = await resolveComponent(
      "TagCloud",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]?.value).toBe("No tags yet.");
  });
});

describe("Sidebar", () => {
  it("returns aside with recent posts heading", async () => {
    const nodes = await resolveComponent("Sidebar", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("aside");
    const headings =
      nodes[0]?.children?.filter((n) => n.type === "heading") ?? [];
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(headings[0]?.children?.[0]?.value).toBe("Recent Posts");
    expect(headings[1]?.children?.[0]?.value).toBe("Tags");
  });
});

describe("Header", () => {
  it("returns section with site title and nav", async () => {
    const nodes = await resolveComponent("Header", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("header");
    expect(nodes[0]?.className).toBe("site-header");
  });
});

describe("Main", () => {
  it("returns main element with breadcrumbs and slot", async () => {
    const nodes = await resolveComponent("Main", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("main");
    expect(nodes[0]?.className).toBe("main-content");
    const slotComp = nodes[0]?.children?.find(
      (n) => n.componentName === "slot"
    );
    expect(slotComp).toBeDefined();
  });
});

describe("IPFSLink", () => {
  it("returns empty when no slug", async () => {
    const nodes = await resolveComponent(
      "IPFSLink",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns empty when doc has no CIDs", async () => {
    await insertDoc({
      slug: "test/no-cid",
      title: "No CID",
      rawMdx: "# No CID",
    });
    const nodes = await resolveComponent(
      "IPFSLink",
      {},
      { config: testConfig, currentSlug: "test/no-cid" }
    );
    expect(nodes).toHaveLength(0);
  });
});

describe("Archive", () => {
  it("returns no posts message when filter is empty", async () => {
    const nodes = await resolveComponent(
      "Archive",
      { filter: "", limit: 10 },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]?.value).toBe("No posts found.");
  });
});

describe("PostList", () => {
  it("returns list section", async () => {
    const nodes = await resolveComponent(
      "PostList",
      { collection: "" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("section");
    expect(nodes[0]?.className).toBe("post-list");
  });
});

describe("PostNav", () => {
  it("returns empty when no slug", async () => {
    const nodes = await resolveComponent("PostNav", {}, { config: testConfig });
    expect(nodes).toHaveLength(0);
  });

  it("returns empty when slug not found in docs", async () => {
    const nodes = await resolveComponent(
      "PostNav",
      {},
      { config: testConfig, currentSlug: "blog/nonexistent" }
    );
    expect(nodes).toHaveLength(0);
  });
});

describe("SyndicationLinks", () => {
  it("returns empty when no docId", async () => {
    const nodes = await resolveComponent(
      "SyndicationLinks",
      {},
      { config: testConfig, currentSlug: "test" }
    );
    expect(nodes).toHaveLength(0);
  });
});

describe("Include", () => {
  it("returns empty when no src", async () => {
    const nodes = await resolveComponent("Include", {}, { config: testConfig });
    expect(nodes).toHaveLength(0);
  });

  it("returns not found message for missing doc", async () => {
    const nodes = await resolveComponent(
      "Include",
      { src: "/nonexistent/doc" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]?.value).toContain("Include not found");
  });
});

describe("EmailSubscribe", () => {
  it("returns form element with email input", async () => {
    const nodes = await resolveComponent(
      "EmailSubscribe",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("component");
    expect(nodes[0]?.componentName).toBe("form");
    expect(nodes[0]?.componentProps?.action).toBe("/api/v1/subscribe");
  });
});

describe("ContactForm", () => {
  it("returns form element with inputs", async () => {
    const nodes = await resolveComponent(
      "ContactForm",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("component");
    expect(nodes[0]?.componentName).toBe("form");
    expect(nodes[0]?.componentProps?.action).toBe("/api/v1/contact");
  });
});

describe("NavMenu", () => {
  it("returns nav element with home link", async () => {
    const nodes = await resolveComponent("NavMenu", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("nav");
    expect(nodes[0]?.className).toBe("nav-menu");
  });
});

describe("RecentPosts", () => {
  it("returns no posts message when empty", async () => {
    const nodes = await resolveComponent(
      "RecentPosts",
      { limit: 5 },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[0]?.children?.[0]?.value).toBe("No posts yet.");
  });
});

describe("TableOfContents", () => {
  it("returns empty when no body", async () => {
    const nodes = await resolveComponent(
      "TableOfContents",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns empty when body has no headings", async () => {
    const nodes = await resolveComponent(
      "TableOfContents",
      {},
      { config: testConfig, body: "Just a paragraph." }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns list of headings from body", async () => {
    const nodes = await resolveComponent(
      "TableOfContents",
      {},
      {
        config: testConfig,
        body: "## Introduction\n\nHello\n\n## Details\n\nMore",
      }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("list");
    const items = nodes[0]?.children ?? [];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]?.children?.[0]?.url).toContain("#");
  });
});

describe("Footer", () => {
  it("returns footer section with site info", async () => {
    const nodes = await resolveComponent("Footer", {}, { config: testConfig });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("footer");
    expect(nodes[0]?.className).toBe("site-footer");
    // URL is included
    const urlParagraphs = nodes[0]?.children
      ?.filter((c: IrNode) => c.type === "paragraph")
      .slice(-1)[0];
    expect(urlParagraphs).toBeDefined();
  });
});

describe("Title", () => {
  it("returns heading with slug-derived title when no frontmatter", async () => {
    const nodes = await resolveComponent(
      "Title",
      {},
      { config: testConfig, currentSlug: "blog/my-post" }
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.type).toBe("heading");
    expect(nodes[0]?.className).toBe("p-name");
    // Should use slug as fallback
    expect(nodes[0]?.children?.[0]?.value).toBe("my-post");
  });

  it("returns heading with frontmatter title", async () => {
    const nodes = await resolveComponent(
      "Title",
      {},
      {
        config: testConfig,
        currentSlug: "blog/test",
        frontmatter: { title: "My Custom Title" },
      }
    );
    expect(nodes[0]?.children?.[0]?.value).toBe("My Custom Title");
  });
});

describe("PostMeta", () => {
  it("returns empty when no relevant frontmatter", async () => {
    const nodes = await resolveComponent(
      "PostMeta",
      {},
      {
        config: { ...testConfig, author: {} },
        currentSlug: "blog/post",
        frontmatter: {},
      }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns byline with author and date", async () => {
    const nodes = await resolveComponent(
      "PostMeta",
      {},
      {
        config: testConfig,
        currentSlug: "blog/post",
        frontmatter: { date: "2026-07-20", tags: ["tag1", "tag2"] },
      }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[0]?.className).toBe("byline");
  });

  it("handles invalid date gracefully", async () => {
    const nodes = await resolveComponent(
      "PostMeta",
      {},
      {
        config: testConfig,
        currentSlug: "blog/post",
        frontmatter: { date: "not-a-date", tags: [] },
      }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
  });
});

describe("Comments", () => {
  it("returns empty when no slug", async () => {
    const nodes = await resolveComponent(
      "Comments",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(0);
  });

  it("returns replies section with no replies message", async () => {
    const nodes = await resolveComponent(
      "Comments",
      {},
      { config: testConfig, currentSlug: "blog/test-comments" }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("section");
    expect(nodes[0]?.className).toBe("h-feed comments");
    // Should contain "No replies yet." heading + paragraph
    const noReplies = nodes[0]?.children?.find(
      (c: IrNode) => c.type === "paragraph"
    );
    expect(noReplies?.children?.[0]?.value).toBe("No replies yet.");
  });
});

describe("Archive", () => {
  it("returns no posts for year filter without matches", async () => {
    const nodes = await resolveComponent(
      "Archive",
      { filter: "year:1999", limit: 10 },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]?.value).toBe("No posts found.");
  });

  it.each([
    { filter: "tag:nonexistent-tag", desc: "tag filter" },
    { filter: "taxonomy:tags:nonexistent", desc: "taxonomy filter" },
    { filter: "author:ghost", desc: "author filter" },
  ])("returns no posts for $desc without matches", async ({ filter }) => {
    const nodes = await resolveComponent(
      "Archive",
      { filter },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]?.value).toBe("No posts found.");
  });
});

describe("PostList", () => {
  it("returns no posts message for empty db", async () => {
    const nodes = await resolveComponent(
      "PostList",
      { collection: "blog" },
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[0]?.children?.[0]?.value).toBe("No posts found.");
  });
});

describe("resolveComponent", () => {
  it("returns empty for unknown component", async () => {
    const nodes = await resolveComponent(
      "UnknownComponent",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(0);
  });
});
