import { describe, expect, it } from "vitest";
import {
  buildDeletionEvent,
  buildLongFormArticleEvent,
  buildProfileMetadataEvent,
  buildRelayListEvent,
  rewriteInternalLinks,
} from "../src/federation/nostr/events";

describe("nostr-events", () => {
  const mockCreatedAt = 1_700_000_000;

  describe("buildLongFormArticleEvent", () => {
    it("should build kind 30023 event with title and content", () => {
      const result = buildLongFormArticleEvent({
        slug: "test-article",
        title: "Test Article",
        contentMarkdown: "This is the article content",
        hashtags: [],
        publishedAt: mockCreatedAt,
        createdAt: mockCreatedAt,
      });

      expect(result.kind).toBe(30_023);
      expect(result.created_at).toBe(mockCreatedAt);

      const titleTag = result.tags.find((t) => t[0] === "title");
      expect(titleTag).toBeDefined();
      expect(titleTag?.[1]).toBe("Test Article");

      const dTag = result.tags.find((t) => t[0] === "d");
      expect(dTag).toBeDefined();
      expect(dTag?.[1]).toBe("test-article");
    });

    it("should include summary tag when provided", () => {
      const result = buildLongFormArticleEvent({
        slug: "test",
        title: "Test",
        contentMarkdown: "Content",
        hashtags: [],
        publishedAt: mockCreatedAt,
        summary: "Article summary",
      });

      const summaryTag = result.tags.find((t) => t[0] === "summary");
      expect(summaryTag).toBeDefined();
      expect(summaryTag?.[1]).toBe("Article summary");
    });

    it("should include image tag when provided", () => {
      const result = buildLongFormArticleEvent({
        slug: "test",
        title: "Test",
        contentMarkdown: "Content",
        hashtags: [],
        publishedAt: mockCreatedAt,
        imageUrl: "https://example.com/image.jpg",
      });

      const imageTag = result.tags.find((t) => t[0] === "image");
      expect(imageTag).toBeDefined();
      expect(imageTag?.[1]).toBe("https://example.com/image.jpg");
    });

    it("should include hashtags when provided", () => {
      const result = buildLongFormArticleEvent({
        slug: "test",
        title: "Test",
        contentMarkdown: "Content",
        hashtags: ["nostr", "bitcoin"],
        publishedAt: mockCreatedAt,
      });

      const hashtagTags = result.tags.filter((t) => t[0] === "t");
      expect(hashtagTags.length).toBe(2);
      expect(hashtagTags[0][1]).toBe("nostr");
      expect(hashtagTags[1][1]).toBe("bitcoin");
    });
  });

  describe("buildProfileMetadataEvent", () => {
    it("should build kind 0 event with profile data", () => {
      const result = buildProfileMetadataEvent({
        name: "Test User",
        about: "About test user",
        picture: "https://example.com/avatar.png",
        nip05: "test@example.com",
      });

      expect(result.kind).toBe(0);

      const content = JSON.parse(result.content as string);
      expect(content.name).toBe("Test User");
      expect(content.about).toBe("About test user");
      expect(content.picture).toBe("https://example.com/avatar.png");
      expect(content.nip05).toBe("test@example.com");
    });
  });

  describe("buildDeletionEvent", () => {
    it("should build kind 5 deletion event", () => {
      const result = buildDeletionEvent({
        targetEventId: "test-event-id",
        reason: "Outdated content",
      });

      expect(result.kind).toBe(5);
      expect(result.content).toBe("Outdated content");

      const eTag = result.tags.find((t) => t[0] === "e");
      expect(eTag).toBeDefined();
      expect(eTag?.[1]).toBe("test-event-id");
    });
  });

  describe("buildRelayListEvent", () => {
    it("should build kind 10002 relay list event", () => {
      const result = buildRelayListEvent({
        relays: [
          { url: "wss://relay.example.com", read: true, write: true },
          { url: "wss://nostr.example.com", read: true, write: false },
        ],
      });

      expect(result.kind).toBe(10_002);

      const relayTags = result.tags.filter((t) => t[0] === "r");
      expect(relayTags.length).toBe(2);
      expect(relayTags[0][1]).toBe("wss://relay.example.com");
    });
  });

  describe("rewriteInternalLinks", () => {
    it("should convert relative links to absolute", () => {
      const result = rewriteInternalLinks(
        "Check out [this post](/posts/my-post)",
        "https://example.com"
      );
      expect(result).toContain("https://example.com/posts/my-post");
    });

    it("should preserve absolute links", () => {
      const result = rewriteInternalLinks(
        "Visit [Google](https://google.com)",
        "https://example.com"
      );
      expect(result).toContain("https://google.com");
    });

    it("should handle multiple links", () => {
      const result = rewriteInternalLinks(
        "Links: [one](/one) and [two](/two)",
        "https://example.com"
      );
      expect(result).toContain("https://example.com/one");
      expect(result).toContain("https://example.com/two");
    });
  });
});
