import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import { reindexAll } from "../src/indexer/index.js";
import { createStorage } from "../src/storage/index.js";
import { createHttpServer } from "../src/servers/http.js";
import type { HypernextConfig } from "../src/types/config.js";

const tmpDir = path.resolve("./tmp-http-test");

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Desc", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
  storage: { type: "local", local: { path: tmpDir } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: false },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
  },
  taxonomies: [{ name: "tags", plural: "tags", singular: "tag" }],
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
};

describe("HTTP server routes", () => {
  let app: Awaited<ReturnType<typeof createHttpServer>>;

  beforeAll(async () => {
    // Create fixture content directory with MDX files
    fs.mkdirSync(path.join(tmpDir, "blog"), { recursive: true });

    // Published blog post with tags
    fs.writeFileSync(
      path.join(tmpDir, "blog", "welcome.mdx"),
      [
        "---",
        "title: Welcome",
        "date: 2026-07-20",
        "type: post",
        "tags:",
        "  - test-tag",
        "  - getting-started",
        "---",
        "",
        "Welcome to the test site.",
      ].join("\n")
    );

    // Private blog post (should return 404)
    fs.writeFileSync(
      path.join(tmpDir, "blog", "private.mdx"),
      [
        "---",
        "title: Private Post",
        "date: 2026-07-19",
        "type: post",
        "visibility: private",
        "---",
        "",
        "This is a private post.",
      ].join("\n")
    );

    // Standalone about page
    fs.writeFileSync(
      path.join(tmpDir, "about.mdx"),
      [
        "---",
        "title: About Me",
        "date: 2026-07-18",
        "type: page",
        "---",
        "",
        "This is the about page.",
      ].join("\n")
    );

    // Initialize ORM with in-memory database and reindex all content
    await initOrm(":memory:");
    createStorage(testConfig);
    await reindexAll(testConfig);

    // Create the Fastify HTTP server (does not listen on a port)
    app = await createHttpServer(testConfig);
  });

  afterAll(async () => {
    // Cleanup: close Fastify, ORM, and remove temp dir
    await app.close();
    await closeOrm();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Home Page ──

  it("GET / returns 200 and home page HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    // Home page should include the site title
    expect(res.body).toContain("Test");
  });

  // ── Collection Root ──

  it("GET /blog returns 200 for known collection root", async () => {
    const res = await app.inject({ method: "GET", url: "/blog" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Test");
  });

  it("GET /nonexistent-collection returns 404 for unknown collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/nonexistent-collection",
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("404 Not Found");
  });

  // ── Document Lookup (Collection Slug) ──

  it("GET /blog/welcome returns 200 with document HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/blog/welcome" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    // The document title should appear in the rendered output
    expect(res.body).toContain("Welcome");
  });

  it("GET /blog/welcome returns correct content-type", async () => {
    const res = await app.inject({ method: "GET", url: "/blog/welcome" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET /blog/private returns 404 for private document", async () => {
    const res = await app.inject({ method: "GET", url: "/blog/private" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("404 Not Found");
  });

  it("GET /blog/nonexistent returns 404 for missing document", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/nonexistent",
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("404 Not Found");
  });

  // ── Standalone Page ──

  it("GET /about returns 200 for standalone page", async () => {
    const res = await app.inject({ method: "GET", url: "/about" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("About Me");
  });

  // ── Archive Routes ──

  it("GET /blog/archive/2026 returns 200 for year archive", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/archive/2026",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET /blog/archive/2026/07 returns 200 for year/month archive", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/archive/2026/07",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET /blog/archive/invalid returns 400 for non-numeric year", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/archive/invalid",
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("400 Bad Request");
  });

  // ── Taxonomy Routes ──

  it("GET /blog/tags/test-tag returns 200 for known taxonomy term", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/tags/test-tag",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET /blog/tags/nonexistent-tag returns 200 (empty archive list)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/tags/nonexistent-tag",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  // ── Author Routes ──

  it("GET /blog/authors/test-author returns 200 for author listing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/blog/authors/test-author",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  // ── Three-Segment Path Resolution (non-taxonomy fallback) ──

  it("GET /blog/some/deep-path returns 404 for unknown three-segment route", async () => {
    // /:collection/:taxonomy/:term where :taxonomy is not a known taxonomy name
    // falls through to document lookup — returns 404 when not found
    const res = await app.inject({
      method: "GET",
      url: "/blog/some/deep-path",
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("404 Not Found");
  });

  // ── Health Check ──

  it("GET /health returns 200 with JSON status", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("status", "ok");
  });

  // ── RSS Feed ──

  it("GET /rss.xml returns 200 with RSS XML", async () => {
    const res = await app.inject({ method: "GET", url: "/rss.xml" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/rss+xml");
    expect(res.body).toContain("<?xml");
    expect(res.body).toContain("<rss");
  });

  // ── robots.txt ──

  it("GET /robots.txt returns 200 with plain text", async () => {
    const res = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  // ── 404 for Unknown Routes ──

  it("GET /unknown-route returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/this/route/does/not/exist",
    });
    expect(res.statusCode).toBe(404);
  });

  // ── HEAD requests work ──

  it("HEAD / returns 200", async () => {
    const res = await app.inject({ method: "HEAD", url: "/" });
    expect(res.statusCode).toBe(200);
  });

  // ── POST to GET-only route returns 404 ──

  it("POST / returns 404 (route not defined for POST)", async () => {
    const res = await app.inject({ method: "POST", url: "/blog/welcome" });
    expect(res.statusCode).toBe(404);
  });
});
