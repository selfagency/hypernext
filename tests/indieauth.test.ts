import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerIndieAuthRoutes } from "../src/auth/indieauth.js";
import type { HypernextConfig } from "../src/types/config.js";

const TEST_CONFIG: HypernextConfig = {
  author: { name: "Test" },
  collections: {},
  database: { path: ":memory:", type: "sqlite" },
  mcp: { enabled: false, transport: "stdio" },
  micropub: { enabled: false },
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

describe("IndieAuth routes", () => {
  it("returns authorization server metadata", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issuer).toBe("http://localhost:8080");
    expect(body.authorization_endpoint).toBe(
      "http://localhost:8080/auth/authorize"
    );
    expect(body.token_endpoint).toBe("http://localhost:8080/auth/token");
    expect(body.scopes_supported).toContain("create");
    expect(body.response_types_supported).toContain("code");
    expect(body.code_challenge_methods_supported).toContain("S256");
    await fastify.close();
  });

  it("returns 400 when redirect_uri is missing", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Missing redirect_uri");
    await fastify.close();
  });

  it("returns 400 when client_id is missing", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:8080/callback",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Missing client_id");
    await fastify.close();
  });

  it("returns 400 when redirect_uri is not same-origin as client_id", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://evil.com/callback&client_id=http://localhost:8080",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("same-origin");
    await fastify.close();
  });

  it("returns 400 for unsupported code_challenge_method", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:8080/callback&client_id=http://localhost:8080&code_challenge=abc&code_challenge_method=plain",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("S256");
    await fastify.close();
  });

  it("redirects with authorization code on success", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:8080/callback&client_id=http://localhost:8080",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("http://localhost:8080/callback?code=");
    await fastify.close();
  });

  it("redirects with state parameter when provided", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "GET",
      url: "/auth/authorize?redirect_uri=http://localhost:8080/callback&client_id=http://localhost:8080&state=mystate",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("state=mystate");
    await fastify.close();
  });

  it("returns 400 for invalid grant_type on token endpoint", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/token",
      payload: { grant_type: "invalid" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Invalid grant_type");
    await fastify.close();
  });

  it("returns 400 for missing authorization code", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/token",
      payload: { grant_type: "authorization_code" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("missing code");
    await fastify.close();
  });

  it("returns 400 for invalid authorization code", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, TEST_CONFIG);
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/token",
      payload: {
        grant_type: "authorization_code",
        code: "nonexistent-code",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Invalid or expired");
    await fastify.close();
  });

  it("skips route registration when indieauth is disabled", async () => {
    const fastify = Fastify();
    registerIndieAuthRoutes(fastify, {
      ...TEST_CONFIG,
      indieauth: { enabled: false },
    });
    const res = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    });
    expect(res.statusCode).toBe(404);
    await fastify.close();
  });
});
