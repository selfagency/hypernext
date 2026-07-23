import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../../src/database";
import { createHttpServer } from "../../src/servers/http";
import type { HypernextConfig } from "../../src/types/config";

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
  comments: { waline: { enabled: false } },
  agent: { enabled: false },
};

describe("Federated Comments API", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
  });

  afterAll(async () => {
    await closeOrm();
  });

  it("GET /api/comments/federated/:slug returns empty array for unknown slug", async () => {
    const server = await createHttpServer(testConfig);
    const response = await server.inject({
      method: "GET",
      url: "/api/comments/federated/nonexistent-post",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    await server.close();
  });

  it("GET /api/comments/federated/:slug/count returns count object", async () => {
    const server = await createHttpServer(testConfig);
    const response = await server.inject({
      method: "GET",
      url: "/api/comments/federated/nonexistent-post/count",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty("count");
    expect(typeof body.count).toBe("number");
    await server.close();
  });
});
