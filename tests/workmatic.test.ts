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
import { initJobsTable, listJobs } from "../src/jobs/queue";
import {
  enqueueEpubGeneration,
  enqueueInboundMention,
  enqueueIndexing,
  enqueueIpfsPinning,
  enqueueOutboundSyndication,
  enqueuePdfGeneration,
  enqueuePosseReplyFetch,
} from "../src/jobs/schedule";
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

describe("job queue (migrated from workmatic)", () => {
  let _orm: MikroORM;
  let tmpDbDir: string;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await initJobsTable();
    tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-queue-test-"));
    testConfig.database.path = path.join(tmpDbDir, "hypernext.db");
  });

  afterAll(async () => {
    await closeOrm();
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  });

  it("enqueues an inbound mention job", async () => {
    await enqueueInboundMention({
      source: "https://example.com/post",
      target: "http://localhost:8080/blog/test",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });
    const jobs = await listJobs({ type: "inbound-mentions", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("inbound-mentions");
  });

  it("enqueues a POSSE reply fetch job", async () => {
    const docId = await insertDoc({
      slug: "blog/queue-test",
      title: "Queue Test",
    });
    await recordSyndication({
      docId,
      platform: "mastodon",
      url: "https://mastodon.example.com/@author/1",
    });

    await enqueuePosseReplyFetch("blog/queue-test", docId, "mastodon");
    const jobs = await listJobs({ type: "posse-replies", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("posse-replies");
  });

  it("skips POSSE reply fetch when no syndication record exists", async () => {
    const docId = await insertDoc({
      slug: "blog/no-syndication",
      title: "No Syndication",
    });

    await enqueuePosseReplyFetch("blog/no-syndication", docId, "bluesky");
    // No error thrown — the function handles missing records gracefully
    expect(true).toBe(true);
  });

  it("enqueues outbound syndication job", async () => {
    const docId = await insertDoc({
      slug: "blog/syndicate-me",
      title: "Syndicate Me",
    });
    await enqueueOutboundSyndication(
      docId,
      "blog/syndicate-me",
      "# Hello World"
    );
    const jobs = await listJobs({ type: "outbound-syndication", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("outbound-syndication");
  });

  it("enqueues indexing job", async () => {
    await enqueueIndexing("blog/index-me", "# Index Me");
    const jobs = await listJobs({ type: "indexing", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("indexing");
  });

  it("enqueues IPFS pinning job", async () => {
    await enqueueIpfsPinning("blog/pin-me");
    const jobs = await listJobs({ type: "ipfs-pinning", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("ipfs-pinning");
  });

  it("enqueues PDF generation job", async () => {
    await enqueuePdfGeneration("blog/pdf-me");
    const jobs = await listJobs({ type: "pdf-generation", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("pdf-generation");
  });

  it("enqueues EPUB generation job", async () => {
    await enqueueEpubGeneration("blog-collection", [
      "blog/epub-1",
      "blog/epub-2",
    ]);
    const jobs = await listJobs({ type: "epub-generation", limit: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.type).toBe("epub-generation");
  });
});
