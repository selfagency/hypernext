import Fastify from "fastify";
import { getCachedParse, setCachedParse } from "../cache.js";
import { getDocBySlug } from "../database/index.js";
import {
  isDocPrivate,
  isDocPrivateFrontmatter,
  isFutureDated,
  isFutureDatedFrontmatter,
} from "../parser/frontmatter.js";
import { parseToIR, resolveComponentNodes } from "../parser/pipeline.js";
import { renderHTML } from "../renderers/html.js";
import { getArchiveDocs, getAuthorDocs, getTaxonomyDocs } from "../router.js";
import type { HypernextConfig } from "../types/config.js";

const NOT_FOUND_HTML = "<h1>404 Not Found</h1>";

export function createHttpServer(config: HypernextConfig) {
  const fastify = Fastify({ logger: false });

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

  // Sitemap
  fastify.get("/sitemap.xml", (_request, reply) => {
    reply
      .type("application/xml")
      .send(
        '<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
      );
  });

  // Health check
  fastify.get("/health", (_request, reply) => {
    reply.send({ status: "ok" });
  });

  return fastify;
}
