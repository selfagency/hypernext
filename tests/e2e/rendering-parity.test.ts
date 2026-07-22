import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm } from "../../src/database/index.js";
import { reindexAll } from "../../src/indexer/index.js";
import { startGeminiServer } from "../../src/servers/gemini.js";
import { startGopherServer } from "../../src/servers/gopher.js";
import { createHttpServer } from "../../src/servers/http.js";
import { startNexServer } from "../../src/servers/nex.js";
import { startSpartanServer } from "../../src/servers/spartan.js";
import { startTextServer } from "../../src/servers/text.js";
import { createStorage } from "../../src/storage/index.js";
import type { HypernextConfig } from "../../src/types/config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SITE_TITLE = "Rendering Parity Test";
const SITE_DESC = "Cross-protocol rendering verification";
const DOC_TITLE = "Hello Rendering";
const DOC_BODY = "This is a test document.";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      { port, host: "localhost", rejectUnauthorized: false }, // NOSONAR — self-signed cert for E2E tests
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

// ── Fixtures and state ───────────────────────────────────────────────────────

const tmpDir = path.resolve("./tmp-rendering-parity");
const contentDir = path.join(tmpDir, "content");
const certDir = path.join(tmpDir, "certs");

let fastify: Awaited<ReturnType<typeof createHttpServer>>;
let httpPort: number;
let geminiPort: number;
let gopherPort: number;
let spartanPort: number;
let nexPort: number;
let textPort: number;

