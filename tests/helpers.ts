import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MikroORM } from "@mikro-orm/sqlite";
import { closeOrm, initOrm } from "../src/database";
import type { HypernextConfig } from "../src/types/config";

export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hypernext-test-"));
}

export function createTestConfig(
  overrides?: Partial<HypernextConfig>
): HypernextConfig {
  const base: HypernextConfig = {
    site: {
      canonicalBase: "http://localhost:8080",
      meta: { title: "Test", description: "Test", lang: "en" },
      pdf: { enabled: false },
      ebooks: { enabled: false },
    },
    author: { name: "Test Author" },
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
  return { ...base, ...overrides };
}

export async function withTestDb<T>(
  fn: (orm: MikroORM) => Promise<T>
): Promise<T> {
  const orm = await initOrm(":memory:");
  try {
    return await fn(orm);
  } finally {
    await closeOrm();
  }
}
