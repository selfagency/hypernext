import { beforeAll, describe, expect, it } from "vitest";
import { getEm, initOrm } from "../src/database/index.js";
import { resolveComponent } from "../src/parser/resolver.js";
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
    it("returns navigation links", async () => {
      const nodes = await resolveComponent(
        "NavMenu",
        {},
        { config: testConfig }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("nav");
      expect(nodes[0]?.className).toBe("nav-menu");
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

  describe("Title component", () => {
    it("returns heading with slug-based title when no frontmatter", async () => {
      const nodes = await resolveComponent(
        "Title",
        {},
        { config: testConfig, currentSlug: "blog/test-post" }
      );
      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.type).toBe("heading");
      expect(nodes[0]?.depth).toBe(1);
      expect(nodes[0]?.className).toBe("p-name");
      expect(nodes[0]?.children?.[0]?.value).toBe("test-post");
    });

    it("returns heading with frontmatter title when available", async () => {
      const nodes = await resolveComponent(
        "Title",
        {},
        {
          config: testConfig,
          currentSlug: "blog/my-post",
          frontmatter: { title: "My Post" },
        }
      );
      expect(nodes[0]?.children?.[0]?.value).toBe("My Post");
    });

    it("includes permalink link", async () => {
      const nodes = await resolveComponent(
        "Title",
        {},
        { config: testConfig, currentSlug: "blog/my-post" }
      );
      expect(nodes[1]?.type).toBe("paragraph");
      expect(nodes[1]?.children?.[0]?.type).toBe("link");
      expect(nodes[1]?.children?.[0]?.url).toBe("/blog/my-post");
      expect(nodes[1]?.children?.[0]?.className).toBe("u-url");
    });
  });

  describe("PostMeta component", () => {
    it("returns empty when no author, date, or tags", async () => {
      const noAuthConfig = { ...testConfig, author: {} };
      const nodes = await resolveComponent(
        "PostMeta",
        {},
        { config: noAuthConfig, currentSlug: "test", frontmatter: {} }
      );
      expect(nodes).toHaveLength(0);
    });

    it("renders author from config", async () => {
      const cfg = { ...testConfig, author: { name: "Test Author" } };
      const nodes = await resolveComponent(
        "PostMeta",
        {},
        { config: cfg, currentSlug: "test", frontmatter: {} }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("paragraph");
      expect(nodes[0]?.className).toBe("byline");
      expect(nodes[0]?.children?.[0]?.value).toBe("by Test Author");
    });

    it("renders date when present", async () => {
      const cfg = { ...testConfig, author: { name: "Author" } };
      const nodes = await resolveComponent(
        "PostMeta",
        {},
        {
          config: cfg,
          currentSlug: "test",
          frontmatter: { date: "2026-07-20" },
        }
      );
      const byline = nodes[0]?.children ?? [];
      const timeNode = byline.find((n) => n.type === "time");
      expect(timeNode?.value).toBe("2026-07-20");
      expect(timeNode?.datetime).toBe("2026-07-20");
      expect(timeNode?.className).toBe("dt-published");
    });

    it("renders tags as links", async () => {
      const cfg = { ...testConfig, author: { name: "A" } };
      const nodes = await resolveComponent(
        "PostMeta",
        {},
        {
          config: cfg,
          currentSlug: "test",
          frontmatter: { tags: ["hypernext", "testing"] },
        }
      );
      const links = nodes[0]?.children?.filter((n) => n.type === "link") ?? [];
      expect(links.length).toBe(2);
      expect(links[0]?.url).toBe("/tags/hypernext");
      expect(links[1]?.url).toBe("/tags/testing");
    });

    it("handles invalid date gracefully", async () => {
      const cfg = { ...testConfig, author: { name: "A" } };
      const nodes = await resolveComponent(
        "PostMeta",
        {},
        {
          config: cfg,
          currentSlug: "test",
          frontmatter: { date: "not-a-date" },
        }
      );
      const timeNode = nodes[0]?.children?.find((n) => n.type === "time");
      expect(timeNode?.value).toBe("not-a-date");
    });
  });
});