const servers: net.Server[] = [];

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create fixture directories
  fs.mkdirSync(path.join(contentDir, "blog"), { recursive: true });

  // Public document
  fs.writeFileSync(
    path.join(contentDir, "blog", "hello.mdx"),
    `---
title: ${DOC_TITLE}
date: 2026-07-21
type: post
tags: [test]
---

${DOC_BODY}`
  );

  // Document with structural elements
  fs.writeFileSync(
    path.join(contentDir, "blog", "structure.mdx"),
    `---
title: Structured Content
date: 2026-07-21
type: post
tags: [test, demo]
---

## Section One

A paragraph with **bold** text and a [link](/).

- List item one
- List item two`
  );

  // Private document
  fs.writeFileSync(
    path.join(contentDir, "blog", "private.mdx"),
    `---
title: Private Post
date: 2026-07-21
type: post
visibility: private
---

This content must not be exposed.`
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

  const config: HypernextConfig = {
    site: {
      canonicalBase: "http://localhost:0",
      meta: { title: SITE_TITLE, description: SITE_DESC, lang: "en" },
      pdf: { enabled: false },
      ebooks: { enabled: false },
    },
    author: { name: "Test Author" },
    storage: { type: "local", local: { path: contentDir } },
    database: { type: "sqlite", path: ":memory:" },
    api: { enabled: false },
    collections: {
      blog: {
        path: "/blog/",
        syndicate: false,
        rss: false,
        layout: "blog.mdx",
      },
    },
    taxonomies: [{ name: "tags", plural: "tags", singular: "tag" }],
    protocols: {
      http: { enabled: true, port: 0 },
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

  // Init ORM with in-memory SQLite and index fixtures
  await initOrm(":memory:");
  createStorage(config);
  await reindexAll(config);

  // Start HTTP server (Fastify) on OS-assigned port
  fastify = await createHttpServer(config);
  await fastify.listen({ port: 0, host: "0.0.0.0" });
  httpPort = (fastify.addresses()[0] as { port: number }).port;

  // Update canonicalBase to actual port so link headers are correct
  config.site.canonicalBase = `http://localhost:${httpPort}`;

  // Start Gemini with cert paths
  const geminiConfig: HypernextConfig = {
    ...config,
    protocols: {
      ...config.protocols,
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

  // Start remaining smolnet servers
  const gopherServer = startGopherServer(config);
  servers.push(gopherServer);
  gopherPort = getPort(gopherServer);

  const spartanServer = startSpartanServer(config);
  servers.push(spartanServer);
  spartanPort = getPort(spartanServer);

  const nexServer = startNexServer(config);
  servers.push(nexServer);
  nexPort = getPort(nexServer);

  const textServer = startTextServer(config);
  servers.push(textServer);
  textPort = getPort(textServer);
}, 30_000);

afterAll(async () => {
  await fastify.close();
  for (const server of servers) {
    server.close();
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await closeOrm();
}, 10_000);

// ── HTTP Protocol Tests ──────────────────────────────────────────────────────

describe("HTTP", () => {
  it("returns home page with site title", async () => {
    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SITE_TITLE);
    // HTML structural elements
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("<title>");
    expect(res.body).toContain(`<main class="container">`);
  });

  it("returns known document with doc title", async () => {
    const res = await fastify.inject({ method: "GET", url: "/blog/hello" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(DOC_TITLE);
    expect(res.body).toContain(DOC_BODY);
  });

  it("returns 404 for missing document", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/blog/nonexistent",
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("Not Found");
  });

  it("returns 404 for private document", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/blog/private",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Gemini Protocol Tests ───────────────────────────────────────────────────

describe("Gemini", () => {
  it("returns home page with site title", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/\r\n`
    );
    expect(response).toContain("20 text/gemini");
    expect(response).toContain(SITE_TITLE);
  });

  it("returns known document with doc title", async () => {
    const response = await tlsRequest(
      geminiPort,
      `gemini://localhost:${geminiPort}/blog/hello\r\n`
    );
    expect(response).toContain("20 text/gemini");
    expect(response).toContain(DOC_TITLE);
    expect(response).toContain(DOC_BODY);
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

// ── Gopher Protocol Tests ───────────────────────────────────────────────────

describe("Gopher", () => {
  it("returns home menu listing documents", async () => {
    const response = await tcpRequest(gopherPort, "/\r\n");
    expect(response).toContain(".\r\n"); // Gopher terminator
    expect(response).toContain("blog/hello");
  });

  it("returns known document with doc title", async () => {
    const response = await tcpRequest(gopherPort, "/blog/hello\r\n");
    expect(response).toContain(DOC_TITLE);
    expect(response).toContain(DOC_BODY);
    expect(response).toContain(".\r\n"); // Gopher terminator
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

// ── Spartan Protocol Tests ──────────────────────────────────────────────────

describe("Spartan", () => {
  it("returns home page with site title", async () => {
    const response = await tcpRequest(spartanPort, "localhost / 0\r\n");
    expect(response).toContain("200 text/gemini");
    expect(response).toContain(SITE_TITLE);
  });

  it("returns known document with doc title", async () => {
    const response = await tcpRequest(
      spartanPort,
      "localhost /blog/hello 0\r\n"
    );
    expect(response).toContain("200 text/gemini");
    expect(response).toContain(DOC_TITLE);
    expect(response).toContain(DOC_BODY);
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

// ── NEX Protocol Tests ──────────────────────────────────────────────────────

describe("NEX", () => {
  it("returns home page with site title", async () => {
    const response = await tcpRequest(nexPort, "/");
    expect(response).toContain(SITE_TITLE);
  });

  it("returns known document with doc title", async () => {
    const response = await tcpRequest(nexPort, "/blog/hello");
    expect(response).toContain(DOC_TITLE);
    expect(response).toContain(DOC_BODY);
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

// ── Text Protocol Tests ─────────────────────────────────────────────────────

describe("Text", () => {
  it("returns home page with site title", async () => {
    const response = await tcpRequest(textPort, "/\n");
    expect(response).toContain("20 OK");
    expect(response).toContain(SITE_TITLE);
  });

  it("returns known document with doc title", async () => {
    const response = await tcpRequest(textPort, "/blog/hello\n");
    expect(response).toContain("20 OK");
    expect(response).toContain(DOC_TITLE);
    expect(response).toContain(DOC_BODY);
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

// ── Cross-Protocol Rendering Parity ──────────────────────────────────────────

describe("Cross-protocol rendering parity", () => {
  const protocolFetch = {
    HTTP: () =>
      fastify.inject({ method: "GET", url: "/blog/hello" }).then((r) => r.body),
    Gemini: () =>
      tlsRequest(geminiPort, `gemini://localhost:${geminiPort}/blog/hello\r\n`),
    Gopher: () => tcpRequest(gopherPort, "/blog/hello\r\n"),
    Spartan: () => tcpRequest(spartanPort, "localhost /blog/hello 0\r\n"),
    NEX: () => tcpRequest(nexPort, "/blog/hello"),
    Text: () => tcpRequest(textPort, "/blog/hello\n"),
  };

  const protocolNotFound = {
    HTTP: () =>
      fastify
        .inject({ method: "GET", url: "/blog/nonexistent" })
        .then((r) => ({ status: r.statusCode, body: r.body })),
    Gemini: () =>
      tlsRequest(
        geminiPort,
        `gemini://localhost:${geminiPort}/blog/nonexistent\r\n`
      ).then((body) => ({ body })),
    Gopher: () =>
      tcpRequest(gopherPort, "/blog/nonexistent\r\n").then((body) => ({
        body,
      })),
    Spartan: () =>
      tcpRequest(spartanPort, "localhost /blog/nonexistent 0\r\n").then(
        (body) => ({ body })
      ),
    NEX: () =>
      tcpRequest(nexPort, "/blog/nonexistent").then((body) => ({ body })),
    Text: () =>
      tcpRequest(textPort, "/blog/nonexistent\n").then((body) => ({ body })),
  };

  const notFoundChecks: Record<string, (body: string) => void> = {
    HTTP: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("Not Found");
    },
    Gemini: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("51 Not Found");
    },
    Gopher: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("Not Found");
    },
    Spartan: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("510 Not Found");
    },
    NEX: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("Not Found");
    },
    Text: (body) => {
      /* biome-ignore lint/suspicious/noMisplacedAssertion: called from test */ expect(
        body
      ).toContain("40 Not Found");
    },
  };

  it.each(
    Object.keys(protocolFetch)
  )("delivers doc title via %s", async (name) => {
    const body = await protocolFetch[name as keyof typeof protocolFetch]();
    expect(body).toContain(DOC_TITLE);
  });

  it.each(
    Object.keys(protocolFetch)
  )("delivers doc body via %s", async (name) => {
    const body = await protocolFetch[name as keyof typeof protocolFetch]();
    expect(body).toContain(DOC_BODY);
  });

  it.each(
    Object.keys(protocolNotFound)
  )("returns Not Found for missing doc via %s", async (name) => {
    const { body } =
      await protocolNotFound[name as keyof typeof protocolNotFound]();
    notFoundChecks[name as keyof typeof notFoundChecks](body);
  });

  it("site title present on home page across all protocols", async () => {
    const results = await Promise.all([
      fastify.inject({ method: "GET", url: "/" }).then((r) => r.body),
      tlsRequest(geminiPort, `gemini://localhost:${geminiPort}/\r\n`),
      tcpRequest(spartanPort, "localhost / 0\r\n"),
      tcpRequest(nexPort, "/"),
      tcpRequest(textPort, "/\n"),
    ]);
    for (const body of results) {
      expect(body).toContain(SITE_TITLE);
    }
  });
});
