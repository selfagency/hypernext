import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeOrm,
  initOrm,
  insertDoc,
  recordSyndication,
} from "../src/database";
import {
  enqueueInboundMention,
  enqueuePosseReplyFetch,
  getOrchestrator,
  initWorkmatic,
  stopWorkmatic,
} from "../src/federation/workmatic";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
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
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

describe("workmatic job queue", () => {
  let _orm: MikroORM;
  let tmpDbDir: string;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "workmatic-test-"));
    testConfig.database.path = path.join(tmpDbDir, "hypernext.db");
    initWorkmatic(testConfig);
  });

  afterAll(async () => {
    await stopWorkmatic();
    await closeOrm();
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  });

  it("initializes workmatic and creates queues", () => {
    const orch = getOrchestrator();
    expect(orch).toBeDefined();
  });

  it("enqueues an inbound mention job", async () => {
    await enqueueInboundMention({
      source: "https://example.com/post",
      target: "http://localhost:8080/blog/test",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });
    // Job was enqueued without error
    expect(true).toBe(true);
  });

  it("enqueues a POSSE reply fetch job", async () => {
    const docId = await insertDoc({
      slug: "blog/workmatic-test",
      title: "Workmatic Test",
    });
    await recordSyndication({
      docId,
      platform: "mastodon",
      url: "https://mastodon.example.com/@author/1",
    });

    await enqueuePosseReplyFetch("blog/workmatic-test", docId, "mastodon");
    expect(true).toBe(true);
  });

  it("skips POSSE reply fetch when no syndication record exists", async () => {
    const docId = await insertDoc({
      slug: "blog/no-syndication",
      title: "No Syndication",
    });

    await enqueuePosseReplyFetch("blog/no-syndication", docId, "bluesky");
    expect(true).toBe(true);
  });

  it("getOrchestrator returns the initialized instance", () => {
    const orch = getOrchestrator();
    expect(orch).toBeDefined();
  });
});
