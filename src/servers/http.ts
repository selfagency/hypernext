import crypto from "node:crypto";
import path from "node:path";
import auth from "@fastify/auth";
import caching from "@fastify/caching";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrf from "@fastify/csrf-protection";
import env from "@fastify/env";
import etag from "@fastify/etag";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import urlData from "@fastify/url-data";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import httpErrorsEnhanced from "fastify-http-errors-enhanced";
import { recordPageview } from "../analytics/stats-manager.js";
import { getCachedParse, setCachedParse } from "../cache.js";
import { getDocBySlug } from "../database/index.js";
import { registerInboundRoutes } from "../federation/inbound.js";
import { registerFederationRoutes } from "../federation/index.js";
import {
  isDocPrivate,
  isDocPrivateFrontmatter,
  isFutureDated,
  isFutureDatedFrontmatter,
} from "../parser/frontmatter.js";
import { resolveLayoutWithComponents } from "../parser/layout.js";
import { parseToIR } from "../parser/pipeline.js";
import { registerWellKnownEndpoints } from "../renderers/agent-readiness.js";
import { addContentSignalHeader } from "../renderers/content-signals.js";
import { renderHTML } from "../renderers/html.js";
import { addLinkHeaders } from "../renderers/link-headers.js";
import { renderLlmsTxt } from "../renderers/llms-txt.js";
import { handleMarkdownNegotiation } from "../renderers/markdown-negotiation.js";
import { renderRobotsTxt } from "../renderers/robots-txt.js";
import { renderSecurityTxt } from "../renderers/security-txt.js";
import { renderSitemap } from "../renderers/sitemap.js";
import type { HypernextConfig } from "../types/config.js";

const NOT_FOUND_HTML = "<h1>404 Not Found</h1>";
const ALPHANUMERIC_REGEX = /[^\w-]/g;

/** Escape a string for safe use in MDX attribute values */
function esc(value: string): string {
  return value.replace(ALPHANUMERIC_REGEX, "");
}

async function handlePageRoute(
  config: HypernextConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  slug: string
): Promise<void> {
  const fullSlug = slug;
  const cached = getCachedParse(fullSlug);
  if (cached) {
    if (
      isDocPrivateFrontmatter(cached.frontmatter) ||
      isFutureDatedFrontmatter(cached.frontmatter)
    ) {
      reply.code(404).type("text/html").send(NOT_FOUND_HTML);
      return;
    }
    addLinkHeaders(reply, config, fullSlug);
    reply.type("text/html").send(renderHTML(cached, config, fullSlug));
    return;
  }

  const doc = await getDocBySlug(fullSlug);
  if (!doc) {
    reply.code(404).type("text/html").send(NOT_FOUND_HTML);
    return;
  }
  const rawMdx = (doc.rawMdx as string | undefined) ?? "";
  if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
    reply.code(404).type("text/html").send(NOT_FOUND_HTML);
    return;
  }
  if (handleMarkdownNegotiation(request, reply, config, fullSlug, rawMdx)) {
    return;
  }
  const result = await resolveLayoutWithComponents(
    config,
    { rawMdx, layout: doc.layout as string | undefined },
    {
      collection: undefined,
      slug: fullSlug,
      currentDocId: doc.id as number | undefined,
    }
  );
  setCachedParse(fullSlug, result);
  addLinkHeaders(reply, config, fullSlug);
  reply.type("text/html").send(
    renderHTML(result, config, fullSlug, {
      contentCid: (doc.contentCid as string | undefined) ?? undefined,
      htmlCid: (doc.htmlCid as string | undefined) ?? undefined,
    })
  );
}

