import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerApiAuthGuard } from "../../src/api/auth.js";
import { registerModerationRoutes } from "../../src/api/moderation.js";
import { registerApiRoutes } from "../../src/api/routes.js";
import { registerIndieAuthRoutes } from "../../src/auth/indieauth.js";
import { closeOrm, initOrm } from "../../src/database/index.js";
import { registerInboundRoutes } from "../../src/federation/inbound.js";
import { registerFederationRoutes } from "../../src/federation/index.js";
import {
  initWorkmatic,
  stopWorkmatic,
} from "../../src/federation/workmatic.js";
import { registerMicropubEndpoint } from "../../src/micropub/index.js";
import { startFingerServer } from "../../src/servers/finger.js";
import { startGeminiServer } from "../../src/servers/gemini.js";
import { startGopherServer } from "../../src/servers/gopher.js";
import { createHttpServer } from "../../src/servers/http.js";
import { startNexServer } from "../../src/servers/nex.js";
import { startSpartanServer } from "../../src/servers/spartan.js";
import { startTextServer } from "../../src/servers/text.js";
import type { HypernextConfig } from "../../src/types/config.js";

export interface E2eState {
  apiKey: string;
  config: HypernextConfig;
  fastify: ReturnType<typeof createHttpServer>;
  fingerPort: number;
  geminiPort: number;
  gopherPort: number;
  httpPort: number;
  mockAkismetPort: number;
  mockBlueskyPort: number;
  mockMastodonPort: number;
  mockSourcePort: number;
  nexPort: number;
  spartanPort: number;
  textPort: number;
  tmpDir: string;
}

export let e2e: E2eState;
let initialized = false;

