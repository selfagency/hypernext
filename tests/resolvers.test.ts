import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database/index.js";
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
    expect(list?.children?.length).toBe(2);
    expect(list?.children?.[0]?.children?.[0]?.url).toBe("/blog");
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
    expect(nodes[0]?.type).toBe("section");
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
});

describe("EmailSubscribe", () => {
  it("returns paragraph with component placeholder", async () => {
    const nodes = await resolveComponent(
      "EmailSubscribe",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
  });
});

describe("ContactForm", () => {
  it("returns paragraph with component placeholder", async () => {
    const nodes = await resolveComponent(
      "ContactForm",
      {},
      { config: testConfig }
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
  });
});
