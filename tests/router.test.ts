import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc, upsertTerm } from "../src/database";
import { getCollectionDocs, getTaxonomyDocs, matchRoute } from "../src/router";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
  },
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

describe("router", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({ slug: "blog/post-1", title: "Post 1" });
    await insertDoc({ slug: "blog/post-2", title: "Post 2" });
    await upsertTerm("tags", "javascript", "JavaScript");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("matches home route", () => {
    const route = matchRoute("/", testConfig);
    expect(route?.type).toBe("home");
  });

  it("matches health route", () => {
    const route = matchRoute("/health", testConfig);
    expect(route?.type).toBe("health");
  });

  it("matches doc route for known collection", () => {
    const route = matchRoute("/blog/post-1", testConfig);
    expect(route?.type).toBe("doc");
    expect(route?.slug).toBe("blog/post-1");
  });

  it("returns doc route for unknown collection", () => {
    const route = matchRoute("/unknown/path", testConfig);
    expect(route?.type).toBe("doc");
    expect(route?.slug).toBe("unknown/path");
  });

  it("returns collection docs", async () => {
    const docs = await getCollectionDocs("blog");
    expect(docs).toContain("blog/post-1");
    expect(docs).toContain("blog/post-2");
  });

  it("returns taxonomy docs", async () => {
    const docs = await getTaxonomyDocs("tags", "javascript");
    expect(docs).toEqual([]);
  });
});
