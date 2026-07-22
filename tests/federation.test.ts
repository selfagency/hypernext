import crypto from "node:crypto";
import Fastify from "fastify";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Mention } from "../src/database/entities/mention.js";
import { closeOrm, getEm, initOrm, insertDoc } from "../src/database/index.js";
import { registerActivityPubRoutes } from "../src/federation/activitypub.js";
import { getGlobalCommentConfig } from "../src/federation/config-resolver.js";
import {
  processContactForm,
  processNewSubscription,
  sendInstantNotification,
  sendTestEmail,
  sendWeeklyDigest,
} from "../src/federation/email-tasks.js";
import {
  processInboundMention,
  registerInboundRoutes,
} from "../src/federation/inbound.js";
import {
  fetchBlueskyReplies,
  fetchMastodonReplies,
} from "../src/federation/posse-replies.js";
import { validateSourceUrl } from "../src/federation/ssrf.js";
import {
  enqueueInboundMention,
  enqueueOutboundSyndication,
} from "../src/jobs/schedule.js";
import { initJobsTable, listJobs } from "../src/jobs/queue.js";
import type { HypernextConfig } from "../src/types/config.js";

const testConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Alice", bio: "A writer." },
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

// ────────────────────────────────────────────────────────
// Database-backed test config (used for mention / workmatic tests)
// ────────────────────────────────────────────────────────

const dbTestConfig: HypernextConfig = {
  ...testConfig,
  comments: {
    enabled: true,
    inbound: { webmention: true, pingback: true, trackback: true },
    aggregation: { mastodon: true, bluesky: true, cacheTtl: 900 },
    akismet: { enabled: true },
    allowPrivateSources: true,
  },
  email: {
    enabled: false,
    from: { name: "Test", address: "test@example.com" },
    contactForm: {
      enabled: false,
      captcha: false,
      akismet: false,
      recipient: "owner@example.com",
    },
    newsletter: { digestSchedule: "0 8 * * 1", digestTime: "08:00" },
    replyTo: "noreply@example.com",
    smtp: { host: "", pass: "", port: 587, secure: false, user: "" },
    subjectPrefix: "[Test]",
    transport: "smtp",
  },
};

