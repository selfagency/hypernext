import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import { registerMicropubEndpoint } from "../src/micropub/index.js";
import { createStorage } from "../src/storage/index.js";
import type { HypernextConfig } from "../src/types/config.js";

const TEST_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {},
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
  storage: { type: "local", local: { path: "./content" } },
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
});

async function createAuthedFastify() {
  const fastify = Fastify();
  await fastify.register(jwt, { secret: JWT_SECRET });
  registerMicropubEndpoint(fastify, TEST_CONFIG);
  const token = await fastify.jwt.sign(
    { sub: "http://localhost:8080", scope: "create" },
    { expiresIn: "1h" }
  );
  return { fastify, token };
}

describe("Micropub endpoint", () => {
  it("returns 401 without authorization header", async () => {
    const { fastify } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      payload: { type: ["h-entry"], properties: { name: ["Test"] } },
    });
    expect(res.statusCode).toBe(401);
    await fastify.close();
  });

  it("returns 401 with invalid token", async () => {
    const { fastify } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: "Bearer invalid-token" },
      payload: { type: ["h-entry"], properties: { name: ["Test"] } },
    });
    expect(res.statusCode).toBe(401);
    await fastify.close();
  });

  it("returns 400 with empty body", async () => {
    const { fastify, token } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    await fastify.close();
  });

  it("returns 400 with missing properties", async () => {
    const { fastify, token } = await createAuthedFastify();
    const res = await fastify.inject({
      method: "POST",
      url: "/micropub",
      headers: { authorization: `Bearer ${token}` },
      payload: { type: ["h-entry"] },
    });
    expect(res.statusCode).toBe(400);
    await fastify.close();
  });
});
