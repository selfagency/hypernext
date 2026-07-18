import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeOrm,
  getDocBySlug,
  getEm,
  getOAuthToken,
  getSyndicationForDoc,
  getTermBySlug,
  getTermsForDoc,
  initOrm,
  insertDoc,
  recordSyndication,
  relateDocToTerm,
  searchDocs,
  storeOAuthToken,
  upsertTerm,
} from "../src/database";

describe("database", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("initializes schema with required tables", async () => {
    const em = getEm();
    const tables = await em
      .getConnection()
      .execute<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      );
    const names = tables.map((t) => t.name);
    expect(names).toContain("docs_meta");
    expect(names).toContain("terms");
    expect(names).toContain("term_relationships");
    expect(names).toContain("syndication");
    expect(names).toContain("oauth_tokens");
  });

  it("inserts and retrieves docs", async () => {
    const id = await insertDoc({
      slug: "blog/hello",
      title: "Hello World",
      rawMdx: "# Hello World",
    });
    expect(id).toBeGreaterThan(0);
    const doc = await getDocBySlug("blog/hello");
    expect(doc).toBeDefined();
    expect(doc?.title).toBe("Hello World");
  });

  it("searches via FTS5", async () => {
    await insertDoc({
      slug: "blog/one",
      title: "First Post",
      rawMdx: "alpha content",
    });
    await insertDoc({
      slug: "blog/two",
      title: "Second Post",
      rawMdx: "beta content",
    });
    const results = await searchDocs("alpha");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.slug).toBe("blog/one");
  });

  it("manages taxonomy terms and relationships", async () => {
    const docId = await insertDoc({ slug: "blog/tagged", title: "Tagged" });
    const termId = await upsertTerm("tags", "hello", "Hello");
    await relateDocToTerm(docId, termId);
    const terms = await getTermsForDoc(docId, "tags");
    expect(terms).toHaveLength(1);
    expect(terms[0]?.slug).toBe("hello");
  });

  it("records syndication", async () => {
    const docId = await insertDoc({
      slug: "blog/syndicated",
      title: "Syndicated",
    });
    await recordSyndication({
      docId,
      platform: "mastodon",
      url: "https://example.com/1",
    });
    const records = await getSyndicationForDoc(docId);
    expect(records).toHaveLength(1);
    expect(records[0]?.platform).toBe("mastodon");
  });

  it("stores OAuth tokens", async () => {
    await storeOAuthToken({
      provider: "indieauth",
      token: "secret-token",
      refreshToken: "refresh",
      expiresAt: "2026-12-31T23:59:59Z",
    });
    const stored = await getOAuthToken("indieauth");
    expect(stored).toBeDefined();
    expect(stored?.token).toBe("secret-token");
  });

  it("uses parameterized queries for safe term lookup", async () => {
    await upsertTerm("tags", "safe", "Safe");
    const term = await getTermBySlug("tags", "safe");
    expect(term).toBeDefined();
    expect(term?.name).toBe("Safe");
  });
});
