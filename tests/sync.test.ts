import fs from "node:fs";
import path from "node:path";
import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import { pushToRemote, syncTwoWay } from "../src/sync/sync-manager";
import type { HypernextConfig } from "../src/types/config";

const randomSuffix = Math.random().toString(36).slice(2, 8);
const TMP_CONTENT = path.resolve(
  import.meta.dirname,
  "..",
  `tmp-sync-test-${randomSuffix}`
);

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: TMP_CONTENT } },
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
  remote: {
    enabled: true,
    url: "http://remote.example.com",
    token: "test-token",
  },
  mcp: { enabled: false, transport: "stdio" },
};

describe("sync manager", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    fs.mkdirSync(TMP_CONTENT, { recursive: true });
  });

  afterAll(async () => {
    await closeOrm();
    fs.rmSync(TMP_CONTENT, { recursive: true, force: true });
  });

  it("pushToRemote throws when remote not configured", async () => {
    const noRemote = { ...testConfig, remote: undefined };
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
    await expect(pushToRemote(noRemote, () => {})).rejects.toThrow(
      "Remote server not configured"
    );
  });

  it("pushToRemote throws when no content directory", async () => {
    const noContent = {
      ...testConfig,
      storage: {
        type: "local" as const,
        local: { path: "/nonexistent-xyz-dir" },
      },
    };
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
    await expect(pushToRemote(noContent, () => {})).rejects.toThrow(
      "No content directory found"
    );
  });

  it("pushToRemote sends PUT requests for MDX files", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    fs.mkdirSync(path.join(TMP_CONTENT, "blog"), { recursive: true });
    fs.writeFileSync(path.join(TMP_CONTENT, "blog", "test.mdx"), "# Test");

    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
    await pushToRemote(testConfig, () => {});

    expect(mockFetch).toHaveBeenCalledWith(
      "http://remote.example.com/api/v1/docs/blog/test",
      expect.objectContaining({ method: "PUT" })
    );

    vi.unstubAllGlobals();
  });

  it("syncTwoWay throws when remote not configured", async () => {
    const noRemote = { ...testConfig, remote: undefined };
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
    await expect(syncTwoWay(noRemote, () => {})).rejects.toThrow(
      "Remote server not configured"
    );
  });

  it("syncTwoWay fetches remote index and pushes local changes", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ docs: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await insertDoc({
      slug: "blog/local-only",
      title: "Local",
      rawMdx: "# Local",
    });
    // Create the file on disk so pushLocalChanges can find it
    fs.mkdirSync(path.join(TMP_CONTENT, "blog"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP_CONTENT, "blog", "local-only.mdx"),
      "# Local"
    );

    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op progress callback
    await syncTwoWay(testConfig, () => {});

    // Should have called fetch for remote index
    expect(mockFetch).toHaveBeenCalledWith(
      "http://remote.example.com/api/v1/docs?limit=1000",
      expect.any(Object)
    );

    // Should have tried to push local-only since no remote doc exists
    expect(mockFetch).toHaveBeenCalledWith(
      "http://remote.example.com/api/v1/docs/blog/local-only",
      expect.objectContaining({ method: "PUT" })
    );

    vi.unstubAllGlobals();
  });
});
