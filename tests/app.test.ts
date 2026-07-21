import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAllServers } from "../src/app.js";
import { closeOrm } from "../src/database/index.js";
import type { HypernextConfig } from "../src/types/config.js";

function makeAppConfig(overrides?: Partial<HypernextConfig>): HypernextConfig {
  return {
    site: {
      canonicalBase: "http://localhost:0",
      meta: { title: "App Test", description: "Testing", lang: "en" },
      pdf: { enabled: false },
      ebooks: { enabled: false },
    },
    author: { name: "Tester" },
    storage: { type: "local", local: { path: "./tmp-app-test" } },
    database: { type: "sqlite", path: ":memory:" },
    api: { enabled: false },
    collections: {},
    taxonomies: [],
    protocols: {
      http: { enabled: true, port: 0 },
      gemini: { enabled: false, port: 0 },
      gopher: { enabled: false, port: 0 },
      spartan: { enabled: false, port: 0 },
      nex: { enabled: false, port: 0 },
      finger: { enabled: false, port: 0 },
      text: { enabled: false, port: 0 },
    },
    micropub: { enabled: false },
    syndication: {},
    mcp: { enabled: false, transport: "stdio" },
    ...overrides,
  } as unknown as HypernextConfig;
}

describe("app bootstrap", () => {
  beforeAll(() => {
    fs.mkdirSync("./tmp-app-test", { recursive: true });
  });

  afterAll(async () => {
    fs.rmSync("./tmp-app-test", { recursive: true, force: true });
    await closeOrm();
  });

  it("starts HTTP server without error", async () => {
    const config = makeAppConfig();
    await expect(startAllServers(config)).resolves.toBeUndefined();
  });

  it("starts HTTP + finger + text servers", async () => {
    const config = makeAppConfig({
      protocols: {
        http: { enabled: true, port: 0 },
        gemini: { enabled: false, port: 0 },
        gopher: { enabled: false, port: 0 },
        spartan: { enabled: false, port: 0 },
        nex: { enabled: false, port: 0 },
        finger: { enabled: true, port: 0 },
        text: { enabled: true, port: 0 },
      },
    });
    await expect(startAllServers(config)).resolves.toBeUndefined();
  });

  it("starts with only smolnet protocols (no HTTP)", async () => {
    const config = makeAppConfig({
      api: { enabled: false },
      mcp: { enabled: false, transport: "stdio" },
      protocols: {
        http: { enabled: false, port: 0 },
        gemini: { enabled: false, port: 0 },
        gopher: { enabled: false, port: 0 },
        spartan: { enabled: false, port: 0 },
        nex: { enabled: false, port: 0 },
        finger: { enabled: true, port: 0 },
        text: { enabled: true, port: 0 },
      },
    });
    await expect(startAllServers(config)).resolves.toBeUndefined();
  });
});