describe("federation", () => {
  // ── Existing tests (preserved verbatim) ──

  it("serves WebFinger endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/webfinger?resource=acct:alice@localhost:8080",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.subject).toContain("alice");
    expect(body.links[0].rel).toBe("self");
    await fastify.close();
  });

  it("returns 400 for missing resource", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/webfinger",
    });
    expect(response.statusCode).toBe(400);
    await fastify.close();
  });

  it("serves Actor endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({ method: "GET", url: "/actor" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.type).toBe("Person");
    expect(body.preferredUsername).toBe("alice");
    await fastify.close();
  });

  it("serves Outbox endpoint", async () => {
    const fastify = Fastify();
    registerActivityPubRoutes(fastify, testConfig);
    const response = await fastify.inject({ method: "GET", url: "/outbox" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.type).toBe("OrderedCollection");
    await fastify.close();
  });

  // ══════════════════════════════════════════════════════
  // NEW TEST SECTIONS
  // ══════════════════════════════════════════════════════

  // ── SSRF validation ──

  describe("SSRF validation", () => {
    it("allows public HTTPS URLs", async () => {
      await expect(
        validateSourceUrl("https://example.com/article")
      ).resolves.toBe(true);
    });

    it("allows public HTTP URLs", async () => {
      await expect(
        validateSourceUrl("http://example.com/article")
      ).resolves.toBe(true);
    });

    it("rejects non-http schemes", async () => {
      await expect(validateSourceUrl("ftp://example.com/file")).resolves.toBe(
        false
      );
      await expect(validateSourceUrl("file:///etc/passwd")).resolves.toBe(
        false
      );
      await expect(validateSourceUrl("data:text/plain,hello")).resolves.toBe(
        false
      );
    });

    it("rejects malformed URLs", async () => {
      await expect(validateSourceUrl("not a url")).resolves.toBe(false);
      await expect(validateSourceUrl("")).resolves.toBe(false);
    });

    it("rejects localhost", async () => {
      await expect(
        validateSourceUrl("http://localhost:3000/article")
      ).resolves.toBe(false);
      await expect(validateSourceUrl("http://127.0.0.1/article")).resolves.toBe(
        false
      );
      await expect(validateSourceUrl("http://0.0.0.0/article")).resolves.toBe(
        false
      );
      await expect(validateSourceUrl("http://[::1]/article")).resolves.toBe(
        false
      );
    });

    it("rejects private IPv4 ranges", async () => {
      await expect(validateSourceUrl("http://10.0.0.1/article")).resolves.toBe(
        false
      );
      await expect(
        validateSourceUrl("http://172.16.0.1/article")
      ).resolves.toBe(false);
      await expect(
        validateSourceUrl("http://192.168.1.1/article")
      ).resolves.toBe(false);
    });

    it("allows private IPs when allowPrivate is true", async () => {
      await expect(
        validateSourceUrl("http://127.0.0.1/article", true)
      ).resolves.toBe(true);
      await expect(
        validateSourceUrl("http://10.0.0.1/article", true)
      ).resolves.toBe(true);
      await expect(
        validateSourceUrl("http://192.168.1.1/article", true)
      ).resolves.toBe(true);
    });
  });

  // ── Comment config defaults ──

  describe("Comment config defaults", () => {
    it("returns defaults when no comments in config", () => {
      const cfg = getGlobalCommentConfig(testConfig);
      expect(cfg.enabled).toBe(true);
      expect(cfg.inbound.webmention).toBe(true);
      expect(cfg.inbound.pingback).toBe(true);
      expect(cfg.inbound.trackback).toBe(false);
      expect(cfg.aggregation.mastodon).toBe(true);
      expect(cfg.aggregation.bluesky).toBe(true);
      expect(cfg.aggregation.cacheTtl).toBe(900);
      expect(cfg.akismet.enabled).toBe(true);
      expect(cfg.allowPrivateSources).toBe(false);
    });

    it("merges user-supplied comment config over defaults", () => {
      const cfg = getGlobalCommentConfig({
        ...testConfig,
        comments: {
          enabled: false,
          inbound: { webmention: false, pingback: false, trackback: false },
          aggregation: { mastodon: false, bluesky: false, cacheTtl: 1800 },
          akismet: { enabled: false },
        },
      });
      expect(cfg.enabled).toBe(false);
      expect(cfg.inbound.webmention).toBe(false);
      expect(cfg.inbound.pingback).toBe(false);
      expect(cfg.aggregation.cacheTtl).toBe(1800);
      expect(cfg.akismet.enabled).toBe(false);
    });
  });

  // ── Inbound mention routes ──

  describe("Inbound mention routes", () => {
    it("POST /webmention returns 202 for valid payload", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/webmention",
        payload: {
          source: "https://example.com/article",
          target: "http://localhost:8080/hello",
        },
      });
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ status: "accepted" });
      await fastify.close();
    });

    it("POST /webmention returns 400 when source or target missing", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/webmention",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });

    it("POST /pingback returns 200 (XML-RPC) for valid pingback", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/pingback",
        payload: {
          methodName: "pingback.ping",
          params: [
            { value: { string: "https://source.example.com/post" } },
            { value: { string: "http://localhost:8080/target" } },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/xml");
      expect(res.body).toContain("Thanks");
      await fastify.close();
    });

    it("POST /pingback returns 400 for invalid methodName", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/pingback",
        payload: { methodName: "system.listMethods", params: [] },
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });

    it("POST /pingback returns 400 when params missing", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/pingback",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });

    it("POST /trackback/* returns 202 for valid trackback", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/trackback/my-post",
        payload: {
          url: "https://source.example.com/post",
          title: "My Trackback",
          excerpt: "An excerpt of the post",
          blog_name: "Source Blog",
        },
      });
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ status: "accepted" });
      await fastify.close();
    });

    it("POST /trackback/* returns 400 when url missing", async () => {
      const fastify = Fastify();
      registerInboundRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/trackback/my-post",
        payload: { title: "No URL" },
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });
  });

  // ── ActivityPub inbox ──

  describe("ActivityPub inbox", () => {
    // Generate a test keypair for signing ActivityPub requests
    const TEST_KEY_ID = "https://remote.example/users/bob#main-key";
    const { privateKey: TEST_PRIVATE_KEY } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const TEST_PUBLIC_KEY_PEM = crypto
      .createPublicKey(TEST_PRIVATE_KEY)
      .export({ type: "spki", format: "pem" });

    // Mock the key fetch so verifyHttpSignature can find the public key
    // Match both the actor URL and the keyId URL (with fragment)
    const apMock = setupServer(
      http.get("https://remote.example/users/bob", () => {
        return HttpResponse.json({
          id: "https://remote.example/users/bob",
          publicKey: {
            id: TEST_KEY_ID,
            owner: "https://remote.example/users/bob",
            publicKeyPem: TEST_PUBLIC_KEY_PEM,
          },
        });
      }),
      http.get("https://remote.example/users/bob#main-key", () => {
        return HttpResponse.json({
          id: TEST_KEY_ID,
          publicKey: {
            id: TEST_KEY_ID,
            owner: "https://remote.example/users/bob",
            publicKeyPem: TEST_PUBLIC_KEY_PEM,
          },
        });
      })
    );

    beforeAll(() => {
      apMock.listen({ onUnhandledRequest: "bypass" });
    });
    afterEach(() => apMock.resetHandlers());
    afterAll(() => apMock.close());

    function signedHeaders(
      method: string,
      url: string,
      body?: string
    ): Record<string, string> {
      const date = new Date().toUTCString();
      const signingString = [
        `(request-target): ${method.toLowerCase()} ${url}`,
        `host: remote.example`,
        `date: ${date}`,
      ].join("\n");
      const signer = crypto.createSign("sha256");
      signer.update(signingString);
      signer.end();
      const signature = signer.sign(TEST_PRIVATE_KEY, "base64");
      const sigHeader = `keyId="${TEST_KEY_ID}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;
      return {
        signature: sigHeader,
        date,
        host: "remote.example",
        "content-type": "application/json",
        accept: "application/activity+json",
      };
    }

    it("POST /inbox returns 400 for invalid JSON body (malformed)", async () => {
      const fastify = Fastify();
      registerActivityPubRoutes(fastify, testConfig);
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: "not-json-at-all",
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });

    it("POST /inbox accepts Follow activity and returns { status: accepted }", async () => {
      const fastify = Fastify();
      registerActivityPubRoutes(fastify, testConfig);
      const payload = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://remote.example/users/bob",
        object: "http://localhost:8080/actor",
      });
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: payload,
        headers: signedHeaders("POST", "/inbox", payload),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: "accepted" });
      await fastify.close();
    });

    it("POST /inbox accepts unknown activity types without error", async () => {
      const fastify = Fastify();
      registerActivityPubRoutes(fastify, testConfig);
      const payload = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Like",
        actor: "https://remote.example/users/bob",
        object: "http://localhost:8080/post/1",
      });
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: payload,
        headers: signedHeaders("POST", "/inbox", payload),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: "accepted" });
      await fastify.close();
    });
  });

  // ── Inbound mention processing (full database-backed flow) ──

  describe("Inbound mention processing", () => {
    const testSlug = "test-mention-post";
    let originalFetch: typeof globalThis.fetch;

    beforeAll(async () => {
      await initOrm(":memory:");
      await insertDoc({
        slug: testSlug,
        title: "Test Mention Post",
        rawMdx: "# Hello\n\nThis is a test.",
        metaJson: JSON.stringify({}),
      });
      originalFetch = globalThis.fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await closeOrm();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("processes a valid webmention and stores a mention", async () => {
      // Mock fetch so the source HTML is available and link verification passes
      globalThis.fetch = (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.startsWith("https://source.example.com/")) {
          return new Response(
            `<html><body><div class="h-entry">
              <p class="p-name">Alice Commenter</p>
              <div class="e-content"><p>Great post! Thanks for writing this.</p></div>
              <a href="http://localhost:8080/${testSlug}" class="u-url">permalink</a>
              <img src="https://source.example.com/avatar.jpg" class="u-photo" />
              <time class="dt-published" datetime="2026-07-20T12:00:00Z">Jul 20</time>
            </div></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      };

      await expect(
        processInboundMention(dbTestConfig, {
          source: "https://source.example.com/reply-to-test",
          target: `http://localhost:8080/${testSlug}`,
          ip: "203.0.113.1",
          userAgent: "Mozilla/5.0 (compatible; TestBot/1.0)",
          type: "webmention",
        })
      ).resolves.toBeUndefined();

      const em = getEm();
      const mentions = await em.find(Mention, { targetSlug: testSlug });
      expect(mentions.length).toBe(1);
      expect(mentions[0].authorName).toBe("Alice Commenter");
      expect(mentions[0].platform).toBe("webmention");
      expect(mentions[0].spamStatus).toBe("pending");
      expect(mentions[0].content).toContain("Great post");
    });

    it("updates an existing mention on duplicate webmention", async () => {
      globalThis.fetch = (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.startsWith("https://source.example.com/")) {
          return new Response(
            `<html><body><div class="h-entry">
              <p class="p-name">Alice Commenter (updated)</p>
              <div class="e-content"><p>Updated comment text.</p></div>
              <a href="http://localhost:8080/${testSlug}" class="u-url">permalink</a>
              <time class="dt-published" datetime="2026-07-21T12:00:00Z">Jul 21</time>
            </div></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      };

      // Process the same source URL again — should update rather than create
      await expect(
        processInboundMention(dbTestConfig, {
          source: "https://source.example.com/reply-to-test",
          target: `http://localhost:8080/${testSlug}`,
          ip: "203.0.113.1",
          userAgent: "Mozilla/5.0 (compatible; TestBot/1.0)",
          type: "webmention",
        })
      ).resolves.toBeUndefined();

      const em = getEm();
      const mentions = await em.find(Mention, { targetSlug: testSlug });
      // Still only one mention (updated, not duplicated)
      expect(mentions.length).toBe(1);
      expect(mentions[0].authorName).toBe("Alice Commenter (updated)");
      expect(mentions[0].content).toContain("Updated comment text");
    });

    it("silently drops mentions when the source is unreachable", async () => {
      // Let fetch throw (simulate network error)
      globalThis.fetch = () => {
        throw new Error("Network error");
      };

      await expect(
        processInboundMention(dbTestConfig, {
          source: "https://unreachable.example.com/article",
          target: `http://localhost:8080/${testSlug}`,
          ip: "198.51.100.1",
          userAgent: "test-agent",
          type: "webmention",
        })
      ).resolves.toBeUndefined();

      // No new mention created
      const em = getEm();
      const mentions = await em.find(Mention, { targetSlug: testSlug });
      expect(mentions.length).toBe(1); // Still just the one from earlier
    });

    it("silently drops mentions for non-matching canonical base", async () => {
      await expect(
        processInboundMention(dbTestConfig, {
          source: "https://example.com/article",
          target: "https://other-site.com/unrelated",
          ip: "198.51.100.2",
          userAgent: "test-agent",
          type: "webmention",
        })
      ).resolves.toBeUndefined();
    });

    it("handles trackback payload with excerpt", async () => {
      const trackbackSlug = "trackback-test-post";
      await insertDoc({
        slug: trackbackSlug,
        title: "Trackback Test Post",
        rawMdx: "# Trackback\n\nTest.",
        metaJson: JSON.stringify({}),
      });

      globalThis.fetch = (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.startsWith("https://trackback.example.com/")) {
          // Must include target link for verifyLinkInHtml to pass
          return new Response(
            `<html><body>Some content here <a href="http://localhost:8080/${trackbackSlug}">post</a></body></html>`,
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            }
          );
        }
        return new Response("Not Found", { status: 404 });
      };

      await expect(
        processInboundMention(dbTestConfig, {
          source: "https://trackback.example.com/article",
          target: `http://localhost:8080/${trackbackSlug}`,
          ip: "203.0.113.5",
          userAgent: "trackback-client",
          type: "trackback",
          excerpt: "This is a trackback excerpt with interesting content",
          blogName: "Remote Blog",
        })
      ).resolves.toBeUndefined();

      const em = getEm();
      const mentions = await em.find(Mention, { targetSlug: trackbackSlug });
      expect(mentions.length).toBe(1);
      // Trackback uses excerpt as content when available
      expect(mentions[0].content).toContain("trackback excerpt");
      expect(mentions[0].platform).toBe("trackback");
    });
  });

  // ── Job queue lifecycle ──

  describe("Job queue lifecycle", () => {
    beforeAll(async () => {
      await initOrm(":memory:");
      await initJobsTable();
    });

    it("enqueues an inbound mention without throwing", async () => {
      const id = await enqueueInboundMention({
        source: "https://remote.example/article",
        target: "http://localhost:8080/some-post",
        ip: "1.2.3.4",
        userAgent: "Mastodon/4.0",
        type: "webmention",
      });
      expect(id).toBeTruthy();
      const jobs = await listJobs({ type: "inbound-mentions", limit: 10 });
      expect(jobs.some((j) => j.id === id)).toBe(true);
    });

    it("enqueues outbound syndication without throwing", async () => {
      const id = await enqueueOutboundSyndication(
        1,
        "test-post",
        "Hello world"
      );
      expect(id).toBeTruthy();
      const jobs = await listJobs({ type: "outbound-syndication", limit: 10 });
      expect(jobs.some((j) => j.id === id)).toBe(true);
    });
  });

  // ── ActivityPub inbox with database (Create activity) ──

  describe("ActivityPub inbox with database", () => {
    const createSlug = "activitypub-create-test";

    // Generate test keypair for signing requests
    const actorKeyId = (actor: string) => `${actor}#main-key`;
    const actorKeys = new Map<string, { private: string; public: string }>();

    function getOrCreateKeys(actorUrl: string) {
      if (!actorKeys.has(actorUrl)) {
        const { privateKey } = crypto.generateKeyPairSync("rsa", {
          modulusLength: 2048,
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
        actorKeys.set(actorUrl, {
          private: privateKey,
          public: crypto
            .createPublicKey(privateKey)
            .export({ type: "spki", format: "pem" }),
        });
      }
      return actorKeys.get(actorUrl)!;
    }

    function signedHeaders(
      actorUrl: string,
      method: string,
      url: string,
      body?: string
    ): Record<string, string> {
      const keys = getOrCreateKeys(actorUrl);
      const date = new Date().toUTCString();
      const signingString = [
        `(request-target): ${method.toLowerCase()} ${url}`,
        `host: ${new URL(actorUrl).host}`,
        `date: ${date}`,
      ].join("\n");
      const signer = crypto.createSign("sha256");
      signer.update(signingString);
      signer.end();
      const signature = signer.sign(keys.private, "base64");
      return {
        signature: `keyId="${actorKeyId(actorUrl)}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`,
        date,
        host: new URL(actorUrl).host,
        "content-type": "application/json",
        accept: "application/activity+json",
      };
    }

    function mockFetchWithKey(
      actorUrl: string,
      overrides?: Record<string, unknown>
    ) {
      const keys = getOrCreateKeys(actorUrl);
      return (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr === actorUrl) {
          return new Response(
            JSON.stringify({
              id: actorUrl,
              name: "Test Actor",
              preferredUsername: "test",
              ...overrides,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/activity+json" },
            }
          );
        }
        if (urlStr === actorKeyId(actorUrl)) {
          return new Response(
            JSON.stringify({
              id: actorKeyId(actorUrl),
              publicKey: { publicKeyPem: keys.public },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/activity+json" },
            }
          );
        }
        return new Response("Not Found", { status: 404 });
      };
    }

    let originalFetch: typeof globalThis.fetch;

    beforeAll(async () => {
      await initOrm(":memory:");
      await insertDoc({
        slug: createSlug,
        title: "ActivityPub Create Test",
        rawMdx: "# Create Test",
        metaJson: JSON.stringify({}),
      });
      originalFetch = globalThis.fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await closeOrm();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("POST /inbox with Create activity stores a reply mention", async () => {
      const ACTOR = "https://remote-actor.example/users/bob";
      globalThis.fetch = mockFetchWithKey(ACTOR, {
        name: "Bob Remote",
        preferredUsername: "bob",
        icon: { url: "https://remote-actor.example/avatar.jpg" },
        url: "https://remote-actor.example/@bob",
        inbox: "https://remote-actor.example/users/bob/inbox",
      });

      const fastify = Fastify();
      registerActivityPubRoutes(fastify, dbTestConfig);

      const reqBody = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: ACTOR,
        object: {
          id: "https://remote-actor.example/posts/123",
          type: "Note",
          content: "<p>Great post! Really enjoyed reading it.</p>",
          inReplyTo: `http://localhost:8080/${createSlug}`,
          attributedTo: ACTOR,
          published: "2026-07-21T10:00:00Z",
          url: "https://remote-actor.example/@bob/123",
        },
      });
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: reqBody,
        headers: signedHeaders(ACTOR, "POST", "/inbox", reqBody),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: "accepted" });

      const em = getEm();
      const mentions = await em.find(Mention, { targetSlug: createSlug });
      expect(mentions.length).toBe(1);
      expect(mentions[0].authorName).toBe("Bob Remote");
      expect(mentions[0].platform).toBe("activitypub");
      expect(mentions[0].content).toContain("Great post");
      expect(mentions[0].spamStatus).toBe("ham");
      await fastify.close();
    });

    it("POST /inbox with Create activity ignores non-matching inReplyTo", async () => {
      const ACTOR = "https://other-actor.example/users/carol";
      globalThis.fetch = mockFetchWithKey(ACTOR, {
        name: "Carol",
        preferredUsername: "carol",
      });

      const fastify = Fastify();
      registerActivityPubRoutes(fastify, dbTestConfig);

      const reqBody = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: ACTOR,
        object: {
          id: "https://other-actor.example/posts/456",
          type: "Note",
          content: "<p>Random reply</p>",
          inReplyTo: "https://unrelated.example.com/post",
          attributedTo: ACTOR,
        },
      });
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: reqBody,
        headers: signedHeaders(ACTOR, "POST", "/inbox", reqBody),
      });

      expect(res.statusCode).toBe(200);
      await fastify.close();
    });

    it("POST /inbox handles Create activity without object content", async () => {
      const ACTOR = "https://remote.example/users/dave";
      globalThis.fetch = mockFetchWithKey(ACTOR);

      const fastify = Fastify();
      registerActivityPubRoutes(fastify, dbTestConfig);

      const reqBody = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: ACTOR,
        object: "https://remote.example/posts/789",
      });
      const res = await fastify.inject({
        method: "POST",
        url: "/inbox",
        body: reqBody,
        headers: signedHeaders(ACTOR, "POST", "/inbox", reqBody),
      });

      expect(res.statusCode).toBe(200);
      await fastify.close();
    });
  });

  // ── Email task early returns ──

  describe("Email task early returns", () => {
    beforeAll(async () => {
      await initOrm(":memory:");
    });

    afterAll(async () => {
      await closeOrm();
    });

    it("processNewSubscription returns early when email not configured", async () => {
      await expect(
        processNewSubscription(testConfig, {
          email: "test@example.com",
          frequency: "instant",
        })
      ).resolves.toBeUndefined();
    });

    it("sendInstantNotification returns early when email not enabled", async () => {
      const sub = {
        id: crypto.randomUUID(),
        email: "test@example.com",
        unsubscribeToken: "abc123",
      };
      await expect(
        sendInstantNotification(
          {
            ...testConfig,
            email: (dbTestConfig.email ?? {
              smtp: { host: "", port: 0, user: "", pass: "" },
              from: "",
            }) as EmailConfig,
            enabled: false,
          },
          sub,
          { slug: "test-post", title: "Test" }
        )
      ).resolves.toBeUndefined();
    });

    it("sendWeeklyDigest returns early when email not enabled", async () => {
      const sub = {
        id: crypto.randomUUID(),
        email: "test@example.com",
        unsubscribeToken: "abc123",
      };
      await expect(
        sendWeeklyDigest(
          {
            ...testConfig,
            email: (dbTestConfig.email ?? {
              smtp: { host: "", port: 0, user: "", pass: "" },
              from: "",
            }) as EmailConfig,
            enabled: false,
          },
          sub,
          [{ slug: "test", title: "Test Post" }]
        )
      ).resolves.toBeUndefined();
    });

    it("processContactForm returns early when contact form not enabled", async () => {
      await expect(
        processContactForm(testConfig, {
          name: "Tester",
          email: "tester@example.com",
          message: "Hello",
          ip: "1.2.3.4",
          userAgent: "test",
        })
      ).resolves.toBeUndefined();
    });

    it("sendTestEmail throws when email not configured", async () => {
      await expect(
        sendTestEmail(testConfig, "test@example.com")
      ).rejects.toThrow("Email not configured");
    });
  });

  // ── POSSE reply fetching early returns ──

  describe("POSSE reply fetching", () => {
    it("fetchMastodonReplies returns early when mastodon not configured", async () => {
      await expect(
        fetchMastodonReplies(
          testConfig,
          "test-post",
          "https://mastodon.social/@user/12345"
        )
      ).resolves.toBeUndefined();
    });

    it("fetchBlueskyReplies handles network errors gracefully", async () => {
      // Without mocking fetch, this will attempt to reach bsky.social
      // and fail with a network error, which is caught internally.
      await expect(
        fetchBlueskyReplies(
          testConfig,
          "test-post",
          "at://did:plc:test/app.bsky.feed.post/1"
        )
      ).resolves.toBeUndefined();
    });
  });
});
