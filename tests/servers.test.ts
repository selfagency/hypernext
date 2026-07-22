import { execSync } from "node:child_process";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import { reindexAll } from "../src/indexer/index.js";
import { startGeminiServer } from "../src/servers/gemini.js";
import { startGopherServer } from "../src/servers/gopher.js";
import { startNexServer } from "../src/servers/nex.js";
import { startSpartanServer } from "../src/servers/spartan.js";
import { startTextServer } from "../src/servers/text.js";
import { createStorage } from "../src/storage/index.js";
import type { HypernextConfig } from "../src/types/config.js";

function getPort(server: net.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Server not bound");
}

function generateSelfSignedCert(certDir: string): {
  certPath: string;
  keyPath: string;
} {
  const certPath = path.join(certDir, "cert.pem");
  const keyPath = path.join(certDir, "key.pem");
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { certPath, keyPath };
  }
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj /CN=localhost`,
    { stdio: "ignore" }
  );
  return { certPath, keyPath };
}

const tmpDir = path.resolve("./tmp-servers-test");

const TEST_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Srv", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test" },
  storage: { type: "local", local: { path: tmpDir } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: false },
  collections: {},
  taxonomies: [],
  protocols: {
    http: { enabled: false, port: 0 },
    gemini: { enabled: true, port: 0, certPath: "", keyPath: "" },
    gopher: { enabled: true, port: 0 },
    spartan: { enabled: true, port: 0 },
    nex: { enabled: true, port: 0 },
    text: { enabled: true, port: 0 },
    finger: { enabled: false, port: 0 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

beforeAll(async () => {
  fs.mkdirSync(path.join(tmpDir, "blog"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "blog", "hello.mdx"),
    "---\ntitle: Hello\ndate: 2026-07-20\ntype: post\n---\n\nHello World"
  );

  // Generate self-signed cert for Gemini
  const certDir = path.resolve("./tmp-gemini-certs");
  fs.mkdirSync(certDir, { recursive: true });
  generateSelfSignedCert(certDir);

  await initOrm(":memory:");
  createStorage(TEST_CONFIG);
  await reindexAll(TEST_CONFIG);
});

afterAll(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync("./tmp-gemini-certs", { recursive: true, force: true });
  await closeOrm();
});

describe("Gemini server", () => {
  it("starts and returns a server", () => {
    const certPath = path.resolve("./tmp-gemini-certs/cert.pem");
    const keyPath = path.resolve("./tmp-gemini-certs/key.pem");
    if (!(fs.existsSync(certPath) || fs.existsSync(keyPath))) {
      return; // Skip if no certs
    }
    const server = startGeminiServer({
      ...TEST_CONFIG,
      protocols: {
        ...TEST_CONFIG.protocols,
        gemini: { enabled: true, port: 0, certPath, keyPath },
      },
    });
    expect(server).toBeDefined();
    const port = getPort(server);
    expect(port).toBeGreaterThan(0);
    server.close();
  });
});

describe("Gopher server", () => {
  it("starts and returns a server", () => {
    const server = startGopherServer(TEST_CONFIG);
    expect(server).toBeDefined();
    expect(getPort(server)).toBeGreaterThan(0);
    server.close();
  });
});

describe("Spartan server", () => {
  it("starts and returns a server", () => {
    const server = startSpartanServer(TEST_CONFIG);
    expect(server).toBeDefined();
    expect(getPort(server)).toBeGreaterThan(0);
    server.close();
  });
});

describe("NEX server", () => {
  it("starts and returns a server", () => {
    const server = startNexServer(TEST_CONFIG);
    expect(server).toBeDefined();
    expect(getPort(server)).toBeGreaterThan(0);
    server.close();
  });
});

describe("Text server", () => {
  it("starts and returns a server", () => {
    const server = startTextServer(TEST_CONFIG);
    expect(server).toBeDefined();
    expect(getPort(server)).toBeGreaterThan(0);
    server.close();
  });
});
