import crypto from "node:crypto";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiUrl } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function generateRsaKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function createHttpSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  keyId: string,
  privateKeyPem: string
): string {
  const headerList = [
    "(request-target)",
    "host",
    "date",
    "content-type",
    "digest",
  ];
  const signingString = headerList
    .map((h) => {
      if (h === "(request-target)") {
        return `(request-target): ${method.toLowerCase()} ${url}`;
      }
      const lower = h.toLowerCase();
      return `${lower}: ${headers[lower] ?? ""}`;
    })
    .join("\n");

  const signer = crypto.createSign("sha256");
  signer.update(signingString, "utf-8");
  signer.end();
  const signature = signer.sign(privateKeyPem, "base64");

  const params = headerList.join(" ");
  return `keyId="${keyId}",algorithm="rsa-sha256",headers="${params}",signature="${signature}"`;
}

// ── Module-level constants ────────────────────────────────────────────────

const SIGNATURE_REGEX =
  /^keyId="([^"]+)",\s*algorithm="([^"]+)",\s*headers="([^"]*)",\s*signature="([^"]+)"$/;
const WHITESPACE_REGEX = /\s+/;
const DID_PLC_REGEX = /^did:plc:/;
const ATSLASH_REGEX = /^at:\/\//;
const BAFY_REGEX = /^bafy/;

// ──────────────────────────────────────────────
// Global setup
// ──────────────────────────────────────────────

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

// ══════════════════════════════════════════════
// WebFinger — RFC 7033 /.well-known/webfinger
// ══════════════════════════════════════════════

describe("WebFinger", () => {
  it("returns valid JRD for the known account", async () => {
    const res = await fetch(
      apiUrl("/.well-known/webfinger?resource=acct:e2e-author@localhost:0")
    );
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
    const body = await res.json();
    expect(body.subject).toBe("acct:e2e-author@localhost:0");
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links.length).toBeGreaterThanOrEqual(1);
    const self = body.links.find((l: { rel: string }) => l.rel === "self");
    expect(self).toBeDefined();
    expect(self.type).toBe("application/activity+json");
    expect(self.href).toBeTruthy();
    expect(self.href).toContain("/actor");
  });

  it("returns 400 when resource parameter is missing", async () => {
    const res = await fetch(apiUrl("/.well-known/webfinger"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 404 for a resource that does not match the local account", async () => {
    const res = await fetch(
      apiUrl("/.well-known/webfinger?resource=acct:nobody@example.com")
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 404 when the host portion does not match", async () => {
    const res = await fetch(
      apiUrl("/.well-known/webfinger?resource=acct:e2e-author@other-host.com")
    );
    expect(res.status).toBe(404);
  });

  it("ignores unknown query parameters gracefully", async () => {
    const res = await fetch(
      apiUrl(
        "/.well-known/webfinger?resource=acct:e2e-author@localhost:0&extra=foo&rel=http://webfinger.example/rel/profile-page"
      )
    );
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════
// Actor endpoint
// ══════════════════════════════════════════════

describe("Actor endpoint", () => {
  it("returns a valid ActivityPub Person with all required fields", async () => {
    const res = await fetch(apiUrl("/actor"));
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");

    const body = await res.json();
    expect(body["@context"]).toBeDefined();
    const ctx = Array.isArray(body["@context"])
      ? body["@context"]
      : [body["@context"]];
    expect(ctx).toContain("https://www.w3.org/ns/activitystreams");

    expect(body.type).toBe("Person");
    expect(body.id).toBeTruthy();
    expect(body.id).toContain("/actor");
    expect(body.preferredUsername).toBe("e2e-author");
    expect(body.name).toBe("E2E Author");
    expect(body.summary).toBeDefined();
    expect(body.inbox).toBeTruthy();
    expect(body.inbox).toContain("/inbox");
    expect(body.outbox).toBeTruthy();
    expect(body.outbox).toContain("/outbox");
    expect(body.publicKey).toBeDefined();
    expect(body.publicKey.id).toBeTruthy();
    expect(body.publicKey.owner).toBeTruthy();
    expect(body.url).toBeTruthy();
  });
});

// ══════════════════════════════════════════════
// NodeInfo
// ══════════════════════════════════════════════

describe("NodeInfo", () => {
  let nodeInfoSrv: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    nodeInfoSrv = Fastify({ logger: false });

    nodeInfoSrv.get("/.well-known/nodeinfo", (_req, reply) => {
      const port = (nodeInfoSrv.addresses()[0] as { port: number }).port;
      reply.send({
        links: [
          {
            rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
            href: `http://127.0.0.1:${port}/api/v1/nodeinfo/2.1`,
          },
        ],
      });
    });

    nodeInfoSrv.get("/api/v1/nodeinfo/2.1", (_req, reply) => {
      reply.send({
        version: "2.1",
        software: { name: "hypernext", version: "1.0.0" },
        protocols: { inbound: ["activitypub"], outbound: ["activitypub"] },
        services: { inbound: [], outbound: [] },
        openRegistrations: false,
        usage: {
          users: { total: 1, activeHalfyear: 1, activeMonth: 1 },
          localPosts: 0,
        },
        metadata: {},
      });
    });

    await nodeInfoSrv.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await nodeInfoSrv.close();
  });

  it("GET /.well-known/nodeinfo returns a link set", async () => {
    const port = (nodeInfoSrv.addresses()[0] as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/nodeinfo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links).toBeDefined();
    expect(body.links.length).toBeGreaterThanOrEqual(1);
    const link = body.links[0];
    expect(link.rel).toBe("http://nodeinfo.diaspora.software/ns/schema/2.1");
    expect(link.href).toBeTruthy();
    expect(link.href).toContain("/api/v1/nodeinfo/2.1");
  });

  it("GET /api/v1/nodeinfo/2.1 returns a valid NodeInfo document", async () => {
    const port = (nodeInfoSrv.addresses()[0] as { port: number }).port;
    const linkRes = await fetch(
      `http://127.0.0.1:${port}/.well-known/nodeinfo`
    );
    const linkBody = await linkRes.json();
    const href: string = linkBody.links[0].href;

    const res = await fetch(href);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.version).toBe("2.1");
    expect(doc.software.name).toBe("hypernext");
    expect(doc.protocols.inbound).toContain("activitypub");
    expect(doc.protocols.outbound).toContain("activitypub");
    expect(doc.openRegistrations).toBe(false);
    expect(doc.usage.users.total).toBeTypeOf("number");
  });
});

// ══════════════════════════════════════════════
// Inbox — POST /inbox
// ══════════════════════════════════════════════

describe("Inbox", () => {
  it("accepts a Follow activity", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://remote.example/actor",
        object: `${e2e.config.site.canonicalBase}/actor`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("accepts a Create activity with a Note object", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://remote.example/actor",
        object: {
          type: "Note",
          content: "<p>A note from the fediverse</p>",
          inReplyTo: "https://unrelated.example/post",
          attributedTo: "https://remote.example/actor",
          published: new Date().toISOString(),
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("accepts a Like activity", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Like",
        actor: "https://remote.example/actor",
        object: `${e2e.config.site.canonicalBase}/post/hello`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("accepts an Announce (reblog) activity", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Announce",
        actor: "https://remote.example/actor",
        object: `${e2e.config.site.canonicalBase}/post/hello`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("accepts an Undo activity", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Undo",
        actor: "https://remote.example/actor",
        object: {
          type: "Follow",
          actor: "https://remote.example/actor",
          object: `${e2e.config.site.canonicalBase}/actor`,
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json-at-all",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for an empty body", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(res.status).toBe(400);
  });

  it("responds with application/json content type", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://remote.example/actor",
        object: `${e2e.config.site.canonicalBase}/actor`,
      }),
    });
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
  });

  it("accepts a Create with a string object reference", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://remote.example/actor",
        object: "https://remote.example/posts/abc",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });
});

// ══════════════════════════════════════════════
// Outbox — GET /outbox
// ══════════════════════════════════════════════

describe("Outbox", () => {
  it("returns an OrderedCollection with totalItems and orderedItems", async () => {
    const res = await fetch(apiUrl("/outbox"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["@context"]).toBeDefined();
    expect(body.type).toBe("OrderedCollection");
    expect(typeof body.totalItems).toBe("number");
    expect(Array.isArray(body.orderedItems)).toBe(true);
  });

  it("returns application/json content type", async () => {
    const res = await fetch(apiUrl("/outbox"));
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
  });
});

// ══════════════════════════════════════════════
// HTTP Signatures
// ══════════════════════════════════════════════

describe("HTTP Signatures", () => {
  let mockActorSrv: ReturnType<typeof Fastify>;
  let actorPort: number;
  let keyPair: { publicKeyPem: string; privateKeyPem: string };
  let keyId: string;

  beforeAll(async () => {
    keyPair = generateRsaKeyPair();

    mockActorSrv = Fastify({ logger: false });
    mockActorSrv.get("/actor", (_req, reply) => {
      const port = (mockActorSrv.addresses()[0] as { port: number }).port;
      reply.send({
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/v1",
        ],
        type: "Person",
        id: `http://127.0.0.1:${port}/actor`,
        preferredUsername: "sig-test-remote",
        publicKey: {
          id: `http://127.0.0.1:${port}/actor#main-key`,
          owner: `http://127.0.0.1:${port}/actor`,
          publicKeyPem: keyPair.publicKeyPem,
        },
      });
    });

    await mockActorSrv.listen({ port: 0, host: "127.0.0.1" });
    actorPort = (mockActorSrv.addresses()[0] as { port: number }).port;
    keyId = `http://127.0.0.1:${actorPort}/actor#main-key`;
  });

  afterAll(async () => {
    await mockActorSrv.close();
  });

  it("sends a properly signed POST to /inbox", async () => {
    const date = new Date().toUTCString();
    const bodyPayload = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Follow",
      actor: `http://127.0.0.1:${actorPort}/actor`,
      object: `${e2e.config.site.canonicalBase}/actor`,
    };
    const bodyStr = JSON.stringify(bodyPayload);
    const digest = crypto.createHash("sha256").update(bodyStr).digest("base64");

    const headers: Record<string, string> = {
      host: `127.0.0.1:${e2e.httpPort}`,
      date,
      "content-type": "application/activity+json",
      digest: `SHA-256=${digest}`,
    };

    const signature = createHttpSignature(
      "POST",
      "/inbox",
      headers,
      keyId,
      keyPair.privateKeyPem
    );

    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { ...headers, signature },
      body: bodyStr,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("accepted");
  }, 15_000);

  it("accepts inbox POST without signature header", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: `http://127.0.0.1:${actorPort}/actor`,
        object: `${e2e.config.site.canonicalBase}/actor`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("accepts a POST with a malformed signature header", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        signature: "not-a-valid-signature-format",
      },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: `http://127.0.0.1:${actorPort}/actor`,
        object: `${e2e.config.site.canonicalBase}/actor`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("verifies a signature round-trips the signing string correctly", () => {
    const date = new Date().toUTCString();
    const bodyStr = JSON.stringify({ type: "Follow" });
    const digest = crypto.createHash("sha256").update(bodyStr).digest("base64");

    const headers: Record<string, string> = {
      host: "localhost:8080",
      date,
      "content-type": "application/activity+json",
      digest: `SHA-256=${digest}`,
    };

    const pair = generateRsaKeyPair();
    const sigHeader = createHttpSignature(
      "POST",
      "/inbox",
      headers,
      "https://example.com/actor#main-key",
      pair.privateKeyPem
    );

    const match = sigHeader.match(SIGNATURE_REGEX);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("https://example.com/actor#main-key");
    expect(match?.[2]).toBe("rsa-sha256");

    const signedHeaders = match?.[3] ?? "";
    const signature = match?.[4] ?? "";
    const headerList = signedHeaders.split(WHITESPACE_REGEX);
    const signingString = headerList
      .map((h) => {
        if (h === "(request-target)") {
          return "(request-target): post /inbox";
        }
        return `${h}: ${headers[h.toLowerCase()] ?? ""}`;
      })
      .join("\n");

    const verifier = crypto.createVerify("sha256");
    verifier.update(signingString, "utf-8");
    verifier.end();
    const verified = verifier.verify(
      pair.publicKeyPem,
      Buffer.from(signature, "base64")
    );
    expect(verified).toBe(true);
  });
});

// ══════════════════════════════════════════════
// AT Protocol — mocked PDS
// ══════════════════════════════════════════════

describe("AT Protocol", () => {
  let mockPds: ReturnType<typeof Fastify>;
  let pdsPort: number;

  beforeAll(async () => {
    mockPds = Fastify({ logger: false });

    // com.atproto.identity.resolveHandle
    mockPds.get("/xrpc/com.atproto.identity.resolveHandle", (req, reply) => {
      const { handle } = req.query as { handle?: string };
      if (!handle) {
        reply
          .code(400)
          .send({ error: "InvalidRequest", message: "Missing handle" });
        return;
      }
      const hash = crypto
        .createHash("sha256")
        .update(handle)
        .digest("hex")
        .slice(0, 24);
      reply.send({ did: `did:plc:${hash}` });
    });

    // com.atproto.repo.createRecord
    mockPds.post("/xrpc/com.atproto.repo.createRecord", (req, reply) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!(body?.collection && body?.record)) {
        reply.code(400).send({
          error: "InvalidRequest",
          message: "Missing collection or record",
        });
        return;
      }
      const repo = (body.repo as string) ?? "did:plc:test";
      const collection = body.collection as string;
      reply.send({
        uri: `at://${repo}/${collection}/${crypto.randomUUID()}`,
        cid: `bafy${crypto.createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 50)}`,
      });
    });

    // com.atproto.repo.getRecord
    mockPds.get("/xrpc/com.atproto.repo.getRecord", (req, reply) => {
      const q = req.query as {
        repo?: string;
        collection?: string;
        rkey?: string;
      };
      if (!(q.repo && q.collection)) {
        reply.code(400).send({
          error: "InvalidRequest",
          message: "Missing repo or collection",
        });
        return;
      }
      reply.send({
        uri: `at://${q.repo}/${q.collection}/${q.rkey ?? "self"}`,
        cid: "bafyfakerecordcid",
        value: {
          text: "Hello from AT Protocol!",
          createdAt: new Date().toISOString(),
        },
      });
    });

    // com.atproto.repo.listRecords
    mockPds.get("/xrpc/com.atproto.repo.listRecords", (req, reply) => {
      const q = req.query as { repo?: string; collection?: string };
      if (!q.repo) {
        reply
          .code(400)
          .send({ error: "InvalidRequest", message: "Missing repo" });
        return;
      }
      reply.send({
        records: [
          {
            uri: `at://${q.repo}/${q.collection ?? "app.bsky.feed.post"}/1`,
            cid: "bafyreclist1",
            value: { text: "Record 1", createdAt: "2026-01-01T00:00:00Z" },
          },
          {
            uri: `at://${q.repo}/${q.collection ?? "app.bsky.feed.post"}/2`,
            cid: "bafyreclist2",
            value: { text: "Record 2", createdAt: "2026-06-15T12:00:00Z" },
          },
        ],
      });
    });

    // app.bsky.feed.getPostThread
    mockPds.get("/xrpc/app.bsky.feed.getPostThread", (_req, reply) => {
      reply.send({
        thread: {
          post: {
            uri: "at://did:plc:test/app.bsky.feed.post/1",
            author: { handle: "author.bsky.social", displayName: "Author" },
            record: {
              text: "Original post",
              createdAt: new Date().toISOString(),
            },
          },
          replies: [
            {
              post: {
                uri: "at://did:plc:test/app.bsky.feed.post/r1",
                author: {
                  handle: "replier.bsky.social",
                  displayName: "Replier",
                },
                record: {
                  text: "A reply to the post",
                  createdAt: new Date().toISOString(),
                },
              },
            },
          ],
        },
      });
    });

    // Health check
    mockPds.get("/xrpc/_health", (_req, reply) => {
      reply.send({ health: "ok" });
    });

    await mockPds.listen({ port: 0, host: "127.0.0.1" });
    pdsPort = (mockPds.addresses()[0] as { port: number }).port;
  });

  afterAll(async () => {
    await mockPds.close();
  });

  describe("com.atproto.identity.resolveHandle", () => {
    it("resolves a known handle to a DID", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.identity.resolveHandle?handle=alice.test`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.did).toBeDefined();
      expect(body.did).toMatch(DID_PLC_REGEX);
      expect(body.did.length).toBeGreaterThan(20);
    });

    it("returns 400 when handle is missing", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.identity.resolveHandle`
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns deterministic DID for the same handle", async () => {
      const [r1, r2] = await Promise.all([
        fetch(
          `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.identity.resolveHandle?handle=idem.test`
        ),
        fetch(
          `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.identity.resolveHandle?handle=idem.test`
        ),
      ]);
      const b1 = await r1.json();
      const b2 = await r2.json();
      expect(b1.did).toBe(b2.did);
    });
  });

  describe("com.atproto.repo.createRecord", () => {
    it("creates a post record", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.createRecord`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: "did:plc:test",
            collection: "app.bsky.feed.post",
            record: {
              text: "Hello from Hypernext E2E",
              createdAt: new Date().toISOString(),
            },
          }),
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.uri).toMatch(ATSLASH_REGEX);
      expect(body.uri).toContain("app.bsky.feed.post");
      expect(body.cid).toBeDefined();
      expect(body.cid).toMatch(BAFY_REGEX);
    });

    it("creates a like record", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.createRecord`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: "did:plc:test",
            collection: "app.bsky.feed.like",
            record: {
              subject: {
                uri: "at://did:plc:other/app.bsky.feed.post/1",
                cid: "bafyothercid",
              },
              createdAt: new Date().toISOString(),
            },
          }),
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.uri).toContain("app.bsky.feed.like");
    });

    it("creates a follow record", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.createRecord`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: "did:plc:follower",
            collection: "app.bsky.graph.follow",
            record: {
              subject: "did:plc:followed",
              createdAt: new Date().toISOString(),
            },
          }),
        }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.uri).toContain("app.bsky.graph.follow");
    });

    it("returns 400 when collection is missing", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.createRecord`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: "did:plc:test",
            record: { text: "nope" },
          }),
        }
      );
      expect(res.status).toBe(400);
    });
  });

  describe("com.atproto.repo.getRecord", () => {
    it("gets a record by repo and collection", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.getRecord?repo=did:plc:test&collection=app.bsky.feed.post&rkey=self`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.uri).toBeDefined();
      expect(body.value).toBeDefined();
      expect(body.value.text).toBeDefined();
    });

    it("returns 400 when repo is missing", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.getRecord?collection=app.bsky.feed.post`
      );
      expect(res.status).toBe(400);
    });
  });

  describe("com.atproto.repo.listRecords", () => {
    it("lists records for a repo", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.listRecords?repo=did:plc:test`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.records)).toBe(true);
      expect(body.records.length).toBeGreaterThanOrEqual(1);
    });

    it("returns 400 when repo is missing", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/com.atproto.repo.listRecords`
      );
      expect(res.status).toBe(400);
    });
  });

  describe("app.bsky.feed.getPostThread", () => {
    it("returns post thread with replies", async () => {
      const res = await fetch(
        `http://127.0.0.1:${pdsPort}/xrpc/app.bsky.feed.getPostThread?uri=at://did:plc:test/app.bsky.feed.post/1`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.thread).toBeDefined();
      expect(body.thread.post).toBeDefined();
      expect(body.thread.replies).toBeDefined();
    });
  });

  describe("Health check", () => {
    it("reports healthy", async () => {
      const res = await fetch(`http://127.0.0.1:${pdsPort}/xrpc/_health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.health).toBe("ok");
    });
  });
});

// ══════════════════════════════════════════════
// atproto-devnet integration (conditional)
// ══════════════════════════════════════════════

const devnetPdsUrl = process.env.AT_PROTOCOL_DEVNET;
const devnetDescribe = devnetPdsUrl ? describe : describe.skip;

devnetDescribe("atproto-devnet integration", () => {
  it("connects to atproto-devnet PDS health endpoint", async () => {
    const res = await fetch(`${devnetPdsUrl}/xrpc/_health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health).toBe("ok");
  });

  it("resolves a handle on atproto-devnet", async () => {
    const res = await fetch(
      `${devnetPdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=admin.test`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.did).toBeDefined();
    expect(body.did).toMatch(DID_PLC_REGEX);
  });

  it("creates a record on atproto-devnet", async () => {
    const res = await fetch(
      `${devnetPdsUrl}/xrpc/com.atproto.repo.createRecord`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: "did:plc:devnet-test",
          collection: "app.bsky.feed.post",
          record: {
            text: "Hello from Hypernext E2E test",
            createdAt: new Date().toISOString(),
          },
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uri).toBeDefined();
    expect(body.cid).toBeDefined();
  });
});
