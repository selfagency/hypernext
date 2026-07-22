import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, mergeCliOverrides, scaffoldDefaults } from "../src/config";

function createTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hypernext-"));
}

describe("CLI bootstrap", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = createTestDir();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("scaffolds default config and directories when missing", () => {
    scaffoldDefaults(cwd);
    expect(fs.existsSync(path.join(cwd, "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "content/blog"))).toBe(true);
    // library collection removed from defaults; content/ root for pages
    expect(fs.existsSync(path.join(cwd, "content"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "assets"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "content/blog/welcome.mdx"))).toBe(
      true
    );
  });

  it("loads a valid config YAML", () => {
    scaffoldDefaults(cwd);
    const config = loadConfig(path.join(cwd, "config.yml"));
    expect(config.site.canonicalBase).toBe("http://localhost:8080");
    expect(config.protocols.http.port).toBe(8080);
  });

  it("merges port CLI override into HTTP protocol config", () => {
    scaffoldDefaults(cwd);
    const config = loadConfig(path.join(cwd, "config.yml"));
    const merged = mergeCliOverrides(config, { port: 9090 });
    expect(merged.protocols.http.port).toBe(9090);
  });

  it("merges --no-gemini override", () => {
    scaffoldDefaults(cwd);
    const config = loadConfig(path.join(cwd, "config.yml"));
    const merged = mergeCliOverrides(config, { gemini: false });
    expect(merged.protocols.gemini.enabled).toBe(false);
    expect(merged.protocols.http.enabled).toBe(true);
  });

  it("merges --no-gopher override", () => {
    scaffoldDefaults(cwd);
    const config = loadConfig(path.join(cwd, "config.yml"));
    const merged = mergeCliOverrides(config, { gopher: false });
    expect(merged.protocols.gopher.enabled).toBe(false);
  });

  it("substitutes environment variables in config values", () => {
    process.env.HYPERNEXT_TEST_API_KEY = "secret-123";
    const configPath = path.join(cwd, "config.yml");
    fs.writeFileSync(
      configPath,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var substitution in YAML
      'site:\n  canonicalBase: "http://localhost:8080"\n  meta:\n    title: Test\n    description: Test\n    lang: en\nauthor:\n  name: Test\nstorage:\n  type: local\n  local:\n    path: "./content"\ndatabase:\n  type: sqlite\n  path: "./hypernext.db"\napi:\n  enabled: true\n  apiKey: ${HYPERNEXT_TEST_API_KEY}\ncollections: {}\ntaxonomies: []\nprotocols:\n  http:\n    enabled: true\n    port: 8080\n  gemini:\n    enabled: true\n    port: 1965\n  gopher:\n    enabled: true\n    port: 70\n  spartan:\n    enabled: true\n    port: 300\n  nex:\n    enabled: true\n    port: 1900\n  finger:\n    enabled: true\n    port: 79\n  text:\n    enabled: true\n    port: 5011\nmicropub:\n  enabled: true\nsyndication: {}\nmcp:\n  enabled: true\n  transport: stdio\n'
    );
    const config = loadConfig(configPath);
    expect(config.api.apiKey).toBe("secret-123");
    delete process.env.HYPERNEXT_TEST_API_KEY;
  });
});
