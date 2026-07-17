import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { Term } from "../database/entities/term.js";
import { TermRelationship } from "../database/entities/term-relationship.js";
import { getDocBySlug, getEm, listDocSlugs } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderHTML } from "../renderers/html.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { HypernextConfig } from "../types/config.js";

const PDF_EXT_REGEX = /\.pdf$/;

export function registerApiRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  // GET /api/v1/docs — list docs with optional filters
  fastify.get("/api/v1/docs", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const type = query.type;
    const tag = query.tag;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const offset = Number(query.offset) || 0;

    const em = getEm();
    const qb = em.createQueryBuilder("DocMeta", "m");
    qb.select(["m.slug", "m.title", "m.description", "m.date", "m.type"]);

    if (type) {
      qb.andWhere({ type });
    }

    if (tag) {
      const em = getEm();
      const term = await em.findOne(Term, { slug: tag });
      if (term) {
        const rels = await em.find(
          TermRelationship,
          { termId: term.id },
          { fields: ["docId"] }
        );
        const docIds = rels.map((r) => r.docId);
        qb.andWhere({ id: { $in: docIds } });
      }
    }

    qb.orderBy({ date: "DESC", id: "DESC" }).limit(limit).offset(offset);
    const docs = await qb.execute();
    reply.send({ docs, limit, offset });
  });

  // GET /api/v1/docs/* — single doc as JSON or PDF
  fastify.get("/api/v1/docs/*", async (request, reply) => {
    const slug = (request.params as { "*": string })["*"];

    if (slug.endsWith(".pdf")) {
      const docSlug = slug.replace(PDF_EXT_REGEX, "");
      const doc = await getDocBySlug(docSlug);
      if (!doc) {
        reply.code(404).send({ error: "Not found" });
        return;
      }

      const rawMdx = doc.rawMdx ?? "";
      const result = parseToIR(rawMdx, docSlug);
      const md = renderMarkdown(result.ir);

      const cssPath = config.site.pdf?.cssPath
        ? path.resolve(config.site.pdf.cssPath)
        : undefined;

      try {
        const { mdToPdf } = await import("md-to-pdf");
        const pdf = await mdToPdf(
          { content: md },
          { css: cssPath ? fs.readFileSync(cssPath, "utf-8") : undefined }
        );
        reply
          .type("application/pdf")
          .header("Content-Disposition", `inline; filename="${docSlug}.pdf"`)
          .send(pdf.content);
      } catch {
        reply.code(500).send({ error: "PDF generation failed" });
      }
      return;
    }

    const doc = await getDocBySlug(slug);
    if (!doc) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    reply.send(doc);
  });

  // GET /api/v1/collections/:name.epub — EPUB generation
  fastify.get<{ Params: { name: string } }>(
    "/api/v1/collections/:name.epub",
    async (request, reply) => {
      const { name } = request.params;
      const collection = config.collections[name];
      if (!collection) {
        reply.code(404).send({ error: "Collection not found" });
        return;
      }

      const prefix = `${name}/`;
      const slugs = (await listDocSlugs()).filter((s) => s.startsWith(prefix));

      const chapters: { title: string; data: string }[] = [];
      for (const slug of slugs) {
        const doc = await getDocBySlug(slug);
        if (!doc) {
          continue;
        }
        const rawMdx = doc.rawMdx ?? "";
        const result = parseToIR(rawMdx, slug);
        const html = renderHTML(result, config);
        chapters.push({ title: doc.title ?? slug, data: html });
      }

      try {
        const { EPub } = await import("@lesjoursfr/html-to-epub");
        const epub = new EPub({
          title: collection.path ?? name,
          content: chapters,
          author: config.author.name,
          lang: config.site.meta.lang,
          cover: config.site.ebooks?.coverImage
            ? path.resolve(config.site.ebooks.coverImage)
            : undefined,
        });
        const buffer = await epub.render();
        reply
          .type("application/epub+zip")
          .header("Content-Disposition", `inline; filename="${name}.epub"`)
          .send(buffer);
      } catch {
        reply.code(500).send({ error: "EPUB generation failed" });
      }
    }
  );
}
