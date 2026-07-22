import { describe, expect, it } from "vitest";
import { startDigestCron } from "../src/app.js";
import type { HypernextConfig } from "../src/types/config.js";

const BASE_CONFIG: HypernextConfig = {
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

describe("startDigestCron", () => {
  it("returns null when email is not configured", () => {
    const result = startDigestCron(BASE_CONFIG);
    expect(result).toBeNull();
  });

  it("returns null when newsletter is not configured", () => {
    const result = startDigestCron({
      ...BASE_CONFIG,
      email: { enabled: true },
    });
    expect(result).toBeNull();
  });

  it("returns an interval when newsletter is configured", () => {
    const result = startDigestCron({
      ...BASE_CONFIG,
      email: {
        enabled: true,
        newsletter: { digestSchedule: "friday", digestTime: "09:00" },
      },
    });
    expect(result).not.toBeNull();
    if (result) {
      clearInterval(result);
    }
  });

  it("uses default schedule when not specified", () => {
    const result = startDigestCron({
      ...BASE_CONFIG,
      email: {
        enabled: true,
        newsletter: {},
      },
    });
    expect(result).not.toBeNull();
    if (result) {
      clearInterval(result);
    }
  });
});