export async function createHttpServer(config: HypernextConfig) {
  const fastify = Fastify({
    logger: false,
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Register Fastify ecosystem plugins
  fastify.register(formbody);
  fastify.register(cors, { origin: true });
  fastify.register(helmet, { contentSecurityPolicy: false });
  fastify.register(compress, { global: true });
  fastify.register(sensible);
  fastify.register(cookie);
  fastify.register(etag);
  fastify.register(urlData);
  fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });
  fastify.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 200_000_000,
    maxRssBytes: 300_000_000,
    message: "Service Unavailable",
    retryAfter: 30,
  });

  // JWT — derive secret from config or generate one per startup
  const jwtSecret = config.jwtSecret ?? crypto.randomBytes(32).toString("hex");
  fastify.register(jwt, { secret: jwtSecret });

  // CSRF protection (uses @fastify/cookie already registered above)
  fastify.register(csrf, { sessionPlugin: "@fastify/cookie" });

  // Auth — composable auth functions
  fastify.register(auth, { defaultRelation: "or" });

  // Swagger/OpenAPI docs
  fastify.register(swagger, {
    openapi: {
      info: {
        title: config.site.meta.title,
        description: config.site.meta.description,
        version: "1.0.0",
      },
      servers: [{ url: config.site.canonicalBase }],
    },
  });
  fastify.register(swaggerUi, { routePrefix: "/documentation" });

  // Environment variable validation
  fastify.register(env, {
    schema: {
      type: "object",
      properties: {
        HYPERNEXT_JWT_SECRET: { type: "string" },
        HYPERNEXT_DB_PATH: { type: "string" },
        HYPERNEXT_AKISMET_KEY: { type: "string" },
        HYPERNEXT_SMTP_HOST: { type: "string" },
        HYPERNEXT_SMTP_PORT: { type: "string" },
        HYPERNEXT_SMTP_USER: { type: "string" },
        HYPERNEXT_SMTP_PASS: { type: "string" },
        HYPERNEXT_OTLP_ENDPOINT: { type: "string" },
      },
      required: [],
    },
    data: process.env,
    confKey: "env",
  });

  // Enhanced HTTP error responses
  fastify.register(httpErrorsEnhanced, {
    hideUnhandledErrors: false,
    convertValidationErrors: true,
    use422ForValidationErrors: true,
  });

  // OpenTelemetry instrumentation
  await setupOpenTelemetry(config);

  const otel = new FastifyOtelInstrumentation({
    instrumentHooks: true,
    recordExceptions: true,
  });
  fastify.register(otel.plugin());

  // HTTP caching layer (cache-control headers)
  fastify.register(caching, { privacy: caching.privacy.PUBLIC });

  // Multipart file uploads
  fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
      files: 5,
    },
  });

  // ActivityPub content type support
  fastify.addContentTypeParser(
    "application/activity+json",
    { parseAs: "string" },
    fastify.getDefaultJsonParser("error", "ignore")
  );

  // Serve static assets from /assets/
  const assetsDir = path.resolve("assets");
  fastify.register(staticFiles, {
    root: assetsDir,
    prefix: "/assets/",
    decorateReply: false,
  });

  // Federation routes (ActivityPub, WebFinger, Inbox, Outbox)
  // Must be registered before the catch-all /:collection route
  registerFederationRoutes(fastify, config);
  registerInboundRoutes(fastify, config);

  // Home page
  fastify.get("/", async (_request, reply) => {
    const cached = getCachedParse("index");
    if (cached) {
      addLinkHeaders(reply, config);
      reply.type("text/html").send(renderHTML(cached, config));
      return;
    }
    const rawMdx = `# ${config.site.meta.title}\n\n${config.site.meta.description}\n\nBrowse [blog](/blog), [notes](/notes), or view [about](/about) to learn more.`;
    const result = await resolveLayoutWithComponents(
      config,
      { rawMdx },
      { slug: "index", currentDocId: undefined }
    );
    setCachedParse("index", result);
    addLinkHeaders(reply, config);
    reply.type("text/html").send(renderHTML(result, config));
  });

  // Collection root routes (e.g., /blog/, /library/)
  fastify.get<{ Params: { collection: string } }>(
    "/:collection",
    async (request, reply) => {
      const { collection } = request.params;

      // Redirect /index to /
      if (collection === "index") {
        reply.code(301).header("Location", "/").send();
        return;
      }

      // Check if this is a known collection
      if (Object.hasOwn(config.collections, collection)) {
        const slug = collection;
        const cached = getCachedParse(slug);
        if (cached) {
          addLinkHeaders(reply, config, slug);
          reply.type("text/html").send(renderHTML(cached, config));
          return;
        }
        const rawMdx = `<PostList collection="${esc(collection)}" limit={50} />`;
        const result = await resolveLayoutWithComponents(
          config,
          { rawMdx },
          { collection, slug, currentDocId: undefined }
        );
        setCachedParse(slug, result);
        addLinkHeaders(reply, config, slug);
        reply.type("text/html").send(renderHTML(result, config));
        return;
      }

      return handlePageRoute(config, request, reply, collection);
    }
  );

  // Blog/library slug routes
  fastify.get<{ Params: { collection: string; slug: string } }>(
    "/:collection/:slug",
    async (request, reply) => {
      const { collection, slug } = request.params;
      const fullSlug = `${collection}/${slug}`;

      const cached = getCachedParse(fullSlug);
      if (cached) {
        if (
          isDocPrivateFrontmatter(cached.frontmatter) ||
          isFutureDatedFrontmatter(cached.frontmatter)
        ) {
          reply.code(404).type("text/html").send(NOT_FOUND_HTML);
          return;
        }
        addLinkHeaders(reply, config, fullSlug);
        reply.type("text/html").send(renderHTML(cached, config, fullSlug));
        return;
      }

      const doc = await getDocBySlug(fullSlug);
      if (!doc) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }

      const rawMdx = (doc.rawMdx as string | undefined) ?? "";

      if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }

      // Markdown content negotiation (Accept: text/markdown)
      if (handleMarkdownNegotiation(request, reply, config, fullSlug, rawMdx)) {
        return;
      }

      const result = await resolveLayoutWithComponents(
        config,
        { rawMdx, layout: doc.layout as string | undefined },
        {
          collection: collection as string | undefined,
          slug: fullSlug,
          currentDocId: doc.id as number | undefined,
        }
      );
      setCachedParse(fullSlug, result);
      addLinkHeaders(reply, config, fullSlug);
      reply.type("text/html").send(
        renderHTML(result, config, fullSlug, {
          contentCid: (doc.contentCid as string | undefined) ?? undefined,
          htmlCid: (doc.htmlCid as string | undefined) ?? undefined,
        })
      );

      // Fire-and-forget pageview recording
      recordPageview(
        fullSlug,
        "http",
        request.ip,
        request.headers.referer
      ).catch(() => {
        /* fire-and-forget */
      });
    }
  );

  // Archive routes
  fastify.get<{ Params: { collection: string; year: string; month?: string } }>(
    "/:collection/archive/:year/:month?",
    async (request, reply) => {
      const { year, month, collection } = request.params;
      const yearNum = Number(year);
      const monthNum = month ? Number(month) : undefined;

      if (Number.isNaN(yearNum)) {
        reply.code(400).type("text/html").send("<h1>400 Bad Request</h1>");
        return;
      }

      const filterSuffix = monthNum
        ? `:${String(monthNum).padStart(2, "0")}`
        : "";
      const rawMdx = `<Archive filter="year:${esc(String(yearNum))}${esc(filterSuffix)}" limit={50} />`;
      const slugSuffix = month ? `/${month}` : "";
      const result = await resolveLayoutWithComponents(
        config,
        { rawMdx },
        {
          collection,
          slug: `${collection}/archive/${year}${slugSuffix}`,
          currentDocId: undefined,
        }
      );
      reply.type("text/html").send(renderHTML(result, config));
    }
  );

  // Taxonomy routes: /:collection/:taxonomy/:term
  fastify.get<{
    Params: { collection: string; taxonomy: string; term: string };
  }>("/:collection/:taxonomy/:term", async (request, reply) => {
    const { collection, taxonomy, term } = request.params;

    // Check if this is a known taxonomy
    const taxConfig = config.taxonomies.find((t) => t.name === taxonomy); // NOSONAR
    if (!taxConfig) {
      // Not a taxonomy — treat as a doc slug
      const fullSlug = `${collection}/${taxonomy}/${term}`;

      // Support /*/index.md for raw markdown access
      if (await tryServeIndexMd(reply, config, collection, taxonomy, term)) {
        return;
      }

      const doc = await getDocBySlug(fullSlug);
      if (!doc) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }
      const rawMdx = (doc.rawMdx as string | undefined) ?? "";
      if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }
      const result = await resolveLayoutWithComponents(
        config,
        { rawMdx, layout: doc.layout as string | undefined },
        {
          collection: collection as string | undefined,
          slug: fullSlug,
          currentDocId: doc.id as number | undefined,
        }
      );
      setCachedParse(fullSlug, result);
      addLinkHeaders(reply, config, fullSlug);
      reply.type("text/html").send(
        renderHTML(result, config, fullSlug, {
          contentCid: (doc.contentCid as string | undefined) ?? undefined,
          htmlCid: (doc.htmlCid as string | undefined) ?? undefined,
        })
      );
      return;
    }

    const rawMdx = `<Archive filter="taxonomy:${esc(taxonomy)}:${esc(term)}" limit={50} />`;
    const result = await resolveLayoutWithComponents(
      config,
      { rawMdx },
      {
        collection,
        slug: `${collection}/${taxonomy}/${term}`,
        currentDocId: undefined,
      }
    );
    reply.type("text/html").send(renderHTML(result, config));
  });

  // Author routes
  fastify.get<{ Params: { collection: string; author: string } }>(
    "/:collection/authors/:author",
    async (request, reply) => {
      const { collection, author } = request.params;
      const rawMdx = `<Archive filter="author:${esc(author)}" limit={50} />`;
      const result = await resolveLayoutWithComponents(
        config,
        { rawMdx },
        {
          collection,
          slug: `${collection}/authors/${author}`,
          currentDocId: undefined,
        }
      );
      reply.type("text/html").send(renderHTML(result, config));
    }
  );

  // RSS feed
  fastify.get("/rss.xml", async (_request, reply) => {
    const { renderRSS } = await import("../renderers/rss.js");
    try {
      const rss = await renderRSS(config);
      reply.type("application/rss+xml").send(rss);
    } catch {
      reply
        .type("application/rss+xml")
        .send(
          '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel><title>RSS</title></channel></rss>'
        );
    }
  });

  // Health check
  fastify.get("/health", (_request, reply) => {
    reply.send({ status: "ok" });
  });

  // ── Agent Readiness Routes ──

  // robots.txt (always served when config allows)
  if (config.robotsTxt?.enabled !== false) {
    fastify.get("/robots.txt", (_request, reply) => {
      reply.type("text/plain").send(renderRobotsTxt(config));
    });
  }

  // security.txt (RFC 9116) — served when contact and expires are configured
  if (config.securityTxt?.contact.length && config.securityTxt.expires) {
    const securityTxt = renderSecurityTxt(config.securityTxt);
    fastify.get("/.well-known/security.txt", (_request, reply) => {
      reply.type("text/plain").send(securityTxt);
    });
    fastify.get("/security.txt", (_request, reply) => {
      reply.type("text/plain").send(securityTxt);
    });
  }

  // XML Sitemap
  if (config.agent?.enabled && config.agent.sitemap) {
    fastify.get("/sitemap.xml", async (_request, reply) => {
      reply.type("application/xml").send(await renderSitemap(config));
    });
  }

  // llms.txt
  if (config.agent?.enabled && config.agent.llmsTxt) {
    fastify.get("/llms.txt", async (_request, reply) => {
      reply.type("text/plain").send(await renderLlmsTxt(config));
    });
  }

  // Well-known endpoints
  registerWellKnownEndpoints(fastify, config);

  // Global onResponse hook for Content-Signal header
  if (config.contentSignals?.enabled) {
    fastify.addHook("onResponse", (_request, reply, done) => {
      addContentSignalHeader(reply, config);
      done();
    });
  }

  // Global onResponse hook for pageview tracking on HTML responses
  fastify.addHook("onResponse", (request, reply, done) => {
    if (
      reply.statusCode >= 200 &&
      reply.statusCode < 400 &&
      reply.getHeader("content-type")?.toString().includes("text/html")
    ) {
      const slug = (request.params as Record<string, string>).slug ?? "";
      if (slug) {
        recordPageview(slug, "http", request.ip).catch(() => {
          /* non-fatal */
        });
      }
    }
    done();
  });

  return fastify;
}

