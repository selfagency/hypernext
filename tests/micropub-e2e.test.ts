import formbody from "@fastify/formbody";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import { registerMicropubEndpoint } from "../src/micropub/index.js";
import { createStorage } from "../src/storage/index.js";
import type { HypernextConfig } from "../src/types/config.js";

const tmpDir = "./tmp-micropub-e2e";

const TEST_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
  },
  database: { path: ":memory:", type: "sqlite" },
  mcp: { enabled: false, transport: "stdio" },
  micropub: { enabled: true },
  protocols: {
    finger: { enabled: false, port: 0 },
    gemini: { enabled: false, port: 0 },
    gopher: { enabled: false, port: 0 },
    http: { enabled: false, port: 0 },
    nex: { enabled: false, port: 0 },
    spartan: { enabled: false, port: 0 },
    text: { enabled: false, port: 0 },
  },
  site: {
    canonicalBase: "http://localhost:8080",
    ebooks: { enabled: false },
    meta: { description: "Test", lang: "en", title: "Test Site" },
    pdf: { enabled: false },
  },
  storage: { type: "local", local: { path: tmpDir } },
  api: { enabled: false },
  syndication: {},
  taxonomies: [],
};

const JWT_SECRET = "test-secret";

beforeAll(async () => {
  await initOrm(":memory:");
  createStorage(TEST_CONFIG);
});

afterAll(async () => {
  await closeOrm();
  const fs = await import("node:fs");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createAuthedFastify() {
  const fastify = Fastify();
  await fastify.register(formbody);
  await fastify.register(jwt, { secret: JWT_SECRET });
  registerMicropubEndpoint(fastify, TEST_CONFIG);
  const token = await fastify.jwt.sign(
    { sub: "http://localhost:8080", scope: "create" },
    { expiresIn: "1h" }
  );
  return { fastify, token };
}

describe("Micropub full flow", () => {
  it("creates a post with valid JWT and JSON body", async () => {
    const { fastify, token } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: ["h-entry"],
        properties: { name: ["Test Post"], content: ["Hello world"] },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.slug).toContain("blog/test-post");
    await fastify.close();
  });

  it("creates a post with form-encoded body", async () => {
    const { fastify, token } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "h=entry&name=Form+Post&content=From+form",
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.slug).toContain("blog/form-post");
    await fastify.close();
  });

  it("creates a post with minimal form-encoded body", async () => {
    const { fastify, token } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "invalid=body",
    });
    // Falls through to writePost with empty properties — returns 201
    expect(res.statusCode).toBe(201);
    await fastify.close();
  });
});
