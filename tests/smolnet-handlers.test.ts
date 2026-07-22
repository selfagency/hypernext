import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../src/database/index.js";
import { reindexAll } from "../src/indexer/index.js";
import { createStorage } from "../src/storage/index.js";
import { startGeminiServer } from "../src/servers/gemini.js";
import { startGopherServer } from "../src/servers/gopher.js";
import { startNexServer } from "../src/servers/nex.js";
import { startSpartanServer } from "../src/servers/spartan.js";
import { startTextServer } from "../src/servers/text.js";
import type { HypernextConfig } from "../src/types/config.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function getPort(server: net.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Server not bound");
}

function tcpRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.connect(port, "localhost", () => {
      client.write(request);
    });
    let data = "";
    client.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf-8");
    });
    client.on("end", () => resolve(data));
    client.on("error", reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("TCP request timeout"));
    });
  });
}

function tlsRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = tls.connect(
      { port, host: "localhost", rejectUnauthorized: false },
      () => {
        client.write(request);
      }
    );
    let data = "";
    client.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf-8");
    });
    client.on("end", () => resolve(data));
    client.on("error", reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("TLS request timeout"));
    });
  });
}

// ── Fixtures and state ─────────────────────────────────────────────────────

const tmpDir = path.resolve("./tmp-smolnet-test");
const contentDir = path.join(tmpDir, "content");
const certDir = path.join(tmpDir, "certs");

const TEST_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: {
      title: "SmolNet Test",
      description: "Multi-protocol test",
      lang: "en",
    },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
  storage: { type: "local", local: { path: contentDir } },
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

let geminiPort: number;
let gopherPort: number;
let spartanPort: number;
let nexPort: number;
let textPort: number;

const servers: net.Server[] = [];

// ── Setup / Teardown ──────────────────────────────────────────────────────

beforeAll(async () => {
  // Create fixture directories
  fs.mkdirSync(path.join(contentDir, "blog"), { recursive: true });

  // Public document
  fs.writeFileSync(
    path.join(contentDir, "blog", "welcome.mdx"),
    `---
title: Hello World
date: 2026-07-20
type: post
---

Hello World`
  );

  // Private document
  fs.writeFileSync(
    path.join(contentDir, "blog", "private.mdx"),
    `---
title: Private Post
date: 2026-07-20
type: post
visibility: private
---

This is a private post.`
  );

  // Generate self-signed cert for Gemini
  fs.mkdirSync(certDir, { recursive: true });
  execSync(
    "openssl req -x509 -newkey rsa:2048 -keyout " +
      path.join(certDir, "key.pem") +
      " -out " +
      path.join(certDir, "cert.pem") +
      " -days 1 -nodes -subj /CN=localhost",
    { stdio: "ignore", timeout: 10_000 }
  );

  // Init ORM with in-memory SQLite and index fixtures
  await initOrm(":memory:");
  createStorage(TEST_CONFIG);
  await reindexAll(TEST_CONFIG);

  // Start all smolnet servers on OS-assigned ports
  const geminiConfig: HypernextConfig = {
    ...TEST_CONFIG,
    protocols: {
      ...TEST_CONFIG.protocols,
      gemini: {
        enabled: true,
        port: 0,
        certPath: path.join(certDir, "cert.pem"),
        keyPath: path.join(certDir, "key.pem"),
      },
    },
  };

  const geminiServer = startGeminiServer(geminiConfig);
  servers.push(geminiServer);
  geminiPort = getPort(geminiServer);

  const gopherServer = startGopherServer(TEST_CONFIG);
  servers.push(gopherServer);
  gopherPort = getPort(gopherServer);

  const spartanServer = startSpartanServer(TEST_CONFIG);
  servers.push(spartanServer);
  spartanPort = getPort(spartanServer);

  const nexServer = startNexServer(TEST_CONFIG);
  servers.push(nexServer);
  nexPort = getPort(nexServer);

  const textServer = startTextServer(TEST_CONFIG);
  servers.push(textServer);
  textPort = getPort(textServer);
}, 20_000);

