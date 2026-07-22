import type { FastifyInstance } from "fastify";
import { Mention } from "../database/entities/mention.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { hashString } from "../utils/crypto.js";
import { checkAkismet } from "./akismet.js";
import { resolveCommentConfig } from "./config-resolver.js";
import { validateSourceUrl } from "./ssrf.js";

const FETCH_TIMEOUT_MS = 5000;
const MAX_FETCH_SIZE = 1_048_576; // 1MB
const TRAILING_SLASH_REGEX = /\/+$/;
const LEADING_SLASH_REGEX = /^\//;
const URL_HOST_REGEX = /^https?:\/\/([^/]+)/i;
const P_NAME_REGEX = /class="[^"]*\bp-name\b[^"]*"[^>]*>([^<]+)</i;
const E_CONTENT_REGEX =
  /class="[^"]*\be-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const DT_PUBLISHED_REGEX = /class="[^"]*\bdt-published\b[^"]*"[^>]*>([^<]+)</i;
const U_URL_REGEX = /class="[^"]*\bu-url\b[^"]*"[^>]*href="([^"]+)"/i;
const U_PHOTO_REGEX = /class="[^"]*\bu-photo\b[^"]*"[^>]*src="([^"]+)"/i;
const HTML_TAG_REGEX = /<[^>]+>/g;
const WHITESPACE_REGEX = /\s+/g;
const REGEX_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;
const METHOD_NAME_REGEX = /<methodName>\s*([^<]+?)\s*<\/methodName>/i;
const VALUE_REGEX = /<value>\s*<string>\s*([^<]*?)\s*<\/string>\s*<\/value>/gi;

