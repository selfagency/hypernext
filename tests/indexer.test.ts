import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import {
  indexDocument,
  reindexAll,
  watchStorage,
} from "../src/indexer/index.js";
import { createStorage, getStorage } from "../src/storage/index.js";
import type { HypernextConfig } from "../src/types/config.js";

const tmpDir = path.resolve("./tmp-indexer-test");

const TEST_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
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
  storage: { type: "local", local: { path: tmpDir } },
  api: { enabled: false },
  syndication: {},
  taxonomies: [{ name: "tags", plural: "tags", singular: "tag" }],
};

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpDir, "blog"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "blog", "hello.mdx"),
    "---\ntitle: Hello\ndate: 2026-07-20\ntype: post\ntags:\n  - test-tag\n---\n\nHello World"
  );
  fs.writeFileSync(
    path.join(tmpDir, "about.mdx"),
    "---\ntitle: About\ndate: 2026-07-19\ntype: page\n---\n\nAbout page."
  );
  await initOrm(":memory:");
  createStorage(TEST_CONFIG);
});

afterAll(async () => {
  await closeOrm();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("indexer", () => {
  it("indexes a document with frontmatter", async () => {
    const content = fs.readFileSync(
      path.join(tmpDir, "blog", "hello.mdx"),
      "utf-8"
    );
    await indexDocument("blog/hello", content);
    const storage = getStorage();
    const slugs = await storage.list();
    expect(slugs).toContain("blog/hello");
  });

  it("reindexAll indexes all documents", async () => {
    await reindexAll(TEST_CONFIG);
    const storage = getStorage();
    const slugs = await storage.list();
    expect(slugs).toContain("blog/hello");
    expect(slugs).toContain("about");
  });

  it("reindexAll handles failures gracefully", async () => {
    // Create a file that will fail to parse
    fs.writeFileSync(
      path.join(tmpDir, "broken.mdx"),
      "---\ninvalid: [unclosed\n---\n\nBroken"
    );
    // Should not throw
    await expect(reindexAll(TEST_CONFIG)).resolves.toBeUndefined();
  });

  it("watchStorage returns a cleanup function for local storage", () => {
    const cleanup = watchStorage(TEST_CONFIG);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("watchStorage returns noop for non-local storage", () => {
    const cleanup = watchStorage({
      ...TEST_CONFIG,
      storage: { type: "s3", s3: { bucket: "test", region: "us-east-1" } },
    });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("watchStorage creates storage directory if missing", () => {
    const missingDir = path.resolve("./tmp-missing-dir");
    const cleanup = watchStorage({
      ...TEST_CONFIG,
      storage: { type: "local", local: { path: missingDir } },
    });
    expect(fs.existsSync(missingDir)).toBe(true);
    fs.rmSync(missingDir, { recursive: true, force: true });
    cleanup();
  });
});
