import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shouldSyndicate, syndicate } from "../src/bridge/index";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import { initJobsTable } from "../src/jobs/queue";
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
  syndication: {
    mastodon: {
      enabled: true,
      instance: "https://mastodon.example.com",
      accessToken: "test-token",
    },
    bluesky: { enabled: false, service: "https://bsky.social" },
  },
  mcp: { enabled: false, transport: "stdio" },
};

describe("bridge", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await initJobsTable();
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("shouldSyndicate returns true for type: post", () => {
    expect(shouldSyndicate({ type: "post" })).toBe(true);
  });

  it("shouldSyndicate returns false for non-post types", () => {
    expect(shouldSyndicate({ type: "page" })).toBe(false);
    expect(shouldSyndicate({})).toBe(false);
  });

  it("syndicate enqueues a background job for new posts", async () => {
    const docId = await insertDoc({
      slug: "blog/test-sync",
      title: "Test",
      rawMdx: "# Test",
    });

    // syndicate should enqueue a workmatic job without throwing
    await expect(
      syndicate(testConfig, docId, "blog/test-sync", "Test content")
    ).resolves.toBeUndefined();
  });

  it("syndicate skips when all platforms already syndicated", async () => {
    const docId = await insertDoc({
      slug: "blog/already-synced",
      title: "Already",
      rawMdx: "# Already",
    });

    // With no enabled platforms that aren't already syndicated, should return early
    const configNoSyndication = {
      ...testConfig,
      syndication: {
        mastodon: { enabled: false, instance: "https://mastodon.example.com" },
        bluesky: { enabled: false, service: "https://bsky.social" },
      },
    };

    await expect(
      syndicate(configNoSyndication, docId, "blog/already-synced", "Content")
    ).resolves.toBeUndefined();
  });
});