afterAll(async () => {
  for (const server of servers) {
    server.close();
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await closeOrm();
}, 10_000);

// ── Gemini Protocol Tests ─────────────────────────────────────────────────

describe("Gemini server handler", () => {
  it("returns home page for root request", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/\r\n`
    );
    expect(response).toContain("20 text/gemini");
    expect(response).toContain("SmolNet Test");
  });

  it("returns document content for valid path", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/blog/welcome\r\n`
    );
    expect(response).toContain("20 text/gemini");
    expect(response).toContain("Hello World");
  });

  it("returns 51 Not Found for missing document", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/blog/nonexistent\r\n`
    );
    expect(response).toContain("51 Not Found");
  });

  it("returns 51 Not Found for private document", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/blog/private\r\n`
    );
    expect(response).toContain("51 Not Found");
  });
});

// ── Gopher Protocol Tests ─────────────────────────────────────────────────

describe("Gopher server handler", () => {
  it("returns menu for root selector", async () => {
    const response = await tcpRequest(gopherPort, "/\r\n");
    // Root menu ends with terminator line
    expect(response).toContain(".\r\n");
    // Menu should list public documents
    expect(response).toContain("blog/welcome");
  });

  it("returns document content for valid selector", async () => {
    const response = await tcpRequest(gopherPort, "/blog/welcome\r\n");
    expect(response).toContain("Hello World");
    // Gopher responses are terminated with dot line
    expect(response).toContain(".\r\n");
  });

  it("returns error for missing selector", async () => {
    const response = await tcpRequest(gopherPort, "/blog/nonexistent\r\n");
    expect(response).toContain("Not Found");
    expect(response).toContain(".\r\n");
  });

  it("returns error for private document", async () => {
    const response = await tcpRequest(gopherPort, "/blog/private\r\n");
    expect(response).toContain("Not Found");
    expect(response).toContain(".\r\n");
  });
});

// ── Spartan Protocol Tests ────────────────────────────────────────────────

describe("Spartan server handler", () => {
  it("returns home page for root request", async () => {
    const response = await tcpRequest(spartanPort, "localhost / 0\r\n");
    expect(response).toContain("200 text/gemini");
    expect(response).toContain("SmolNet Test");
  });

  it("returns document content for valid path", async () => {
    const response = await tcpRequest(
      spartanPort,
      "localhost /blog/welcome 0\r\n"
    );
    expect(response).toContain("200 text/gemini");
    expect(response).toContain("Hello World");
  });

  it("returns 510 Not Found for missing document", async () => {
    const response = await tcpRequest(
      spartanPort,
      "localhost /blog/nonexistent 0\r\n"
    );
    expect(response).toContain("510 Not Found");
  });

  it("returns 510 Not Found for private document", async () => {
    const response = await tcpRequest(
      spartanPort,
      "localhost /blog/private 0\r\n"
    );
    expect(response).toContain("510 Not Found");
  });
});

// ── NEX Protocol Tests ────────────────────────────────────────────────────

describe("NEX server handler", () => {
  it("returns home page for root request", async () => {
    const response = await tcpRequest(nexPort, "/");
    expect(response).toContain("SmolNet Test");
  });

  it("returns document content for valid path", async () => {
    const response = await tcpRequest(nexPort, "/blog/welcome");
    expect(response).toContain("Hello World");
  });

  it("returns Not Found for missing document", async () => {
    const response = await tcpRequest(nexPort, "/blog/nonexistent");
    expect(response).toContain("Not Found");
  });

  it("returns Not Found for private document", async () => {
    const response = await tcpRequest(nexPort, "/blog/private");
    expect(response).toContain("Not Found");
  });
});

// ── Text Protocol Tests ───────────────────────────────────────────────────

describe("Text server handler", () => {
  it("returns home page for root request", async () => {
    const response = await tcpRequest(textPort, "/\n");
    expect(response).toContain("20 OK");
    expect(response).toContain("SmolNet Test");
  });

  it("returns document content for valid path", async () => {
    const response = await tcpRequest(textPort, "/blog/welcome\n");
    expect(response).toContain("20 OK");
    expect(response).toContain("Hello World");
  });

  it("returns 40 Not Found for missing document", async () => {
    const response = await tcpRequest(textPort, "/blog/nonexistent\n");
    expect(response).toContain("40 Not Found");
  });

  it("returns 40 Not Found for private document", async () => {
    const response = await tcpRequest(textPort, "/blog/private\n");
    expect(response).toContain("40 Not Found");
  });
});
