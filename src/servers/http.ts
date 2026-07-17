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
import sensible from "@fastify/sensible";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import urlData from "@fastify/url-data";
import Fastify from "fastify";
import httpErrorsEnhanced from "fastify-http-errors-enhanced";
import { recordPageview } from "../analytics/stats-manager.js";
import { getCachedParse, setCachedParse } from "../cache.js";
import { getDocBySlug } from "../database/index.js";
import {
  isDocPrivate,
  isDocPrivateFrontmatter,
  isFutureDated,
  isFutureDatedFrontmatter,
} from "../parser/frontmatter.js";
import { parseToIR, resolveComponentNodes } from "../parser/pipeline.js";
import { registerWellKnownEndpoints } from "../renderers/agent-readiness.js";
import { addContentSignalHeader } from "../renderers/content-signals.js";
import { renderHTML } from "../renderers/html.js";
import { renderLlmsTxt } from "../renderers/llms-txt.js";
import { renderRobotsTxt } from "../renderers/robots-txt.js";
import { renderSecurityTxt } from "../renderers/security-txt.js";
import { renderSitemap } from "../renderers/sitemap.js";
import { getArchiveDocs, getAuthorDocs, getTaxonomyDocs } from "../router.js";
import type { HypernextConfig } from "../types/config.js";

const NOT_FOUND_HTML = "<h1>404 Not Found</h1>";
const INDEX_MD_REGEX = /\/index\.md$/;

export function createHttpServer(config: HypernextConfig) {
  const fastify = Fastify({ logger: false });

  // Register Fastify ecosystem plugins
  fastify.register(formbody);
  fastify.register(cors, { origin: true });
  fastify.register(helmet, { contentSecurityPolicy: false });
  fastify.register(compress, { global: true });
  fastify.register(sensible);
  fastify.register(cookie);
  fastify.register(etag);
  fastify.register(urlData);
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

  // Serve static assets from /assets/
  const assetsDir = path.resolve("assets");
  fastify.register(staticFiles, {
    root: assetsDir,
    prefix: "/assets/",
    decorateReply: false,
  });

  // Home page
  fastify.get("/", (_request, reply) => {
    const cached = getCachedParse("index");
    if (cached) {
      reply.type("text/html").send(renderHTML(cached, config));
      return;
    }
    const result = parseToIR(
      `# ${config.site.meta.title}\n\n${config.site.meta.description}`
    );
    setCachedParse("index", result);
    reply.type("text/html").send(renderHTML(result, config));
  });

  // Blog/library slug routes
  fastify.get<{ Params: { slug: string } }>(
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
        reply.type("text/html").send(renderHTML(cached, config, fullSlug));
        return;
      }

      const doc = await getDocBySlug(fullSlug);
      if (!doc) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }

      if (isDocPrivate(doc.rawMdx ?? "") || isFutureDated(doc.rawMdx ?? "")) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }

      const rawMdx = doc.rawMdx ?? "";
      const result = parseToIR(rawMdx, fullSlug);
      await resolveComponentNodes(result.ir, config, fullSlug);
      setCachedParse(fullSlug, result);
      reply.type("text/html").send(renderHTML(result, config, fullSlug));

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
      const { year, month } = request.params;
      const yearNum = Number(year);
      const monthNum = month ? Number(month) : undefined;

      if (Number.isNaN(yearNum)) {
        reply.code(400).type("text/html").send("<h1>400 Bad Request</h1>");
        return;
      }

      const slugs = await getArchiveDocs(yearNum, monthNum);
      const title = monthNum
        ? `Archive: ${yearNum}/${String(monthNum).padStart(2, "0")}`
        : `Archive: ${yearNum}`;
      const body = slugs
        .map((s) => `<li><a href="/${s}">${s}</a></li>`)
        .join("\n");

      reply.type("text/html").send(`<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1><ul>${body}</ul></body></html>`);
    }
  );

  // Taxonomy routes: /:collection/:taxonomy/:term
  fastify.get<{
    Params: { collection: string; taxonomy: string; term: string };
  }>("/:collection/:taxonomy/:term", async (request, reply) => {
    const { collection, taxonomy, term } = request.params;

    // Check if this is a known taxonomy
    const taxConfig = config.taxonomies.find((t) => t.name === taxonomy);
    if (!taxConfig) {
      // Not a taxonomy — treat as a doc slug
      const fullSlug = `${collection}/${taxonomy}/${term}`;
      const doc = await getDocBySlug(fullSlug);
      if (!doc) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }
      if (isDocPrivate(doc.rawMdx ?? "") || isFutureDated(doc.rawMdx ?? "")) {
        reply.code(404).type("text/html").send(NOT_FOUND_HTML);
        return;
      }
      const rawMdx = doc.rawMdx ?? "";
      const result = parseToIR(rawMdx, fullSlug);
      await resolveComponentNodes(result.ir, config, fullSlug);
      setCachedParse(fullSlug, result);
      reply.type("text/html").send(renderHTML(result, config, fullSlug));
      return;
    }

    const slugs = await getTaxonomyDocs(taxonomy, term);
    const title = `${taxConfig.singular}: ${term}`;
    const body = slugs
      .map((s) => `<li><a href="/${s}">${s}</a></li>`)
      .join("\n");

    reply.type("text/html").send(`<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1><ul>${body}</ul></body></html>`);
  });

  // Author routes
  fastify.get<{ Params: { collection: string; author: string } }>(
    "/:collection/authors/:author",
    async (request, reply) => {
      const { author } = request.params;
      const slugs = await getAuthorDocs(author);
      const title = `Author: ${author}`;
      const body = slugs
        .map((s) => `<li><a href="/${s}">${s}</a></li>`)
        .join("\n");

      reply.type("text/html").send(`<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1><ul>${body}</ul></body></html>`);
    }
  );

  // RSS feed
  fastify.get("/rss.xml", (_request, reply) => {
    reply
      .type("application/rss+xml")
      .send(
        '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel><title>RSS</title></channel></rss>'
      );
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

  // security.txt (RFC 9116) — served when contact is configured
  if (config.securityTxt?.contact.length) {
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

  // Markdown index.md fallback
  if (config.agent?.enabled && config.agent.markdownNegotiation) {
    fastify.get("/*/index.md", async (request, reply) => {
      const slug = (request.params as { "*": string })["*"].replace(
        INDEX_MD_REGEX,
        ""
      );
      const doc = await getDocBySlug(slug);
      if (!doc) {
        reply.code(404).type("text/plain").send("Not found");
        return;
      }
      const rawMdx = (doc.rawMdx as string) ?? "";
      const result = getCachedParse(slug) ?? parseToIR(rawMdx, slug);
      const markdown = (
        await import("../renderers/markdown.js")
      ).renderMarkdown(result.ir);
      reply.type("text/markdown; charset=utf-8").send(markdown);
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

  return fastify;
}
