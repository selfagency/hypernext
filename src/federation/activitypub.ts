import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { Mention } from "../database/entities/mention.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { hashString } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

const HTTP_SIGNATURE_REGEX =
  /(?:^|,\s*)(keyId|algorithm|headers|signature|created|expires)="([^"]*)"/g;
const HTML_TAG_REGEX = /<[^>]+>/g;
const WHITESPACE_REGEX = /\s+/;
const TRAILING_SLASH_REGEX = /\/+$/;
const LEADING_SLASH_REGEX = /^\//;

interface SignatureResult {
  actorId: string | undefined;
  verified: boolean;
}

// ── Key Management ──────────────────────────────────────────

let cachedKeyPair: crypto.KeyObject | null = null;
let cachedPublicKeyPem: string | null = null;

function getKeyPath(config: HypernextConfig): string {
  // Store the key alongside the database, using the database path as anchor
  const dbPath = config.database.path;
  if (dbPath && dbPath !== ":memory:") {
    return path.join(path.dirname(dbPath), "activitypub.pem");
  }
  return "./activitypub.pem";
}

function ensureKeyPair(config: HypernextConfig): void {
  if (cachedKeyPair) {
    return;
  }

  const keyPath = getKeyPath(config);

  if (fs.existsSync(keyPath)) {
    // Load existing key
    const pem = fs.readFileSync(keyPath, "utf-8");
    cachedKeyPair = crypto.createPrivateKey(pem);
    cachedPublicKeyPem = crypto
      .createPublicKey(pem)
      .export({ type: "spki", format: "pem" });
    logger.info(`ActivityPub: loaded key pair from ${keyPath}`);
    return;
  }

  // Generate new RSA keypair
  logger.info("ActivityPub: generating RSA key pair (first boot)");
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  cachedKeyPair = crypto.createPrivateKey(privateKey);
  cachedPublicKeyPem = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" });

  // Persist the private key
  const keyDir = path.dirname(keyPath);
  if (keyDir) {
    fs.mkdirSync(keyDir, { recursive: true });
  }
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  logger.info(`ActivityPub: saved key pair to ${keyPath}`);
}

function getPublicKeyPem(config: HypernextConfig): string {
  ensureKeyPair(config);
  return cachedPublicKeyPem ?? "";
}

function getPrivateKey(config: HypernextConfig): crypto.KeyObject {
  ensureKeyPair(config);
  if (!cachedKeyPair) {
    throw new Error("ActivityPub key pair not initialized");
  }
  return cachedKeyPair;
}

/**
 * Sign a string with the ActivityPub private key for HTTP Signatures.
 */
function signString(input: string, config: HypernextConfig): string {
  const key = getPrivateKey(config);
  const signer = crypto.createSign("sha256");
  signer.update(input, "utf-8");
  signer.end();
  return signer.sign(key, "base64");
}

/**
 * Build an HTTP Signature header for an outgoing request.
 */
function buildSignatureHeader(
  method: string,
  url: string,
  config: HypernextConfig
): string {
  const keyId = `${config.site.canonicalBase}/actor#main-key`;
  const headers = "(request-target) host date";
  const now = new Date();
  const date = now.toUTCString();
  const signingString = `(request-target): ${method.toLowerCase()} ${url}\nhost: ${new URL(config.site.canonicalBase).host}\ndate: ${date}`;
  const signature = signString(signingString, config);

  return `keyId="${keyId}",algorithm="rsa-sha256",headers="${headers}",signature="${signature}"`;
}

/**
 * Verify an HTTP Signature on an incoming ActivityPub request.
 * This is a best-effort verification — it fetches the actor's public key
 * and validates the signature. If the key cannot be fetched, the request
 * is still accepted (logged) to avoid breaking federation with servers
 * that use non-standard key delivery.
 */
