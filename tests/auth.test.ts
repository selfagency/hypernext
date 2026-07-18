import jwt from "@fastify/jwt";
import type { MikroORM } from "@mikro-orm/sqlite";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyBearerToken } from "../src/api/auth";
import { registerIndieAuthRoutes } from "../src/auth/indieauth";
import { closeOrm, initOrm } from "../src/database";
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
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

describe("auth", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("serves OAuth authorization server metadata", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.issuer).toBe("http://localhost:8080");
    expect(body.authorization_endpoint).toContain("/auth/authorize");
    await fastify.close();
  });

  it("authorization endpoint returns redirect with code", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:3000/callback&client_id=http://localhost:3000&state=xyz",
    });
    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location).toContain("code=");
    expect(location).toContain("state=xyz");
    await fastify.close();
  });

  it("token endpoint exchanges code for JWT token", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    registerIndieAuthRoutes(fastify, testConfig);

    const authResponse = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:3000/callback&client_id=http://localhost:3000",
    });
    const location = authResponse.headers.location as string;
    // biome-ignore lint/style/noNonNullAssertion: code is always present from authorize endpoint
    const code = new URL(location).searchParams.get("code")!;

    const tokenResponse = await fastify.inject({
      method: "POST",
      url: "/auth/token",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    expect(tokenResponse.statusCode).toBe(200);
    const body = JSON.parse(tokenResponse.body);
    expect(body.access_token).toBeDefined();
    expect(body.token_type).toBe("Bearer");
    // Verify the token is a valid JWT
    const decoded = fastify.jwt.decode(body.access_token);
    expect(decoded).toHaveProperty("sub");
    expect(decoded).toHaveProperty("scope");
    await fastify.close();
  });

  it("token endpoint rejects invalid code", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    registerIndieAuthRoutes(fastify, testConfig);
    const tokenResponse = await fastify.inject({
      method: "POST",
      url: "/auth/token",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: "invalid",
      }),
    });
    expect(tokenResponse.statusCode).toBe(400);
    await fastify.close();
  });

  it("verifyBearerToken rejects missing token", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    fastify.get("/test", { preHandler: [verifyBearerToken] }, async () => ({
      ok: true,
    }));

    const response = await fastify.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(401);
    await fastify.close();
  });

  it("verifyBearerToken accepts valid JWT", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign(
      { sub: "test", scope: "admin" },
      { expiresIn: "1h" }
    );

    fastify.get("/test", { preHandler: [verifyBearerToken] }, async () => ({
      ok: true,
    }));

    const response = await fastify.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    await fastify.close();
  });

  it("verifyBearerToken rejects expired JWT", async () => {
    const fastify = Fastify();
    await fastify.register(jwt, { secret: JWT_SECRET });
    const token = await fastify.jwt.sign({ sub: "test" }, { expiresIn: "-1h" });

    fastify.get("/test", { preHandler: [verifyBearerToken] }, async () => ({
      ok: true,
    }));

    const response = await fastify.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    await fastify.close();
  });
});
