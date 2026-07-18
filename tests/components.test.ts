import { beforeAll, describe, expect, it } from "vitest";
import { getEm, initOrm } from "../src/database/index.js";
import { resolveComponent } from "../src/parser/components.js";
import type { HypernextConfig } from "../src/types/config.js";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "https://example.com",
    meta: {
      title: "Test Site",
      description: "Test",
      lang: "en",
    },
  },
  storage: { type: "local", basePath: "./content" },
  database: { dbName: ":memory:" },
  author: { name: "Test Author" },
  comments: {
    enabled: true,
    inbound: { webmention: true },
    akismet: { enabled: false },
  },
} as HypernextConfig;

describe("component resolvers", () => {
  beforeAll(async () => {
    await initOrm(testConfig.database.dbName);
  });

  describe("NavMenu component", () => {
    it("returns navigation links", () => {
      const nodes = resolveComponent("NavMenu", {}, { config: testConfig });
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("paragraph");
    });
  });

  describe("RecentPosts component", () => {
    it("returns empty message when no posts", async () => {
      const nodes = await resolveComponent(
        "RecentPosts",
        {},
        { config: testConfig }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("paragraph");
    });
  });

  describe("Comments component", () => {
    it("returns heading when no mentions exist for slug", async () => {
      const nodes = await resolveComponent(
        "Comments",
        {},
        { config: testConfig, currentSlug: "blog/no-mentions" }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("section");
      expect(nodes[0]?.className).toBe("h-feed comments");
      expect(nodes[0]?.id).toBe("comments");
      expect(nodes[0]?.children?.[0]?.type).toBe("heading");
      expect(nodes[0]?.children?.[0]?.children?.[0]?.value).toBe("Replies");
      expect(nodes[0]?.children?.[1]?.type).toBe("paragraph");
    });

    it("renders ham mentions as mention nodes", async () => {
      const em = getEm();

      // Insert a ham mention
      await em.getConnection().execute(
        `INSERT INTO mentions (id, target_slug, source_url, author_name, author_url, author_photo, content, published_at, type, platform, spam_status, seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "mention-1",
          "blog/post-1",
          "https://alice.example.com/post",
          "Alice",
          "https://alice.example.com",
          "https://alice.example.com/photo.jpg",
          "Great post!",
          Date.parse("2026-07-16T12:00:00Z"),
          "reply",
          "webmention",
          "ham",
          Date.now(),
        ]
      );

      const nodes = await resolveComponent(
        "Comments",
        {},
        { config: testConfig, currentSlug: "blog/post-1" }
      );
      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes[0]?.type).toBe("section");
      expect(nodes[0]?.children?.[0]?.type).toBe("heading");
      expect(nodes[0]?.children?.[0]?.children?.[0]?.value).toBe("Replies");
      expect(nodes[0]?.children?.[1]?.type).toBe("mention");
      expect(nodes[0]?.children?.[1]?.authorName).toBe("Alice");
      expect(nodes[0]?.children?.[1]?.content).toBe("Great post!");
    });

    it("skips spam mentions", async () => {
      const em = getEm();

      // Insert a spam mention
      await em.getConnection().execute(
        `INSERT INTO mentions (id, target_slug, source_url, author_name, author_url, author_photo, content, published_at, type, platform, spam_status, seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "mention-2",
          "blog/post-2",
          "https://spammer.example.com",
          "Spammer",
          "https://spammer.example.com",
          "",
          "Buy now!",
          Date.now(),
          "reply",
          "webmention",
          "spam",
          Date.now(),
        ]
      );

      const nodes = await resolveComponent(
        "Comments",
        {},
        { config: testConfig, currentSlug: "blog/post-2" }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("section");
      expect(nodes[0]?.children?.[0]?.type).toBe("heading");
      expect(nodes[0]?.children?.[0]?.children?.[0]?.value).toBe("Replies");
      expect(nodes[0]?.children?.[1]?.type).toBe("paragraph");
      expect(nodes[0]?.children?.[1]?.children?.[0]?.value).toBe(
        "No replies yet."
      );
    });
  });
});
