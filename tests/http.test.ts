import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import { createHttpServer } from "../src/servers/http";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test site", lang: "en" },
    theme: { cssPath: "./style.css" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
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

describe("HTTP server", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/hello",
      title: "Hello World",
      rawMdx: "# Hello\n\nThis is a test post.",
    });
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("serves the home page", async () => {
    const fastify = await createHttpServer(testConfig);
    const response = await fastify.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Test");
    await fastify.close();
  });

  it("returns 404 for missing slug", async () => {
    const fastify = await createHttpServer(testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/blog/missing",
    });
    expect(response.statusCode).toBe(404);
    await fastify.close();
  });

  it("serves health endpoint", async () => {
    const fastify = await createHttpServer(testConfig);
    const response = await fastify.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await fastify.close();
  });
});