/**
 * Try to serve a document as raw markdown when the URL ends with /index.md.
 * Called from the taxonomy route handler when the taxonomy is not recognized.
 * Returns true if the markdown was served, false to continue normal handling.
 */
async function tryServeIndexMd(
  reply: FastifyReply,
  config: HypernextConfig,
  collection: string,
  taxonomy: string,
  term: string
): Promise<boolean> {
  if (
    term !== "index.md" ||
    !config.agent?.enabled ||
    !config.agent.markdownNegotiation
  ) {
    return false;
  }
  const parentSlug = `${collection}/${taxonomy}`;
  const parentDoc = await getDocBySlug(parentSlug);
  if (!parentDoc) {
    return false;
  }
  const parentRawMdx = (parentDoc.rawMdx as string) ?? "";
  const parseResult =
    getCachedParse(parentSlug) ?? parseToIR(parentRawMdx, parentSlug);
  const { renderMarkdown } = await import("../renderers/markdown.js");
  reply
    .type("text/markdown; charset=utf-8")
    .send(renderMarkdown(parseResult.ir));
  return true;
}

async function setupOpenTelemetry(config: HypernextConfig): Promise<void> {
  if (!(config.telemetry?.enabled && config.telemetry.otlpEndpoint)) {
    return;
  }
  const { diag, DiagConsoleLogger } = await import("@opentelemetry/api");
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-proto"
  );
  const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
  diag.setLogger(new DiagConsoleLogger(), (diag as any).LogLevel?.WARN ?? 3);
  // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
  const provider: any = new NodeTracerProvider(
    // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
    { serviceName: config.telemetry.serviceName ?? "hypernext" } as any
  );
  // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
  const exporter: any = new OTLPTraceExporter(
    // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
    { url: config.telemetry.otlpEndpoint } as any
  );
  // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
  (provider as any).addSpanProcessor(
    new BatchSpanProcessor(exporter, {
      scheduledDelayMillis: config.telemetry.exportInterval ?? 5000,
    })
  );
  // biome-ignore lint/suspicious/noExplicitAny: OpenTelemetry API types vary by version
  (provider as any).register();
}
