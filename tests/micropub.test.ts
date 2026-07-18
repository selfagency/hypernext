import jwt from "@fastify/jwt";
import type { MikroORM } from "@mikro-orm/sqlite";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database";
import { registerMicropubEndpoint } from "../src/micropub/index";
import type { HypernextConfig } from "../src/types/config";

const JWT_SECRET = "test-secret-for-jwt";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  jwtSecret: JWT_SECRET,
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
  micropub: { enabled: true },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

describe("micropub", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("rejects requests without Bearer token", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    registerMicropubEndpoint(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/micropub",
      body: { properties: { name: ["Test"] } },
    });
    expect(response.statusCode).toBe(401);
    await fastify.close();
  });

  it("creates a post with valid token", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign(
      { sub: "test", scope: "admin" },
      { expiresIn: "1h" }
    );
    registerMicropubEndpoint(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: `Bearer ${token}` },
      body: {
        type: ["h-entry"],
        properties: {
          name: ["My Test Post"],
          content: ["Hello from Micropub"],
          category: ["test", "micropub"],
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.slug).toContain("blog/my-test-post");
    await fastify.close();
  });

  it("returns 400 for missing properties", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign(
      { sub: "test", scope: "admin" },
      { expiresIn: "1h" }
    );
    registerMicropubEndpoint(fastify, testConfig);
    const response = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: `Bearer ${token}` },
      body: {},
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });
});
