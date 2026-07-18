import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, mergeCliOverrides, validateConfig } from "../src/config";
import type { HypernextConfig } from "../src/types/config";
import { deepMerge } from "../src/utils/deep-merge";

function makeMinimalConfig(): HypernextConfig {
  return {
    site: {
      canonicalBase: "http://localhost:8080",
      meta: {
        description: "desc",
        lang: "en",
        title: "Test",
      },
    },
    author: { name: "Test" },
    storage: { type: "local", local: { path: "./content" } },
    database: { type: "sqlite", path: "./hypernext.db" },
    api: { enabled: true },
    collections: {},
    taxonomies: [],
    protocols: {
      http: { enabled: true, port: 8080 },
      gemini: { enabled: true, port: 1965 },
      gopher: { enabled: true, port: 70 },
      spartan: { enabled: true, port: 300 },
      nex: { enabled: true, port: 1900 },
      finger: { enabled: true, port: 79 },
      text: { enabled: true, port: 5011 },
    },
    micropub: { enabled: false },
    syndication: {},
    mcp: { enabled: false, transport: "stdio" },
  };
}

describe("config loader and merger", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hypernext-cfg-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("deep-merges nested objects without mutating target", () => {
    const target = { protocols: { http: { enabled: true, port: 8080 } } };
    const source = { protocols: { http: { port: 9090 } } };
    const merged = deepMerge(target, source);
    expect(merged.protocols.http.port).toBe(9090);
    expect(merged.protocols.http.enabled).toBe(true);
    expect(target.protocols.http.port).toBe(8080);
  });

  it("validates required top-level keys", () => {
    const invalid = {
      site: makeMinimalConfig().site,
    } as unknown as HypernextConfig;
    expect(() => validateConfig(invalid)).toThrow(
      "Missing required config key: storage"
    );
  });

  it("validates site.canonicalBase", () => {
    const config = makeMinimalConfig();
    config.site.canonicalBase = "";
    expect(() => validateConfig(config)).toThrow(
      "Missing required config value: site.canonicalBase"
    );
  });

  it("loads config and substitutes environment variables", () => {
    process.env.HYPERNEXT_TEST_PORT = "7777";
    const configPath = path.join(cwd, "config.yml");
    fs.writeFileSync(
      configPath,
      [
        "site:",
        '  canonicalBase: "http://localhost:8080"',
        "  meta:",
        "    title: Test",
        "    description: Test",
        "    lang: en",
        "author:",
        "  name: Test",
        "storage:",
        "  type: local",
        "  local:",
        '    path: "./content"',
        "database:",
        "  type: sqlite",
        '  path: "./hypernext.db"',
        "api:",
        "  enabled: true",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var substitution in YAML
        "  apiKey: ${HYPERNEXT_TEST_PORT}",
        "collections: {}",
        "taxonomies: []",
        "protocols:",
        "  http:",
        "    enabled: true",
        "    port: 8080",
        "  gemini:",
        "    enabled: true",
        "    port: 1965",
        "  gopher:",
        "    enabled: true",
        "    port: 70",
        "  spartan:",
        "    enabled: true",
        "    port: 300",
        "  nex:",
        "    enabled: true",
        "    port: 1900",
        "  finger:",
        "    enabled: true",
        "    port: 79",
        "  text:",
        "    enabled: true",
        "    port: 5011",
        "micropub:",
        "  enabled: false",
        "syndication: {}",
        "mcp:",
        "  enabled: false",
        "  transport: stdio",
      ].join("\n")
    );
    const config = loadConfig(configPath);
    expect(String(config.api.apiKey)).toBe("7777");
    delete process.env.HYPERNEXT_TEST_PORT;
  });

  it("merges CLI port override", () => {
    const config = makeMinimalConfig();
    const merged = mergeCliOverrides(config, { port: 9090 });
    expect(merged.protocols.http.port).toBe(9090);
    expect(merged.protocols.gemini.enabled).toBe(true);
  });
});
