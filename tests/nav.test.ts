import { beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database/index.js";
import { buildNav } from "../src/nav.js";
import type { HypernextConfig } from "../src/types/config.js";

const TEST_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {
    blog: { layout: "blog.mdx", path: "/blog/", rss: true, syndicate: false },
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

describe("buildNav", () => {
  beforeAll(async () => {
    await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("returns home and collection links when no pages exist", async () => {
    const nav = await buildNav(TEST_CONFIG);
    expect(nav.length).toBeGreaterThanOrEqual(1);
    expect(nav[0]?.label).toBe("Home");
    expect(nav[0]?.href).toBe("/");
    expect(nav.some((entry) => entry.label === "Blog")).toBe(true);
  });

  it("includes collection links from config", async () => {
    const nav = await buildNav(TEST_CONFIG);
    expect(nav.some((entry) => entry.label === "Blog")).toBe(true);
  });

  it("includes top-level pages sorted by order", async () => {
    await insertDoc({
      slug: "about",
      title: "About",
      order: 0,
      rawMdx: "---\ntitle: About\norder: 0\n---\n\nAbout",
    });
    await insertDoc({
      slug: "contact",
      title: "Contact",
      order: 1,
      rawMdx: "---\ntitle: Contact\norder: 1\n---\n\nContact",
    });
    const nav = await buildNav(TEST_CONFIG);
    const aboutIdx = nav.findIndex((e) => e.label === "About");
    const contactIdx = nav.findIndex((e) => e.label === "Contact");
    expect(aboutIdx).toBeGreaterThan(-1);
    expect(contactIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeLessThan(contactIdx);
  });
});
