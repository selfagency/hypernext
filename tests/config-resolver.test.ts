import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import {
  getGlobalCommentConfig,
  resolveCommentConfig,
} from "../src/federation/config-resolver";
import type { HypernextConfig } from "../src/types/config";

const baseConfig: HypernextConfig = {
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

describe("comment config resolver", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  describe("getGlobalCommentConfig", () => {
    it("returns defaults when no comments config", () => {
      const result = getGlobalCommentConfig(baseConfig);
      expect(result.enabled).toBe(true);
      expect(result.inbound.webmention).toBe(true);
      expect(result.inbound.pingback).toBe(true);
      expect(result.inbound.trackback).toBe(false);
      expect(result.aggregation.mastodon).toBe(true);
      expect(result.aggregation.bluesky).toBe(true);
      expect(result.aggregation.cacheTtl).toBe(900);
      expect(result.akismet.enabled).toBe(true);
    });

    it("merges partial config over defaults", () => {
      const config: HypernextConfig = {
        ...baseConfig,
        comments: {
          enabled: false,
          inbound: { webmention: false, pingback: true, trackback: true },
          aggregation: { mastodon: false, bluesky: true, cacheTtl: 300 },
          akismet: { enabled: false },
        },
      };
      const result = getGlobalCommentConfig(config);
      expect(result.enabled).toBe(false);
      expect(result.inbound.webmention).toBe(false);
      expect(result.inbound.pingback).toBe(true);
      expect(result.inbound.trackback).toBe(true);
      expect(result.aggregation.mastodon).toBe(false);
      expect(result.aggregation.cacheTtl).toBe(300);
      expect(result.akismet.enabled).toBe(false);
    });
  });

  describe("resolveCommentConfig", () => {
    it("returns global defaults when doc has no frontmatter overrides", async () => {
      await insertDoc({
        slug: "blog/no-comments",
        title: "No Comments Config",
        metaJson: "{}",
      });
      const result = await resolveCommentConfig(baseConfig, "blog/no-comments");
      expect(result.inbound.webmention).toBe(true);
      expect(result.inbound.pingback).toBe(true);
      expect(result.aggregation.mastodon).toBe(true);
    });

    it("respects per-doc frontmatter overrides", async () => {
      await insertDoc({
        slug: "blog/overridden",
        title: "Overridden",
        metaJson: JSON.stringify({
          comments: {
            inbound: { webmention: false },
            aggregation: { bluesky: false },
          },
        }),
      });
      const result = await resolveCommentConfig(baseConfig, "blog/overridden");
      expect(result.inbound.webmention).toBe(false);
      expect(result.inbound.pingback).toBe(true); // not overridden
      expect(result.aggregation.bluesky).toBe(false);
      expect(result.aggregation.mastodon).toBe(true); // not overridden
    });

    it("disables everything when global enabled is false", async () => {
      const disabledConfig: HypernextConfig = {
        ...baseConfig,
        comments: {
          enabled: false,
          inbound: { webmention: true, pingback: true, trackback: false },
          aggregation: { mastodon: true, bluesky: true, cacheTtl: 900 },
          akismet: { enabled: true },
        },
      };
      await insertDoc({
        slug: "blog/disabled",
        title: "Disabled",
        metaJson: "{}",
      });
      const result = await resolveCommentConfig(
        disabledConfig,
        "blog/disabled"
      );
      expect(result.inbound.webmention).toBe(false);
      expect(result.inbound.pingback).toBe(false);
      expect(result.inbound.trackback).toBe(false);
      expect(result.aggregation.mastodon).toBe(false);
      expect(result.aggregation.bluesky).toBe(false);
    });

    it("throws on non-existent slug", async () => {
      await expect(
        resolveCommentConfig(baseConfig, "blog/nonexistent")
      ).rejects.toThrow("Document not found");
    });
  });
});
