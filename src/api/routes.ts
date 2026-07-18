import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { DocMeta } from "../database/entities/doc-meta.js";
import { getDocBySlug, getEm, listDocSlugs } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderHTML } from "../renderers/html.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { HypernextConfig } from "../types/config.js";

const PDF_EXT_REGEX = /\.pdf$/;
const IPFS_SUFFIX = "/ipfs";
const PIN_SUFFIX = "/pin";

async function handleIpfsCidRequest(
  slug: string,
  config: HypernextConfig,
  reply: import("fastify").FastifyReply
): Promise<void> {
  const docSlug = slug.slice(0, -IPFS_SUFFIX.length);
  const doc = await getDocBySlug(docSlug);
  if (!doc) {
    reply.code(404).send({ error: "Not found" });
    return;
  }
  const gatewayUrl = config.ipfs?.gatewayUrl ?? "https://ipfs.io/ipfs";
  const contentCid = (doc.contentCid as string | null) ?? null;
  const htmlCid = (doc.htmlCid as string | null) ?? null;
  const activeCid = contentCid ?? htmlCid;
  reply.send({
    slug: docSlug,
    contentCid,
    htmlCid,
    gatewayUrl: activeCid ? `${gatewayUrl}/${activeCid}` : null,
  });
}

async function handlePdfRequest(
  slug: string,
  config: HypernextConfig,
  reply: import("fastify").FastifyReply
): Promise<void> {
  const docSlug = slug.replace(PDF_EXT_REGEX, "");
  const doc = await getDocBySlug(docSlug);
  if (!doc) {
    reply.code(404).send({ error: "Not found" });
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  const result = parseToIR(rawMdx, docSlug);
  const md = renderMarkdown(result.ir);

  const cssPath = config.site.pdfCssPath
    ? path.resolve(config.site.pdfCssPath)
    : undefined;

  try {
    const { mdToPdf } = await import("md-to-pdf");
    const pdfConfig: Record<string, string> = {};
    if (cssPath) {
      pdfConfig.css = fs.readFileSync(cssPath, "utf-8");
    }
    const pdf = await mdToPdf(
      { content: md },
      Object.keys(pdfConfig).length > 0 ? pdfConfig : undefined
    );
    reply
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="${docSlug}.pdf"`)
      .send(pdf.content);
  } catch {
    reply.code(500).send({ error: "PDF generation failed" });
  }
}

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
    const where: Record<string, unknown> = {};
    if (type) {
      where.type = type;
    }

    if (tag) {
      const rows = await em.getConnection().execute<{ id: number }[]>(
        `SELECT DISTINCT m.id FROM docs_meta m
         JOIN term_relationships tr ON tr.doc_id = m.id
         JOIN terms t ON t.id = tr.term_id
         WHERE t.slug = ?`,
        [tag]
      );
      if (rows.length > 0) {
        where.id = { $in: rows.map((r: { id: number }) => r.id) };
      } else {
        reply.send({ docs: [], limit, offset });
        return;
      }
    }

    const docs = await em.find(DocMeta, where, {
      orderBy: { date: "DESC", id: "DESC" },
      limit,
      offset,
      fields: ["slug", "title", "description", "date", "type"],
    });
    reply.send({ docs, limit, offset });
  });

  // GET /api/v1/docs/* — single doc as JSON, PDF, or IPFS CIDs
  fastify.get("/api/v1/docs/*", async (request, reply) => {
    const slug = (request.params as { "*": string })["*"];

    if (slug.endsWith(IPFS_SUFFIX)) {
      await handleIpfsCidRequest(slug, config, reply);
      return;
    }

    if (slug.endsWith(".pdf")) {
      await handlePdfRequest(slug, config, reply);
      return;
    }

    const doc = await getDocBySlug(slug);
    if (!doc) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    reply.send(doc);
  });

  // POST /api/v1/docs/* — pin document to IPFS (when slug ends with /pin)
  fastify.post("/api/v1/docs/*", async (request, reply) => {
    const slug = (request.params as { "*": string })["*"];

    if (slug.endsWith(PIN_SUFFIX)) {
      if (!config.ipfs?.enabled) {
        reply.code(400).send({ error: "IPFS is not enabled" });
        return;
      }
      const docSlug = slug.slice(0, -PIN_SUFFIX.length);
      try {
        const { pinDoc } = await import("../storage/ipfs.js");
        const result = await pinDoc(config, docSlug);
        reply.send({ status: "pinned", slug: docSlug, ...result });
      } catch (error) {
        reply.code(500).send({ error: String(error) });
      }
      return;
    }

    reply.code(404).send({ error: "Not found" });
  });

  // PUT /api/v1/docs/* — create or update a document
  fastify.put("/api/v1/docs/*", async (request, reply) => {
    const slug = (request.params as { "*": string })["*"];
    const content = request.body as string;
    const { writeStorage } = await import("../storage/index.js");
    await writeStorage(slug, content);
    reply.send({ status: "saved", slug });
  });

  // POST /api/v1/ingest — ingest a URL and save as MDX
  fastify.post<{
    Body: {
      url: string;
      collection?: string;
      filename?: string;
      downloadMedia?: boolean;
    };
  }>("/api/v1/ingest", async (request, reply) => {
    const { url, collection, filename, downloadMedia } = request.body;
    if (!url) {
      reply.code(400).send({ error: "Missing url" });
      return;
    }
    try {
      const { ingestUrlWithMeta } = await import("../ingest/ingest-manager.js");
      const result = await ingestUrlWithMeta(
        {
          url,
          collection: collection ?? "library",
          filename: filename ?? "ingested",
          downloadMedia: downloadMedia ?? false,
        },
        config
      );
      reply.send({
        status: "ingested",
        slug: result.slug,
        assets: result.assets,
      });
    } catch (error) {
      reply.code(500).send({ error: String(error) });
    }
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
        const rawMdx = (doc.rawMdx as string) ?? "";
        const result = parseToIR(rawMdx, slug);
        const html = renderHTML(result, config, slug, {
          contentCid: (doc.contentCid as string | undefined) ?? undefined,
          htmlCid: (doc.htmlCid as string | undefined) ?? undefined,
        });
        chapters.push({
          title: String((doc.title as string) ?? slug),
          data: html,
        });
      }

      try {
        const { EPub } = await import("@lesjoursfr/html-to-epub");
        const epubOptions: Record<string, unknown> = {
          title: collection.path ?? name,
          description: config.site.meta.description,
          content: chapters,
          author: config.author.name,
          lang: config.site.meta.lang,
        };
        if (config.site.ebookCoverImage) {
          epubOptions.cover = path.resolve(config.site.ebookCoverImage);
        }
        // @ts-expect-error — @lesjoursfr/html-to-epub EPub constructor accepts options object
        const epub = new EPub(epubOptions, "");
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