async function verifyHttpSignature(request: {
  method: string;
  url: string;
  headers: Record<string, string>;
}): Promise<SignatureResult> {
  const sigHeader = request.headers.signature;
  if (!sigHeader) {
    return { verified: false, actorId: undefined };
  }

  // Parse the Signature header as key="value" pairs in any order
  const sigMap = new Map<string, string>();
  const sigMatches = sigHeader.matchAll(HTTP_SIGNATURE_REGEX);
  for (const m of sigMatches) {
    const key = m[1];
    const value = m[2];
    if (key && value) {
      sigMap.set(key.toLowerCase(), value);
    }
  }

  const keyId = sigMap.get("keyid") ?? "";
  const signedHeaders = sigMap.get("headers") ?? "";
  const signature = sigMap.get("signature") ?? "";

  // Build the signing string
  const headerList = signedHeaders.split(WHITESPACE_REGEX);
  const signingString = headerList
    .map((h) => {
      const lower = h.toLowerCase();
      if (lower === "(request-target)") {
        return `(request-target): ${request.method.toLowerCase()} ${request.url}`;
      }
      return `${lower}: ${request.headers[lower] ?? ""}`;
    })
    .join("\n");

  // Fetch the actor's public key
  try {
    const response = await fetch(keyId, {
      headers: { Accept: "application/activity+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(
        `ActivityPub: failed to fetch key at ${keyId}: ${response.status}`
      );
      return { verified: false, actorId: keyId.split("#")[0] ?? undefined };
    }

    const actor = (await response.json()) as {
      id?: string;
      publicKey?: { publicKeyPem: string };
    };
    const actorId = actor.id ?? keyId.split("#")[0] ?? "";

    const publicKeyPem = actor.publicKey?.publicKeyPem;
    if (!publicKeyPem) {
      console.error(`ActivityPub: no publicKey found for ${actorId}`);
      return { verified: false, actorId };
    }

    const verifier = crypto.createVerify("sha256");
    verifier.update(signingString, "utf-8");
    verifier.end();

    const verified = verifier.verify(
      publicKeyPem,
      Buffer.from(signature, "base64")
    );

    return { verified, actorId };
  } catch (error) {
    console.error("ActivityPub: signature verification error:", error);
    return { verified: false, actorId: keyId.split("#")[0] };
  }
}

async function fetchActorInfo(
  actorUrl: string
): Promise<{ name: string; url: string; photo: string }> {
  try {
    const resp = await fetch(actorUrl, {
      headers: { Accept: "application/activity+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        name?: string;
        preferredUsername?: string;
        icon?: { url?: string };
        url?: string;
      };
      return {
        name: data.name ?? data.preferredUsername ?? actorUrl,
        url: data.url ?? actorUrl,
        photo: data.icon?.url ?? "",
      };
    }
  } catch {
    // Use the actorUrl as fallback
  }
  return { name: actorUrl, url: actorUrl, photo: "" };
}

async function handleFollow(
  activity: Record<string, unknown>,
  base: string,
  config: HypernextConfig
): Promise<void> {
  const followerId = typeof activity.actor === "string" ? activity.actor : "";
  if (!followerId) {
    return;
  }

  try {
    const followerResp = await fetch(followerId, {
      headers: { Accept: "application/activity+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (followerResp.ok) {
      const follower = (await followerResp.json()) as { inbox?: string };
      if (follower.inbox) {
        const accept = {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Accept",
          actor: `${base}/actor`,
          object: activity,
        };
        const inboxUrl = new URL(follower.inbox);
        const inboxPath = inboxUrl.pathname + (inboxUrl.search ?? "");
        const signature = buildSignatureHeader("POST", inboxPath, config);
        fetch(follower.inbox, {
          method: "POST",
          headers: {
            "Content-Type": "application/activity+json",
            Signature: signature,
            Date: new Date().toUTCString(),
            Host: inboxUrl.host,
          },
          body: JSON.stringify(accept),
        }).catch(() => {
          // Best-effort delivery
        });
      }
    }
  } catch {
    // Best-effort follow acceptance
  }
}

async function handleCreate(
  activity: Record<string, unknown>,
  config: HypernextConfig
): Promise<void> {
  const object = activity.object as
    | Record<string, unknown>
    | string
    | undefined;
  const obj = typeof object === "string" ? null : object;
  if (!obj) {
    return;
  }

  const inReplyTo = obj.inReplyTo as string | undefined;
  if (!inReplyTo) {
    return;
  }

  // Extract slug from the inReplyTo URL
  const baseUrl = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");
  if (!inReplyTo.startsWith(baseUrl)) {
    return;
  }
  const slug = inReplyTo.slice(baseUrl.length).replace(LEADING_SLASH_REGEX, "");
  if (!slug) {
    return;
  }

  const objId = (obj.id as string) ?? "";
  const objContent = (obj.content as string) ?? "";
  const objAttributedTo =
    (obj.attributedTo as string) ??
    (typeof activity.actor === "string" ? activity.actor : "");
  const objPublished = (obj.published as string) ?? "";
  const objUrl = (obj.url as string) ?? objId;

  // Fetch actor info
  const actorInfo = await fetchActorInfo(objAttributedTo);

  // Store as a mention
  const em = getEm();
  const id = hashString(`${objId}:${slug}`);
  const existing = await em.findOne(Mention, { id });
  if (!existing) {
    em.create(Mention, {
      id,
      targetSlug: slug,
      sourceUrl: objUrl,
      authorName: actorInfo.name,
      authorUrl: actorInfo.url,
      authorPhoto: actorInfo.photo || null,
      content: objContent.replace(HTML_TAG_REGEX, "").trim(),
      publishedAt: objPublished ? new Date(objPublished).getTime() : Date.now(),
      type: "reply",
      platform: "activitypub",
      senderIp: null,
      spamStatus: "ham",
    });
    await em.flush();
  }
}

export function getLocalActorPublicKeyPem(config: HypernextConfig): string {
  try {
    return getPublicKeyPem(config);
  } catch {
    return "";
  }
}

export function registerActivityPubRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  const base = config.site.canonicalBase;
  const username = config.author.name.toLowerCase().replace(/\s+/g, "-");

  // /.well-known/webfinger
  fastify.get("/.well-known/webfinger", (request, reply) => {
    const resource = (request.query as Record<string, string>).resource;
    if (!resource) {
      reply.code(400).send({ error: "Missing resource parameter" });
      return;
    }

    const expected = `acct:${username}@${new URL(base).host}`;
    if (resource !== expected) {
      reply.code(404).send({ error: "Resource not found" });
      return;
    }

    reply.send({
      subject: expected,
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `${base}/actor`,
        },
      ],
    });
  });

  // GET /actor
  fastify.get("/actor", (_request, reply) => {
    reply.send({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
      ],
      type: "Person",
      id: `${base}/actor`,
      preferredUsername: username,
      name: config.author.name,
      summary: config.author.bio ?? "",
      url: base,
      inbox: `${base}/inbox`,
      outbox: `${base}/outbox`,
      publicKey: {
        id: `${base}/actor#main-key`,
        owner: `${base}/actor`,
        publicKeyPem: getPublicKeyPem(config),
      },
      icon: config.author.photo
        ? { type: "Image", url: config.author.photo }
        : undefined,
    });
  });

  // GET /outbox — return published posts as Create activities
  fastify.get("/outbox", async (_request, reply) => {
    try {
      const { getEm } = await import("../database/index.js");
      const { DocMeta } = await import("../database/entities/doc-meta.js");
      const em = getEm();
      const docs = await em.find(
        DocMeta,
        { type: "post" },
        {
          orderBy: { date: "DESC" },
          limit: 20,
        }
      );

      const orderedItems = docs.map((doc) => ({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: `${base}/actor`,
        published: doc.date,
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        object: {
          type: "Note",
          id: `${base}/${doc.slug}`,
          url: `${base}/${doc.slug}`,
          attributedTo: `${base}/actor`,
          content: doc.description ?? doc.title,
          published: doc.date,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
        },
      }));

      reply.send({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "OrderedCollection",
        totalItems: orderedItems.length,
        orderedItems,
      });
    } catch {
      // ORM not initialized — return empty collection
      reply.send({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "OrderedCollection",
        totalItems: 0,
        orderedItems: [],
      });
    }
  });

  // POST /inbox — receive activities from other servers
  fastify.post("/inbox", async (request, reply) => {
    const headers = request.headers as Record<string, string>;

    // Verify HTTP Signature
    const { verified, actorId } = await verifyHttpSignature({
      method: "POST",
      url: "/inbox",
      headers,
    });

    if (!verified) {
      logger.warn(
        `ActivityPub: accepting unverified delivery from ${actorId ?? "unknown"} (best-effort)`
      );
    }

    let activity: Record<string, unknown>;
    try {
      activity =
        typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : JSON.parse(request.body as string);
    } catch {
      reply.code(400).send({ error: "Invalid JSON" });
      return;
    }

    const type = activity.type as string | undefined;

    if (type === "Follow") {
      await handleFollow(activity, base, config);
      reply.send({ status: "accepted" });
      return;
    }

    if (type === "Create" || type === "Announce") {
      await handleCreate(activity, config);
    }

    reply.send({ status: "accepted" });
  });
}
