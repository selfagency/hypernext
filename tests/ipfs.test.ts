import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, getDocBySlug, initOrm, insertDoc } from "../src/database";
import { resolveComponent } from "../src/parser/components";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "https://example.com",
    meta: { title: "Test Site", description: "Test", lang: "en" },
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
  ipfs: {
    enabled: true,
    apiEndpoint: "http://127.0.0.1:5001",
    gatewayUrl: "https://ipfs.io/ipfs",
    pinning: true,
    cacheHtml: true,
  },
};

describe("IPFS integration", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  describe("IPFSLink component", () => {
    it("returns empty when no current slug", async () => {
      const nodes = await resolveComponent(
        "IPFSLink",
        {},
        { config: testConfig }
      );
      expect(nodes).toHaveLength(0);
    });

    it("returns empty when doc has no CID", async () => {
      await insertDoc({ slug: "blog/no-cid", title: "No CID" });
      const nodes = await resolveComponent(
        "IPFSLink",
        {},
        { config: testConfig, currentSlug: "blog/no-cid" }
      );
      expect(nodes).toHaveLength(0);
    });

    it("returns link when doc has html_cid", async () => {
      await insertDoc({
        slug: "blog/with-cid",
        title: "With CID",
        htmlCid: "bafyreiab3test",
      });
      const nodes = await resolveComponent(
        "IPFSLink",
        {},
        { config: testConfig, currentSlug: "blog/with-cid" }
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe("paragraph");
      const link = nodes[0]?.children?.[0];
      expect(link?.type).toBe("link");
      expect(link?.url).toContain("bafyreiab3test");
      expect(link?.url).toContain("https://ipfs.io/ipfs");
    });

    it("falls back to content_cid when html_cid is absent", async () => {
      await insertDoc({
        slug: "blog/content-cid-only",
        title: "Content CID Only",
        contentCid: "bafyreiccontent123",
      });
      const nodes = await resolveComponent(
        "IPFSLink",
        {},
        { config: testConfig, currentSlug: "blog/content-cid-only" }
      );
      expect(nodes).toHaveLength(1);
      const link = nodes[0]?.children?.[0];
      expect(link?.url).toContain("bafyreiccontent123");
    });

    it("uses custom gateway URL from config", async () => {
      const customConfig: HypernextConfig = {
        ...testConfig,
        ipfs: {
          // biome-ignore lint/style/noNonNullAssertion: testConfig.ipfs is set in beforeAll
          ...testConfig.ipfs!,
          gatewayUrl: "https://dweb.link/ipfs",
        },
      };
      await insertDoc({
        slug: "blog/custom-gateway",
        title: "Custom Gateway",
        htmlCid: "bafyreidcustom",
      });
      const nodes = await resolveComponent(
        "IPFSLink",
        {},
        { config: customConfig, currentSlug: "blog/custom-gateway" }
      );
      const link = nodes[0]?.children?.[0];
      expect(link?.url).toContain("https://dweb.link/ipfs");
    });
  });

  describe("DocMeta CID storage", () => {
    it("persists contentCid and htmlCid", async () => {
      await insertDoc({
        slug: "blog/cid-persist",
        title: "CID Persist",
        contentCid: "bafycontent999",
        htmlCid: "bafyhtml888",
      });
      const doc = await getDocBySlug("blog/cid-persist");
      expect(doc).not.toBeNull();
      expect(doc?.contentCid).toBe("bafycontent999");
      expect(doc?.htmlCid).toBe("bafyhtml888");
    });
  });
});
