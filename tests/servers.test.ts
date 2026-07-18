import net from "node:net";
import type { MikroORM } from "@mikro-orm/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, initOrm, insertDoc } from "../src/database";
import { startFingerServer } from "../src/servers/finger";
import { startTextServer } from "../src/servers/text";
import type { HypernextConfig } from "../src/types/config";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Alice", email: "alice@example.com", bio: "A writer." },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {},
  taxonomies: [],
  protocols: {
    http: { enabled: false, port: 8080 },
    gemini: { enabled: false, port: 1965 },
    gopher: { enabled: false, port: 70 },
    spartan: { enabled: false, port: 300 },
    nex: { enabled: false, port: 1900 },
    finger: { enabled: true, port: 7999 },
    text: { enabled: true, port: 5012 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

function waitForPort(
  port: number,
  host = "127.0.0.1",
  timeout = 3000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = net.createConnection(port, host, () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
    };
    tryConnect();
  });
}

function connectAndRead(
  port: number,
  input: string,
  host = "127.0.0.1"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host, () => {
      socket.write(input);
    });
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      reject(new Error("Timeout"));
    }, 2000);
  });
}

describe("protocol servers", () => {
  let _orm: MikroORM;

  beforeAll(async () => {
    _orm = await initOrm(":memory:");
    await insertDoc({
      slug: "blog/hello",
      title: "Hello",
      rawMdx: "# Hello\n\nWorld.",
    });
    await insertDoc({
      slug: "blog/future",
      title: "Future",
      rawMdx:
        "---\ntitle: Future\ndate: 2099-01-01\n---\n\n# Future\n\nThis is from the future.",
    });
    startTextServer(testConfig);
    startFingerServer(testConfig);
    await waitForPort(5012);
    await waitForPort(7999);
  }, 10_000);

  afterAll(async () => {
    await closeOrm();
  });

  it("Text Protocol returns home", async () => {
    const response = await connectAndRead(5012, "/\n");
    expect(response).toContain("20");
    expect(response).toContain("Test");
  });

  it("Text Protocol returns 404 for missing slug", async () => {
    const response = await connectAndRead(5012, "/missing\n");
    expect(response).toContain("40");
  });

  it("Text Protocol returns 404 for future-dated doc", async () => {
    const response = await connectAndRead(5012, "/blog/future\n");
    expect(response).toContain("40");
  });

  it("Finger returns author info", async () => {
    const response = await connectAndRead(7999, "alice\r\n");
    expect(response).toContain("Alice");
    expect(response).toContain("alice@example.com");
  });
});