function generateSelfSignedCert(certDir: string): {
  certPath: string;
  keyPath: string;
} {
  const certPath = path.join(certDir, "cert.pem");
  const keyPath = path.join(certDir, "key.pem");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj "/CN=localhost"`,
    { stdio: "ignore" }
  );
  return { certPath, keyPath };
}

function writeFixture(dir: string, slug: string, content: string): void {
  const filePath = path.join(dir, `${slug}.mdx`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function getServerPort(server: {
  address(): { port: number } | string | null;
}): number {
  const address = server.address();
  if (address && typeof address === "object") {
    return address.port;
  }
  throw new Error("Server did not bind to a port");
}

export async function setupE2e(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hypernext-e2e-"));
  const contentDir = path.join(tmpDir, "content");
  const certDir = path.join(tmpDir, "certs");
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(certDir, { recursive: true });

  const { certPath, keyPath } = generateSelfSignedCert(certDir);

  // Write fixture MDX files
  writeFixture(
    contentDir,
    "blog/welcome",
    `---
title: Welcome to Hypernext
date: 2026-07-16
type: post
tags: [hypernext]
---

Welcome to Hypernext!

This is a multi-protocol document server.
`
  );

  writeFixture(
    contentDir,
    "blog/with-comments",
    `---
title: Post with Comments
date: 2026-07-16
type: post
tags: [hypernext]
---

This post has comments enabled.

<Comments />
`
  );

  writeFixture(
    contentDir,
    "blog/private",
    `---
title: Private Post
date: 2026-07-16
type: post
visibility: private
---

This is a private post.
`
  );

  writeFixture(
    contentDir,
    "blog/no-webmentions",
    `---
title: No Webmentions
date: 2026-07-16
type: post
comments:
  inbound:
    webmention: false
---

This post blocks webmentions.
`
  );

  // Start mock external services
  const mockMastodon = Fastify();
  mockMastodon.get("/api/v1/statuses/:id/context", (_req, reply) => {
    reply.send({
      descendants: [
        {
          id: "e2e-mastodon-reply-1",
          content: "<p>Great post from Mastodon!</p>",
          account: {
            acct: "e2e-tester@mastodon.example.com",
            display_name: "E2E Tester",
            url: "https://mastodon.example.com/@e2e-tester",
            avatar: "https://mastodon.example.com/avatar.jpg",
          },
          created_at: "2026-07-16T12:00:00.000Z",
          url: "https://mastodon.example.com/@e2e-tester/12345",
        },
      ],
    });
  });
  await mockMastodon.listen({ port: 0, host: "0.0.0.0" });
  const mockMastodonPort = (mockMastodon.addresses()[0] as { port: number })
    .port;

  const mockBluesky = Fastify();
  mockBluesky.get("/xrpc/app.bsky.feed.getPostThread", (_req, reply) => {
    reply.send({
      thread: {
        replies: [
          {
            post: {
              uri: "at://did:plc:e2e/app.bsky.feed.post/abc123",
              author: {
                handle: "e2e.bsky.social",
                displayName: "E2E Bluesky User",
                avatar: "https://cdn.bsky.app/avatar.jpg",
              },
              record: { text: "Great post from Bluesky!" },
              indexedAt: "2026-07-16T12:00:00.000Z",
            },
          },
        ],
      },
    });
  });
  await mockBluesky.listen({ port: 0, host: "0.0.0.0" });
  const mockBlueskyPort = (mockBluesky.addresses()[0] as { port: number }).port;

  const mockAkismet = Fastify();
  mockAkismet.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      done(null, result);
    }
  );
  mockAkismet.post("/1.1/comment-check", (req, reply) => {
    const body = req.body as
      | { comment_author?: string; comment_content?: string }
      | undefined;
    const isSpam =
      body?.comment_author?.toLowerCase().includes("spam") ||
      body?.comment_content?.toLowerCase().includes("spam");
    reply.type("text/plain").send(isSpam ? "true" : "false");
  });
  await mockAkismet.listen({ port: 0, host: "0.0.0.0" });
  const mockAkismetPort = (mockAkismet.addresses()[0] as { port: number }).port;

  // Mock source server for webmention/pingback source HTML
  const mockSource = Fastify();
  mockSource.get("/ham", (req, reply) => {
    const target =
      (req.query as { target?: string }).target ??
      "http://localhost:0/blog/with-comments";
    reply.type("text/html").send(
      `<html><body>
        <div class="h-entry">
          <a class="u-url" href="${target}">Target</a>
          <div class="e-content"><p>Great post!</p></div>
          <span class="p-name">Friendly Reader</span>
        </div>
      </body></html>`
    );
  });
  mockSource.get("/spam", (req, reply) => {
    const target =
      (req.query as { target?: string }).target ??
      "http://localhost:0/blog/with-comments";
    reply.type("text/html").send(
      `<html><body>
        <div class="h-entry">
          <a class="u-url" href="${target}">Target</a>
          <div class="e-content"><p>Buy spam products now!</p></div>
          <span class="p-name">Spammer</span>
        </div>
      </body></html>`
    );
  });
  await mockSource.listen({ port: 0, host: "0.0.0.0" });
  const mockSourcePort = (mockSource.addresses()[0] as { port: number }).port;

  const config: HypernextConfig = {
    site: {
      canonicalBase: "http://localhost:0",
      meta: { title: "E2E Test", description: "E2E Test Site", lang: "en" },
      pdf: { enabled: false },
      ebooks: { enabled: false },
    },
    author: { name: "E2E Author", bio: "Testing" },
    storage: { type: "local", local: { path: contentDir } },
    database: { type: "sqlite", path: path.join(tmpDir, "hypernext.db") },
    api: { enabled: true },
    collections: {
      blog: { path: "/blog/", syndicate: true, rss: true, layout: "blog.mdx" },
    },
    taxonomies: [{ name: "tags", plural: "tags", singular: "tag" }],
    protocols: {
      http: { enabled: true, port: 0 },
      gemini: { enabled: true, port: 0, certPath, keyPath },
      gopher: { enabled: true, port: 0 },
      spartan: { enabled: true, port: 0 },
      nex: { enabled: true, port: 0 },
      finger: { enabled: true, port: 0 },
      text: { enabled: true, port: 0 },
    },
    micropub: { enabled: true },
    syndication: {
      mastodon: {
        enabled: true,
        instance: `http://localhost:${mockMastodonPort}`,
        accessToken: "e2e-mastodon-token",
      },
      bluesky: {
        enabled: true,
        service: `http://localhost:${mockBlueskyPort}`,
        identifier: "e2e.bsky.social",
        accessToken: "e2e-bsky-token",
      },
    },
    mcp: { enabled: false, transport: "stdio" },
    comments: {
      enabled: true,
      inbound: { webmention: true, pingback: true, trackback: false },
      aggregation: { mastodon: true, bluesky: true, cacheTtl: 0 },
      akismet: {
        enabled: true,
        apiKey: "e2e-akismet-key",
        endpoint: `http://localhost:${mockAkismetPort}/1.1/comment-check`,
      },
      allowPrivateSources: true,
    },
  };

  // Initialize ORM and workmatic
  await initOrm(config.database.path);
  initWorkmatic(config);

  // Index fixtures
  const { reindexAll } = await import("../../src/indexer/index.js");
  await reindexAll(config);

  // Start HTTP server
  const fastify = await createHttpServer(config);
  registerIndieAuthRoutes(fastify, config);
  registerApiAuthGuard(fastify);
  registerApiRoutes(fastify, config);
  registerModerationRoutes(fastify);
  registerFederationRoutes(fastify, config);
  registerInboundRoutes(fastify, config);
  registerMicropubEndpoint(fastify, config);
  await fastify.listen({ port: 0, host: "0.0.0.0" });
  const httpPort = (fastify.addresses()[0] as { port: number }).port;

  // Update canonicalBase to actual port
  config.site.canonicalBase = `http://localhost:${httpPort}`;

  // Generate a JWT for API auth
  const apiKey = await fastify.jwt.sign(
    { sub: config.site.canonicalBase, scope: "admin" },
    { expiresIn: "24h" }
  );

  // Start smolnet servers on OS-assigned ports
  const geminiServer = startGeminiServer(config);
  const gopherServer = startGopherServer(config);
  const spartanServer = startSpartanServer(config);
  const nexServer = startNexServer(config);
  const textServer = startTextServer(config);
  const fingerServer = startFingerServer(config);

  const geminiPort = getServerPort(geminiServer);
  const gopherPort = getServerPort(gopherServer);
  const spartanPort = getServerPort(spartanServer);
  const nexPort = getServerPort(nexServer);
  const textPort = getServerPort(textServer);
  const fingerPort = getServerPort(fingerServer);

  e2e = {
    httpPort,
    geminiPort,
    gopherPort,
    spartanPort,
    nexPort,
    textPort,
    fingerPort,
    mockMastodonPort,
    mockBlueskyPort,
    mockAkismetPort,
    mockSourcePort,
    tmpDir,
    apiKey,
    config,
    fastify,
  };

  initialized = true;
}

export async function teardownE2e(): Promise<void> {
  if (e2e) {
    await e2e.fastify.close();
    await stopWorkmatic();
    await closeOrm();
    fs.rmSync(e2e.tmpDir, { recursive: true, force: true });
  }
}
