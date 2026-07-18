import fs from "node:fs";
import path from "node:path";
import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeOrm, initOrm } from "../src/database";
import { ingestUrl } from "../src/ingest/ingest-manager";
import { createStorage, getStorage } from "../src/storage/index";
import type { HypernextConfig } from "../src/types/config";

const randomSuffix = Math.random().toString(36).slice(2, 8);
const TMP_DIR = path.resolve(
  import.meta.dirname,
  "..",
  `tmp-ingest-${randomSuffix}`
);

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: TMP_DIR } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {},
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

describe("ingest manager", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    fs.mkdirSync(TMP_DIR, { recursive: true });
    createStorage(testConfig);
  });

  afterAll(async () => {
    await closeOrm();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("ingestUrl fetches URL, converts to MDX, and saves", async () => {
    const mockHtml =
      "<html><head><title>Test Page</title></head><body><h1>Hello World</h1><p>This is a test.</p></body></html>";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });
    vi.stubGlobal("fetch", mockFetch);

    const slug = await ingestUrl(
      {
        url: "https://example.com/test",
        collection: "library",
        filename: "test-page",
      },
      testConfig,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
      () => {}
    );

    expect(slug).toBe("library/test-page");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.any(Object)
    );

    // Check the file was written via storage
    const content = await getStorage().read("library/test-page");
    expect(content).toContain('title: "Hello World"');
    expect(content).toContain('source_url: "https://example.com/test"');
    expect(content).toContain("Hello World");

    vi.unstubAllGlobals();
  });

  it("ingestUrl strips script, style, nav, footer tags", async () => {
    const mockHtml = `<html><head><title>Clean</title></head><body>
      <nav>Navigation</nav>
      <article><p>Main content</p></article>
      <footer>Footer</footer>
      <script>alert('xss')</script>
    </body></html>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });
    vi.stubGlobal("fetch", mockFetch);

    const slug = await ingestUrl(
      {
        url: "https://example.com/clean",
        collection: "blog",
        filename: "clean-post",
      },
      testConfig,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
      () => {}
    );

    expect(slug).toBe("blog/clean-post");
    const content = await getStorage().read("blog/clean-post");
    expect(content).not.toContain("Navigation");
    expect(content).not.toContain("Footer");
    expect(content).not.toContain("xss");
    expect(content).toContain("Main content");

    vi.unstubAllGlobals();
  });

  it("ingestUrl throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      ingestUrl(
        {
          url: "https://example.com/404",
          collection: "library",
          filename: "missing",
        },
        testConfig,
        // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
        () => {}
      )
    ).rejects.toThrow("Failed to fetch URL: 404");

    vi.unstubAllGlobals();
  });
});
