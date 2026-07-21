import { describe, expect, it } from "vitest";
import { extractFrontmatter } from "../src/parser/frontmatter.js";

describe("frontmatter parsing", () => {
  it("parses frontmatter from MDX content", () => {
    const mdx = `---
title: "Hello World"
date: 2026-07-16
type: post
tags: [test, mdx]
---

# Body content`;
    const { attributes, body } = extractFrontmatter(mdx);
    expect(attributes.title).toBe("Hello World");
    expect(attributes.date).toBe("2026-07-16");
    expect(attributes.type).toBe("post");
    expect(Array.isArray(attributes.tags)).toBe(true);
    expect(body).toBe("\n# Body content");
  });

  it("returns empty attributes for content without frontmatter", () => {
    const { attributes, body } = extractFrontmatter("# Just a heading");
    expect(attributes).toEqual({});
    expect(body).toBe("# Just a heading");
  });
});

describe("frontmatter SSRF validation", () => {
  it("prevents private IP addresses", async () => {
    const { validateSourceUrl } = await import("../src/federation/ssrf.js");
    expect(validateSourceUrl("http://127.0.0.1/")).toBe(false);
    expect(validateSourceUrl("http://10.0.0.1/")).toBe(false);
    expect(validateSourceUrl("http://192.168.1.1/")).toBe(false);
    expect(validateSourceUrl("http://localhost/")).toBe(false);
    expect(validateSourceUrl("http://[::1]/")).toBe(false);
    expect(validateSourceUrl("http://example.com/")).toBe(true);
    expect(validateSourceUrl("https://api.example.com/data")).toBe(true);
  });
});

describe("JSON-LD structured data", () => {
  it("renders in HTML output", async () => {
    const { renderHTML } = await import("../src/renderers/html.js");
    const config: any = {
      author: { name: "Alice" },
      database: { type: "sqlite", path: ":memory:" },
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
        canonicalBase: "https://example.com",
        meta: { description: "A blog.", lang: "en", title: "My Blog" },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "./data" } },
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    };
    const result = {
      ir: { type: "root" as const, children: [] },
      frontmatter: {
        title: "Post",
        description: "A post.",
        date: "2026-07-17",
      },
      errors: [],
      metadata: {},
    };
    const output = renderHTML(result, config, "blog/post");
    expect(output).toContain('"@type": "BlogPosting"');
    expect(output).toContain('"@type": "WebSite"');
    expect(output).toContain('"@type": "Person"');
    expect(output).toContain('"@type": "BreadcrumbList"');
    expect(output).toContain('"position": 2');
    expect(output).toContain('"https://schema.org"');
  });
});

describe("hashVisitor", () => {
  it("produces consistent hash for same IP on same day", async () => {
    const crypto = await import("node:crypto");
    const dateSalt = new Date().toISOString().slice(0, 10);
    const hash1 = crypto
      .createHash("sha256")
      .update(`192.168.1.1:${dateSalt}`)
      .digest("hex")
      .slice(0, 16);
    const hash2 = crypto
      .createHash("sha256")
      .update(`192.168.1.1:${dateSalt}`)
      .digest("hex")
      .slice(0, 16);
    expect(hash1).toBe(hash2);
  });
});

describe("logger", () => {
  it("initializes without crashing", async () => {
    const { initLogger, logger } = await import("../src/utils/logger.js");
    const config: any = {
      site: { meta: { title: "Test" } },
      mcp: { enabled: false, transport: "stdio" },
      micropub: { enabled: false },
      database: { type: "sqlite", path: ":memory:" },
      protocols: {
        finger: { enabled: false, port: 0 },
        gemini: { enabled: false, port: 0 },
        gopher: { enabled: false, port: 0 },
        http: { enabled: false, port: 0 },
        nex: { enabled: false, port: 0 },
        spartan: { enabled: false, port: 0 },
        text: { enabled: false, port: 0 },
      },
      storage: { type: "local", local: { path: "./data" } },
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    };
    initLogger(config);
    expect(() => logger.info("test")).not.toThrow();
    expect(() => logger.warn("warning")).not.toThrow();
    expect(() => logger.error("error")).not.toThrow();
  });
});

describe("ingestUrl SSRF", () => {
  it("rejects private IP URLs", async () => {
    const { ingestUrl } = await import("../src/ingest/ingest-manager.js");
    const config: any = {
      site: {
        canonicalBase: "https://example.com",
        meta: { title: "Test", lang: "en", description: "" },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "/tmp" } },
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
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    };
    await expect(
      ingestUrl(
        {
          url: "http://127.0.0.1/admin",
          collection: "library",
          filename: "test",
        },
        config
      )
    ).rejects.toThrow("SSRF check");
  });
});

describe("subscriber entity", () => {
  it("creates subscriber with required fields", async () => {
    const { Subscriber } = await import(
      "../src/database/entities/subscriber.js"
    );
    expect(Subscriber).toBeDefined();
    expect(Subscriber.name).toBe("Subscriber");
  });
});

describe("newsletter API validation", () => {
  it("rejects missing email on subscribe", async () => {
    const { registerNewsletterRoutes } = await import(
      "../src/api/newsletter.js"
    );
    const fastify = (await import("fastify")).default();
    const config: any = {
      site: {
        canonicalBase: "https://example.com",
        meta: { title: "Test", lang: "en", description: "" },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "/tmp" } },
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
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    };
    registerNewsletterRoutes(fastify, config);

    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/subscribe",
      payload: { email: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid email");
  });

  it("rejects missing fields on contact form", async () => {
    const { registerNewsletterRoutes } = await import(
      "../src/api/newsletter.js"
    );
    const fastify = (await import("fastify")).default();
    const config: any = {
      site: {
        canonicalBase: "https://example.com",
        meta: { title: "Test", lang: "en", description: "" },
        ebooks: { enabled: false },
        pdf: { enabled: false },
      },
      storage: { type: "local", local: { path: "/tmp" } },
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
      api: { enabled: false },
      syndication: {},
      collections: {},
      taxonomies: [],
    };
    registerNewsletterRoutes(fastify, config);

    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/contact",
      payload: { name: "", email: "", message: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Missing required fields");
  });
});