function extractTargetSlug(
  target: string,
  config: HypernextConfig
): string | null {
  const base = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");
  // Parse both as URLs to prevent prefix-collision attacks
  // e.g., http://localhost:8080.evil.com/blog/post should NOT match
  try {
    const targetUrl = new URL(target);
    const baseUrl = new URL(base);
    if (
      targetUrl.protocol !== baseUrl.protocol ||
      targetUrl.hostname !== baseUrl.hostname ||
      targetUrl.port !== baseUrl.port
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const path = target.slice(base.length).replace(LEADING_SLASH_REGEX, "");
  return path || null;
}

function extractMf2Data(html: string): {
  authorName: string;
  authorUrl: string;
  authorPhoto: string;
  content: string;
  publishedAt: number;
} {
  // Basic mf2 extraction: look for h-entry elements
  const result = {
    authorName: "",
    authorUrl: "",
    authorPhoto: "",
    content: "",
    publishedAt: Date.now(),
  };

  // Try to extract p-name (author name) — look for p-name class directly
  const nameMatch = html.match(P_NAME_REGEX);
  if (nameMatch) {
    result.authorName = nameMatch[1]?.trim() ?? "";
  }

  // Try to extract e-content
  const contentMatch = html.match(E_CONTENT_REGEX);
  if (contentMatch) {
    result.content = (contentMatch[1] ?? "")
      .replace(HTML_TAG_REGEX, "")
      .replace(WHITESPACE_REGEX, " ")
      .trim()
      .slice(0, 500);
  }

  // Try to extract dt-published
  const dateMatch = html.match(DT_PUBLISHED_REGEX);
  if (dateMatch) {
    const parsed = Date.parse((dateMatch[1] ?? "").trim());
    if (!Number.isNaN(parsed)) {
      result.publishedAt = parsed;
    }
  }

  // Try to extract u-url for author URL
  const urlMatch = html.match(U_URL_REGEX);
  if (urlMatch) {
    result.authorUrl = urlMatch[1] ?? "";
  }

  // Try to extract u-photo for author photo
  const photoMatch = html.match(U_PHOTO_REGEX);
  if (photoMatch) {
    result.authorPhoto = photoMatch[1] ?? "";
  }

  return result;
}

async function fetchSourceHtml(source: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(source, {
      signal: controller.signal,
      headers: { "User-Agent": "Hypernext/1.0" },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FETCH_SIZE) {
      return null;
    }

    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    return null;
  }
}

function verifyLinkInHtml(html: string, target: string): boolean {
  const escaped = target.replace(REGEX_ESCAPE_REGEX, "\\$&");
  // Webmention spec §3.2.1: source must contain a link (a, area, link href)
  // to the target. A bare URL in a comment or non-link attribute is not a link.
  const linkRegex = new RegExp(
    `<[aA]\\s[^>]*href=["']${escaped}["']|` +
      `<[aA][rR][eE][aA]\\s[^>]*href=["']${escaped}["']|` +
      `<[lL][iI][nN][kK]\\s[^>]*href=["']${escaped}["']|` +
      `<[iI][mM][gG]\\s[^>]*src=["']${escaped}["']|` +
      `<[vV][iI][dD][eE][oO]\\s[^>]*src=["']${escaped}["']|` +
      `<[aA][uU][dD][iI][oO]\\s[^>]*src=["']${escaped}["']|` +
      `<[bB][lL][oO][cC][kK][qQ][uU][oO][tT][eE]\\s[^>]*cite=["']${escaped}["']`,
    "i"
  );
  return linkRegex.test(html);
}

function isBlocked(
  payload: {
    source: string;
    ip: string;
  },
  authorName: string,
  blocklist: { domains: string[]; handles: string[]; ips: string[] } | undefined
): boolean {
  if (!blocklist) {
    return false;
  }

  const sourceDomain = payload.source.match(URL_HOST_REGEX)?.[1] ?? "";

  if (blocklist.domains?.some((d) => sourceDomain.includes(d))) {
    return true;
  }
  if (blocklist.ips?.includes(payload.ip)) {
    return true;
  }
  if (blocklist.handles?.length) {
    const authorLower = authorName.toLowerCase();
    if (blocklist.handles.some((h) => authorLower.includes(h.toLowerCase()))) {
      return true;
    }
  }

  return false;
}

export async function processInboundMention(
  config: HypernextConfig,
  payload: {
    source: string;
    target: string;
    ip: string;
    userAgent: string;
    type: "webmention" | "pingback" | "trackback";
    excerpt?: string;
    blogName?: string;
    title?: string;
  }
): Promise<void> {
  // 1. Validate target URL resolves to a valid slug
  const slug = extractTargetSlug(payload.target, config);
  if (!slug) {
    return;
  }

  // 2. Check comment config for this slug
  const commentConfig = await resolveCommentConfig(config, slug);
  if (!commentConfig.inbound[payload.type]) {
    return;
  }

  // 3. SSRF protection
  if (
    !(await validateSourceUrl(
      payload.source,
      commentConfig.allowPrivateSources
    ))
  ) {
    return;
  }

  // 4. Fetch source HTML
  const html = await fetchSourceHtml(payload.source);
  if (!html) {
    return;
  }

  // 5. Verify target link appears in source
  if (!verifyLinkInHtml(html, payload.target)) {
    return;
  }

  // 6. Parse mf2 data
  const mf2 = extractMf2Data(html);

  // 7. Build content from trackback fields if available
  const content =
    payload.type === "trackback" && payload.excerpt
      ? payload.excerpt
      : mf2.content || payload.excerpt || "";

  const authorName = mf2.authorName || payload.blogName || "Anonymous";

  // 8. Check blocklist (domain, IP, handle)
  if (isBlocked(payload, authorName, commentConfig.blocklist)) {
    return;
  }

  // 9. Check Akismet
  const spamStatus = await checkAkismet({
    apiKey: commentConfig.akismet.apiKey ?? "",
    endpoint: commentConfig.akismet.endpoint,
    blog: config.site.canonicalBase,
    userIp: payload.ip,
    userAgent: payload.userAgent,
    referrer: payload.source,
    permalink: payload.target,
    commentType: payload.type,
    commentAuthor: authorName,
    commentAuthorUrl: mf2.authorUrl,
    commentContent: content,
  });

  // 10. Store mention
  const em = getEm();
  const id = hashString(`${payload.source}:${slug}`);
  const existing = await em.findOne(Mention, { id });
  if (existing) {
    existing.spamStatus = spamStatus;
    existing.content = content;
    existing.authorName = authorName;
    existing.authorUrl = mf2.authorUrl;
    existing.authorPhoto = mf2.authorPhoto;
    existing.seenAt = Date.now();
    await em.flush();
    return;
  }

  em.create(Mention, {
    id,
    targetSlug: slug,
    sourceUrl: payload.source,
    authorName,
    authorUrl: mf2.authorUrl || null,
    authorPhoto: mf2.authorPhoto || null,
    content,
    publishedAt: mf2.publishedAt,
    type: "reply",
    platform: payload.type,
    senderIp: payload.ip,
    spamStatus,
  });
  await em.flush();
}

// ── Fastify Route Registration ──

export function registerInboundRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  // POST /webmention
  fastify.post<{
    Body: { source?: string; target?: string };
  }>("/webmention", (request, reply) => {
    const { source, target } = request.body;
    if (!(source && target)) {
      reply.code(400).send({ error: "Missing source or target" });
      return;
    }

    processInboundMention(config, {
      source,
      target,
      ip: request.ip,
      userAgent: (request.headers["user-agent"] as string) ?? "",
      type: "webmention",
    }).catch((err) => console.error("Webmention worker error:", err));

    reply.code(202).send({ status: "accepted" });
  });

  /**
   * Parse a simple XML-RPC methodCall, extracting methodName and string params.
   */
  function parseXmlRpcMethodCall(
    xml: string
  ): { methodName: string; params: string[] } | null {
    const methodMatch = xml.match(METHOD_NAME_REGEX);
    if (!methodMatch) {
      return null;
    }
    const methodName = (methodMatch[1] ?? "").trim();
    const params: string[] = [];
    const valMatches = xml.matchAll(VALUE_REGEX);
    for (const valMatch of valMatches) {
      params.push(valMatch[1] ?? "");
    }
    return { methodName, params };
  }

  /**
   * Extract source+target from a pingback request, supporting both
   * XML-RPC (text/xml) and JSON (application/json) content types.
   */
  function extractPingbackParams(
    body: unknown,
    contentType: string
  ): { source: string; target: string } | null {
    const isXml =
      contentType.includes("text/xml") ||
      contentType.includes("application/xml");
    if (isXml && typeof body === "string") {
      return extractPingbackFromXml(body);
    }
    // JSON fallback (used in tests and some clients)
    const jsonBody = body as Record<string, unknown> | null;
    if (jsonBody?.methodName === "pingback.ping") {
      const params = jsonBody.params as
        | Array<{ value?: { string?: string } }>
        | undefined;
      if (params && params.length >= 2) {
        const source = params[0]?.value?.string;
        const target = params[1]?.value?.string;
        if (source && target) {
          return { source, target };
        }
      }
    }
    return null;
  }

  function extractPingbackFromXml(
    xml: string
  ): { source: string; target: string } | null {
    const parsed = parseXmlRpcMethodCall(xml);
    if (parsed?.methodName !== "pingback.ping" || parsed.params.length < 2) {
      return null;
    }
    return { source: parsed.params[0] ?? "", target: parsed.params[1] ?? "" };
  }

  // POST /pingback (XML-RPC)
  fastify.post("/pingback", (request, reply) => {
    const contentType = (request.headers["content-type"] as string) ?? "";
    const params = extractPingbackParams(request.body, contentType);

    if (!params) {
      const isXml =
        contentType.includes("text/xml") ||
        contentType.includes("application/xml");
      // XML-RPC clients expect 200 with fault; JSON clients (tests) expect 400
      if (isXml) {
        reply
          .type("text/xml")
          .code(200)
          .send(
            `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>0</int></value></member><member><name>faultString</name><value><string>Invalid pingback request</string></value></member></struct></value></fault></methodResponse>`
          );
      } else {
        reply.code(400).send({ error: "Invalid pingback request" });
      }
      return;
    }

    processInboundMention(config, {
      source: params.source,
      target: params.target,
      ip: request.ip,
      userAgent: (request.headers["user-agent"] as string) ?? "",
      type: "pingback",
    }).catch((err) => console.error("Pingback worker error:", err));

    // XML-RPC success response
    reply
      .type("text/xml")
      .code(200)
      .send(
        `<?xml version="1.0"?><methodResponse><params><param><value><string>Thanks!</string></value></param></params></methodResponse>`
      );
  });

  // POST /trackback
  fastify.post<{
    Params: { slug: string };
    Body: {
      url?: string;
      title?: string;
      excerpt?: string;
      blog_name?: string;
    };
  }>("/trackback/*", (request, reply) => {
    const slug = (request.params as unknown as { "*": string })["*"];
    const { url, title, excerpt, blog_name } = request.body;

    if (!url) {
      reply.code(400).send({ error: "Missing url" });
      return;
    }

    const target = `${config.site.canonicalBase}/${slug}`;

    processInboundMention(config, {
      source: url,
      target,
      ip: request.ip,
      userAgent: (request.headers["user-agent"] as string) ?? "",
      type: "trackback",
      title: title ?? undefined,
      excerpt,
      blogName: blog_name,
    }).catch((err) => console.error("Trackback worker error:", err));

    reply.code(202).send({ status: "accepted" });
  });
}
