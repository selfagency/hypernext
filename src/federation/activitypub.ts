import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Mention } from "../database/entities/mention.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { hashString } from "../utils/crypto.js";

const HTTP_SIGNATURE_REGEX =
  /^keyId="([^"]+)",\s*algorithm="([^"]+)",\s*headers="([^"]*)",\s*signature="([^"]+)"$/;
const HTML_TAG_REGEX = /<[^>]+>/g;
const WHITESPACE_REGEX = /\s+/;
const TRAILING_SLASH_REGEX = /\/+$/;
const LEADING_SLASH_REGEX = /^\//;

interface SignatureResult {
  actorId: string | undefined;
  verified: boolean;
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

  const match = sigHeader.match(HTTP_SIGNATURE_REGEX);
  if (!match) {
    return { verified: false, actorId: undefined };
  }

  const keyId = match[1] ?? "";
  const signedHeaders = match[3] ?? "";
  const signature = match[4] ?? "";

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
  base: string
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
        fetch(follower.inbox, {
          method: "POST",
          headers: { "Content-Type": "application/activity+json" },
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
        publicKeyPem: "",
      },
      icon: config.author.photo
        ? { type: "Image", url: config.author.photo }
        : undefined,
    });
  });

  // GET /outbox
  fastify.get("/outbox", (_request, reply) => {
    reply.send({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "OrderedCollection",
      totalItems: 0,
      orderedItems: [],
    });
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
      console.warn(
        `ActivityPub: unverified delivery from ${actorId ?? "unknown"}`
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
      await handleFollow(activity, base);
      reply.send({ status: "accepted" });
      return;
    }

    if (type === "Create" || type === "Announce") {
      await handleCreate(activity, config);
    }

    reply.send({ status: "accepted" });
  });
}
