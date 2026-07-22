import fs from "node:fs";
import path from "node:path";
import jwt from "@fastify/jwt";
import type { MikroORM } from "@mikro-orm/sqlite";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerApiAuthGuard } from "../src/api/auth";
import { registerModerationRoutes } from "../src/api/moderation";
import { registerApiRoutes } from "../src/api/routes";
import { closeOrm, getEm, initOrm, insertDoc } from "../src/database";
import { createStorage } from "../src/storage/index";
import type { HypernextConfig } from "../src/types/config";

const JWT_SECRET = "test-secret-for-jwt";
const randomSuffix = Math.random().toString(36).slice(2, 8);
const TMP_DIR = path.resolve(
  import.meta.dirname,
  "..",
  `tmp-api-${randomSuffix}`
);

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: true, cssPath: "./assets/pdf-style.css" },
    ebooks: { enabled: true },
  },
  author: { name: "Test Author" },
  jwtSecret: JWT_SECRET,
  storage: { type: "local", local: { path: TMP_DIR } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: {
      path: "/blog/",
      syndicate: false,
      rss: true,
      layout: "blog.mdx",
      compileToEbook: true,
    },
  },
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

describe("API routes", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    fs.mkdirSync(TMP_DIR, { recursive: true });
    createStorage(testConfig);
    await insertDoc({ slug: "blog/post-1", title: "Post 1", type: "post" });
    await insertDoc({ slug: "blog/post-2", title: "Post 2", type: "post" });
  });

  afterAll(async () => {
    await closeOrm();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("lists docs", async () => {
    const fastify = Fastify();
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/docs",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.docs.length).toBeGreaterThanOrEqual(2);
    await fastify.close();
  });

  it("filters docs by type", async () => {
    const fastify = Fastify();
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/docs?type=post",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.docs.length).toBeGreaterThanOrEqual(2);
    await fastify.close();
  });

  it("returns single doc by slug", async () => {
    const fastify = Fastify();
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/docs/blog/post-1",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.title).toBe("Post 1");
    await fastify.close();
  });

  it("returns 404 for missing doc", async () => {
    const fastify = Fastify();
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/docs/missing",
    });
    expect(response.statusCode).toBe(404);
    await fastify.close();
  });

  it("PUT /api/v1/docs/* creates a document", async () => {
    const fastify = Fastify();
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "PUT",
      url: "/api/v1/docs/blog/put-test",
      headers: { "content-type": "text/plain" },
      payload: "# PUT Test\n\nCreated via PUT.",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("saved");
    expect(body.slug).toBe("blog/put-test");
    await fastify.close();
  });

  it("rejects requests without Bearer token on admin routes", async () => {
    const fastify = Fastify();
    fastify.register(jwt, { secret: JWT_SECRET });
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerApiRoutes(fastify, testConfig);
    // PUT is an admin route (write) — should require auth
    const response = await fastify.inject({
      method: "PUT",
      url: "/api/v1/docs/admin-only-test",
      headers: { "content-type": "text/plain" },
      payload: "# Admin Only\n\nShould be blocked.",
    });
    expect(response.statusCode).toBe(401);
    await fastify.close();
  });

  it("accepts requests with valid Bearer token", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign(
      { sub: "test", scope: "admin" },
      { expiresIn: "1h" }
    );
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerApiRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/docs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    await fastify.close();
  });
});

describe("moderation API", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");

    const em = getEm();
    await em.getConnection().execute(
      `INSERT INTO mentions (id, target_slug, source_url, author_name, content, published_at, type, platform, spam_status, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "mention-1",
        "blog/post-1",
        "https://example.com/reply1",
        "Alice",
        "Great post!",
        Date.parse("2026-07-16T12:00:00Z"),
        "reply",
        "webmention",
        "ham",
        Date.now(),
      ]
    );
    await em.getConnection().execute(
      `INSERT INTO mentions (id, target_slug, source_url, author_name, content, published_at, type, platform, spam_status, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "mention-2",
        "blog/post-1",
        "https://spam.example.com/spam1",
        "Spammer",
        "Buy now!",
        Date.parse("2026-07-16T13:00:00Z"),
        "reply",
        "webmention",
        "spam",
        Date.now(),
      ]
    );
  });

  afterAll(async () => {
    await closeOrm();
  });

  async function createAuthedFastify(): Promise<{
    fastify: ReturnType<typeof Fastify>;
    token: string;
  }> {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign(
      { sub: "test", scope: "admin" },
      { expiresIn: "1h" }
    );
    return { fastify, token };
  }

  it("GET /api/v1/comments lists all comments", async () => {
    const { fastify, token } = await createAuthedFastify();
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerModerationRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/comments",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.length).toBe(2);
    await fastify.close();
  });

  it("POST /api/v1/comments/:id/hide hides a comment", async () => {
    const { fastify, token } = await createAuthedFastify();
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerModerationRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/comments/mention-1/hide",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.hidden).toBe(true);
    await fastify.close();
  });

  it("POST /api/v1/comments/:id/unhide unhides a comment", async () => {
    const { fastify, token } = await createAuthedFastify();
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerModerationRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/comments/mention-1/unhide",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.hidden).toBe(false);
    await fastify.close();
  });

  it("DELETE /api/v1/comments/:id deletes a comment", async () => {
    const { fastify, token } = await createAuthedFastify();
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerModerationRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/v1/comments/mention-1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(204);
    await fastify.close();
  });

  it("GET /api/v1/blocklist returns blocklist", async () => {
    const { fastify, token } = await createAuthedFastify();
    registerApiAuthGuard(fastify, {
      api: { enabled: true, requireAuthForPublicRead: false },
    } as any);
    registerModerationRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/api/v1/blocklist",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveProperty("handles");
    expect(body.data).toHaveProperty("domains");
    expect(body.data).toHaveProperty("ips");
    await fastify.close();
  });
});
