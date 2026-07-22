import type { MikroORM } from "@mikro-orm/sqlite";
import Fastify from "fastify";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, getEm, initOrm, insertDoc } from "../src/database";
import { Mention } from "../src/database/entities/mention";
import {
  processInboundMention,
  registerInboundRoutes,
} from "../src/federation/inbound";
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
  comments: {
    enabled: true,
    inbound: { webmention: true, pingback: true, trackback: true },
    aggregation: { mastodon: true, bluesky: true, cacheTtl: 900 },
    akismet: { enabled: false },
    allowPrivateSources: true,
  },
};

const HTML_WITH_LINK = `<!DOCTYPE html>
<html><body>
  <article class="h-entry">
    <div class="p-author h-card">
      <a class="p-name u-url" href="https://alice.example.com">Alice</a>
      <img class="u-photo" src="https://alice.example.com/photo.jpg" />
    </div>
    <div class="e-content"><p>Great post!</p></div>
    <time class="dt-published" datetime="2026-07-16T12:00:00Z">July 16</time>
  </article>
  <a href="http://localhost:8080/blog/my-post">My Post</a>
</body></html>`;

const HTML_WITHOUT_LINK = "<html><body>No link here</body></html>";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

describe("inbound mention processing", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/my-post",
      title: "My Post",
      metaJson: "{}",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("stores a mention from a valid webmention", async () => {
    server.use(
      http.get("https://source.example.com/post1", () =>
        HttpResponse.text(HTML_WITH_LINK)
      )
    );

    await processInboundMention(testConfig, {
      source: "https://source.example.com/post1",
      target: "http://localhost:8080/blog/my-post",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });

    const em = getEm();
    const mentions = await em.find(Mention, { targetSlug: "blog/my-post" });
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    const mention = mentions.find(
      (m) => m.sourceUrl === "https://source.example.com/post1"
    );
    expect(mention).toBeDefined();
    expect(mention?.authorName).toBe("Alice");
    expect(mention?.platform).toBe("webmention");
    expect(mention?.spamStatus).toBe("pending"); // akismet disabled
  });

  it("skips when inbound type is disabled", async () => {
    const disabledConfig: HypernextConfig = {
      ...testConfig,
      comments: {
        // biome-ignore lint/style/noNonNullAssertion: testConfig.comments is set in beforeAll
        ...testConfig.comments!,
        inbound: { webmention: false, pingback: false, trackback: false },
      },
    };

    await processInboundMention(disabledConfig, {
      source: "https://source.example.com/post2",
      target: "http://localhost:8080/blog/my-post",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });

    const em = getEm();
    const mention = await em.findOne(Mention, {
      sourceUrl: "https://source.example.com/post2",
    });
    expect(mention).toBeNull();
  });

  it("skips when target link not in source HTML", async () => {
    server.use(
      http.get("https://source.example.com/no-link", () =>
        HttpResponse.text(HTML_WITHOUT_LINK)
      )
    );

    await processInboundMention(testConfig, {
      source: "https://source.example.com/no-link",
      target: "http://localhost:8080/blog/my-post",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });

    const em = getEm();
    const mention = await em.findOne(Mention, {
      sourceUrl: "https://source.example.com/no-link",
    });
    expect(mention).toBeNull();
  });

  it("skips on SSRF rejection (localhost source)", async () => {
    await processInboundMention(testConfig, {
      source: "http://localhost/some-post",
      target: "http://localhost:8080/blog/my-post",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });

    const em = getEm();
    const mention = await em.findOne(Mention, {
      sourceUrl: "http://localhost/some-post",
    });
    expect(mention).toBeNull();
  });

  it("skips when target does not match canonicalBase", async () => {
    await processInboundMention(testConfig, {
      source: "https://source.example.com/other",
      target: "https://other-site.com/not-here",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      type: "webmention",
    });

    const em = getEm();
    const mention = await em.findOne(Mention, {
      sourceUrl: "https://source.example.com/other",
    });
    expect(mention).toBeNull();
  });
});

describe("inbound HTTP routes", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/routed-post",
      title: "Routed Post",
      metaJson: "{}",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("POST /webmention returns 202", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/webmention",
      payload: {
        source: "https://source.example.com/route1",
        target: "http://localhost:8080/blog/routed-post",
      },
    });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body).status).toBe("accepted");
    await fastify.close();
  });

  it("POST /webmention returns 400 on missing fields", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/webmention",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });

  it("POST /pingback returns XML-RPC response", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/pingback",
      payload: {
        methodName: "pingback.ping",
        params: [
          { value: { string: "https://source.example.com/ping1" } },
          { value: { string: "http://localhost:8080/blog/routed-post" } },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("methodResponse");
    expect(response.headers["content-type"]).toContain("text/xml");
    await fastify.close();
  });

  it("POST /pingback returns 400 on invalid request", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/pingback",
      payload: { methodName: "wrong.method" },
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });

  it("POST /trackback/:slug returns 202", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/trackback/blog/routed-post",
      payload: {
        url: "https://source.example.com/track1",
        title: "Trackback Title",
        excerpt: "An excerpt",
        blog_name: "Source Blog",
      },
    });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body).status).toBe("accepted");
    await fastify.close();
  });

  it("POST /trackback/:slug returns 400 on missing url", async () => {
    const fastify = Fastify();
    registerInboundRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/trackback/blog/routed-post",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });
});
