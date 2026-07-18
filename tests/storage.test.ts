import fs from "node:fs";
import path from "node:path";
import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database";
import { createStorage, getStorage } from "../src/storage/index";
import type { HypernextConfig } from "../src/types/config";

const randomSuffix = Math.random().toString(36).slice(2, 8);
const TMP_DIR = path.resolve(
  import.meta.dirname,
  "..",
  `tmp-storage-${randomSuffix}`
);

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "T", description: "D", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "A" },
  storage: { type: "local", local: { path: TMP_DIR } },
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

describe("storage", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    fs.mkdirSync(TMP_DIR, { recursive: true });
    createStorage(testConfig);
  });

  afterAll(async () => {
    await closeOrm();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("write creates a file", async () => {
    await getStorage().write("test-collection/test-file", "# Test");
    const exists = await getStorage().exists("test-collection/test-file");
    expect(exists).toBe(true);
  });

  it("read returns file content", async () => {
    const content = await getStorage().read("test-collection/test-file");
    expect(content).toBe("# Test");
  });

  it("delete removes a file", async () => {
    await getStorage().delete("test-collection/test-file");
    const exists = await getStorage().exists("test-collection/test-file");
    expect(exists).toBe(false);
  });

  it("list returns all files", async () => {
    await getStorage().write("test-a", "# A");
    await getStorage().write("test-b", "# B");
    const files = await getStorage().list();
    expect(files).toContain("test-a");
    expect(files).toContain("test-b");
  });

  it("writeStorage and deleteStorage convenience functions work", async () => {
    const { writeStorage, deleteStorage } = await import(
      "../src/storage/index"
    );
    await writeStorage("convenience/test", "# Convenience");
    const content = await getStorage().read("convenience/test");
    expect(content).toBe("# Convenience");
    await deleteStorage("convenience/test");
    const exists = await getStorage().exists("convenience/test");
    expect(exists).toBe(false);
  });
});
