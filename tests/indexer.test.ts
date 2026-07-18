import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, getDocBySlug, getEm, initOrm } from "../src/database";
import { indexDocument } from "../src/indexer/index";

describe("indexer", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("indexes a document with frontmatter", async () => {
    const mdx = `---
title: Test Post
date: 2026-07-16
tags: [javascript, typescript]
---

# Hello

World.`;
    await indexDocument("blog/test-post", mdx);
    const doc = await getDocBySlug("blog/test-post");
    expect(doc).toBeDefined();
    expect((doc as Record<string, unknown>).title).toBe("Test Post");
  });

  it("indexes taxonomy terms from frontmatter", async () => {
    const em = getEm();
    const terms = await em
      .getConnection()
      .execute<{ name: string }[]>("SELECT name FROM terms");
    expect(terms.map((t) => t.name)).toContain("javascript");
    expect(terms.map((t) => t.name)).toContain("typescript");
  });
});
