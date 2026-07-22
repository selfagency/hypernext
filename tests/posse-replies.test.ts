import type { MikroORM } from "@mikro-orm/sqlite";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeOrm,
  getEm,
  initOrm,
  insertDoc,
  recordSyndication,
} from "../src/database";
import { Mention } from "../src/database/entities/mention";
import {
  fetchBlueskyReplies,
  fetchMastodonReplies,
} from "../src/federation/posse-replies";
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
  syndication: {
    mastodon: {
      enabled: true,
      instance: "https://mastodon.example.com",
      accessToken: "test-token",
    },
    bluesky: {
      enabled: true,
      service: "https://bsky.social",
      identifier: "test.bsky.social",
      accessToken: "test-token",
    },
  },
  mcp: { enabled: false, transport: "stdio" },
};

const MASTODON_CONTEXT_RESPONSE = {
  descendants: [
    {
      id: "12345",
      content: "<p>Great post!</p>",
      account: {
        acct: "alice@mastodon.example.com",
        display_name: "Alice",
        url: "https://mastodon.example.com/@alice",
        avatar: "https://mastodon.example.com/avatars/alice.jpg",
      },
      created_at: "2026-07-16T12:00:00.000Z",
      url: "https://mastodon.example.com/@alice/12345",
    },
    {
      id: "12346",
      content: "<p>I agree!</p>",
      account: {
        acct: "bob",
        display_name: "Bob",
        url: "https://mastodon.example.com/@bob",
        avatar: "https://mastodon.example.com/avatars/bob.jpg",
      },
      created_at: "2026-07-16T13:00:00.000Z",
      url: "https://mastodon.example.com/@bob/12346",
    },
  ],
};

const BLUESKY_THREAD_RESPONSE = {
  thread: {
    replies: [
      {
        post: {
          uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
          author: {
            handle: "alice.bsky.social",
            displayName: "Alice",
            avatar: "https://cdn.bsky.app/avatars/alice.jpg",
          },
          record: {
            text: "Great post!",
            createdAt: "2026-07-16T12:00:00.000Z",
          },
          indexedAt: "2026-07-16T12:00:00.000Z",
        },
      },
    ],
  },
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

describe("POSSE reply fetching", () => {
  let _orm: MikroORM;
  let docId: number;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    docId = await insertDoc({
      slug: "blog/posse-post",
      title: "POSSE Post",
    });
    await recordSyndication({
      docId,
      platform: "mastodon",
      url: "https://mastodon.example.com/@author/99999",
    });
    await recordSyndication({
      docId,
      platform: "bluesky",
      url: "at://did:plc:author/app.bsky.feed.post/xyz789",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  describe("fetchMastodonReplies", () => {
    it("stores replies from Mastodon context", async () => {
      server.use(
        http.get(
          "https://mastodon.example.com/api/v1/statuses/99999/context",
          () => HttpResponse.json(MASTODON_CONTEXT_RESPONSE)
        )
      );

      await fetchMastodonReplies(
        testConfig,
        "blog/posse-post",
        "https://mastodon.example.com/@author/99999"
      );

      const em = getEm();
      const mentions = await em.find(Mention, {
        targetSlug: "blog/posse-post",
        platform: "mastodon",
      });
      expect(mentions.length).toBe(2);
      expect(mentions.map((m) => m.authorName)).toContain("Alice");
      expect(mentions.map((m) => m.authorName)).toContain("Bob");
    });

    it("skips already-existing mentions", async () => {
      // Run again — should not create duplicates
      server.use(
        http.get(
          "https://mastodon.example.com/api/v1/statuses/99999/context",
          () => HttpResponse.json(MASTODON_CONTEXT_RESPONSE)
        )
      );

      await fetchMastodonReplies(
        testConfig,
        "blog/posse-post",
        "https://mastodon.example.com/@author/99999"
      );

      const em = getEm();
      const mentions = await em.find(Mention, {
        targetSlug: "blog/posse-post",
        platform: "mastodon",
      });
      expect(mentions.length).toBe(2); // still 2, not 4
    });

    it("handles empty descendants gracefully", async () => {
      server.use(
        http.get(
          "https://mastodon.example.com/api/v1/statuses/99999/context",
          () => HttpResponse.json({ descendants: [] })
        )
      );

      // Should not throw
      await fetchMastodonReplies(
        testConfig,
        "blog/posse-post",
        "https://mastodon.example.com/@author/99999"
      );
    });

    it("handles API error gracefully", async () => {
      server.use(
        http.get(
          "https://mastodon.example.com/api/v1/statuses/99999/context",
          () => HttpResponse.error()
        )
      );

      // Should not throw
      await fetchMastodonReplies(
        testConfig,
        "blog/posse-post",
        "https://mastodon.example.com/@author/99999"
      );
    });
  });

  describe("fetchBlueskyReplies", () => {
    it("stores replies from Bluesky thread", async () => {
      server.use(
        http.get("https://bsky.social/xrpc/app.bsky.feed.getPostThread", () =>
          HttpResponse.json(BLUESKY_THREAD_RESPONSE)
        )
      );

      await fetchBlueskyReplies(
        testConfig,
        "blog/posse-post",
        "at://did:plc:author/app.bsky.feed.post/xyz789"
      );

      const em = getEm();
      const mentions = await em.find(Mention, {
        targetSlug: "blog/posse-post",
        platform: "bluesky",
      });
      expect(mentions).toHaveLength(1);
      expect(mentions[0].authorName).toBe("Alice");
      expect(mentions[0].spamStatus).toBe("ham");
    });

    it("skips already-existing Bluesky mentions", async () => {
      server.use(
        http.get("https://bsky.social/xrpc/app.bsky.feed.getPostThread", () =>
          HttpResponse.json(BLUESKY_THREAD_RESPONSE)
        )
      );

      await fetchBlueskyReplies(
        testConfig,
        "blog/posse-post",
        "at://did:plc:author/app.bsky.feed.post/xyz789"
      );

      const em = getEm();
      const mentions = await em.find(Mention, {
        targetSlug: "blog/posse-post",
        platform: "bluesky",
      });
      expect(mentions).toHaveLength(1); // still 1
    });

    it("handles empty replies gracefully", async () => {
      server.use(
        http.get("https://bsky.social/xrpc/app.bsky.feed.getPostThread", () =>
          HttpResponse.json({ thread: {} })
        )
      );

      // Should not throw
      await fetchBlueskyReplies(
        testConfig,
        "blog/posse-post",
        "at://did:plc:author/app.bsky.feed.post/xyz789"
      );
    });

    it("handles API error gracefully", async () => {
      server.use(
        http.get("https://bsky.social/xrpc/app.bsky.feed.getPostThread", () =>
          HttpResponse.error()
        )
      );

      // Should not throw
      await fetchBlueskyReplies(
        testConfig,
        "blog/posse-post",
        "at://did:plc:author/app.bsky.feed.post/xyz789"
      );
    });
  });
});
