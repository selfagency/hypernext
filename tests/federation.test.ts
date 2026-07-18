import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerActivityPubRoutes } from "../src/federation/activitypub";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Alice", bio: "A writer." },
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

describe("federation", () => {
  it("serves WebFinger endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/webfinger?resource=acct:alice@localhost:8080",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.subject).toContain("alice");
    expect(body.links[0].rel).toBe("self");
    await fastify.close();
  });

  it("returns 400 for missing resource", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/webfinger",
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });

  it("serves Actor endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({ method: "GET", url: "/actor" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.type).toBe("Person");
    expect(body.preferredUsername).toBe("alice");
    await fastify.close();
  });

  it("serves Outbox endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({ method: "GET", url: "/outbox" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.type).toBe("OrderedCollection");
    await fastify.close();
  });
});
