import { createDatabase, createOrchestrator } from "workmatic";
import { syndicateToBluesky } from "../bridge/bluesky.js";
import { syndicateToMastodon } from "../bridge/mastodon.js";
import { getSyndicationForDoc } from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { HypernextConfig } from "../types/config.js";
import { processInboundMention } from "./inbound.js";
import { fetchBlueskyReplies, fetchMastodonReplies } from "./posse-replies.js";

let orchestrator: ReturnType<typeof createOrchestrator> | null = null;

const DB_EXT_REGEX = /\.db$/;

export function initWorkmatic(config: HypernextConfig): void {
  if (orchestrator) {
    return;
  }

  const db = createDatabase({
    filename: `${config.database.path.replace(DB_EXT_REGEX, "")}-jobs.db`,
  });

  orchestrator = createOrchestrator({ db });

  // ── Queue: inbound mentions (webmention, pingback, trackback) ──
  orchestrator.register("inbound-mentions", {
    worker: { concurrency: 4, timeoutMs: 30_000 },
  });

  orchestrator.process("inbound-mentions", async (job) => {
    const payload = job.payload as {
      source: string;
      target: string;
      ip: string;
      userAgent: string;
      type: "webmention" | "pingback" | "trackback";
      excerpt?: string;
      title?: string;
      blogName?: string;
    };
    await processInboundMention(config, payload);
  });

  // ── Queue: POSSE reply fetching (Mastodon, Bluesky) ──
  orchestrator.register("posse-replies", {
    worker: { concurrency: 2, timeoutMs: 30_000 },
  });

  orchestrator.process("posse-replies", async (job) => {
    const payload = job.payload as {
      slug: string;
      platform: "mastodon" | "bluesky";
      postId: string;
    };
    if (payload.platform === "mastodon") {
      await fetchMastodonReplies(config, payload.slug, payload.postId);
    } else {
      await fetchBlueskyReplies(config, payload.slug, payload.postId);
    }
  });

  // ── Queue: outbound syndication (Mastodon, Bluesky) ──
  orchestrator.register("outbound-syndication", {
    worker: { concurrency: 2, timeoutMs: 60_000 },
  });

  orchestrator.process("outbound-syndication", async (job) => {
    const payload = job.payload as {
      docId: number;
      slug: string;
      content: string;
    };
    const existing = await getSyndicationForDoc(payload.docId);
    const alreadySyndicated = new Set(
      existing.map((r) => r.platform as string)
    );

    if (
      config.syndication.mastodon?.enabled &&
      !alreadySyndicated.has("mastodon")
    ) {
      await syndicateToMastodon(
        config,
        payload.docId,
        payload.slug,
        payload.content
      );
    }

    if (
      config.syndication.bluesky?.enabled &&
      !alreadySyndicated.has("bluesky")
    ) {
      await syndicateToBluesky(
        config,
        payload.docId,
        payload.slug,
        payload.content
      );
    }
  });

  // ── Queue: document indexing ──
  orchestrator.register("indexing", {
    worker: { concurrency: 1, timeoutMs: 30_000 },
  });

  orchestrator.process("indexing", async (job) => {
    const payload = job.payload as {
      slug: string;
      rawMdx: string;
    };
    const { indexDocument } = await import("../indexer/index.js");
    await indexDocument(payload.slug, payload.rawMdx);
  });

  // ── Queue: PDF generation ──
  orchestrator.register("pdf-generation", {
    worker: { concurrency: 1, timeoutMs: 60_000 },
  });

  orchestrator.process("pdf-generation", async (job) => {
    const payload = job.payload as {
      slug: string;
      rawMdx: string;
    };
    const result = parseToIR(payload.rawMdx, payload.slug);
    const md = renderMarkdown(result.ir);

    const cssPath = config.site.pdf?.cssPath
      ? (await import("node:path")).resolve(config.site.pdf.cssPath)
      : undefined;

    try {
      const { mdToPdf } = await import("md-to-pdf");
      const pdf = await mdToPdf(
        { content: md },
        {
          css: cssPath
            ? (await import("node:fs")).readFileSync(cssPath, "utf-8")
            : undefined,
        }
      );
      if (pdf) {
        // Store the PDF in the doc's cache or storage
        const { writeStorage } = await import("../storage/index.js");
        await writeStorage(`${payload.slug}.pdf`, pdf.content);
      }
    } catch (error) {
      console.error(`PDF generation failed for ${payload.slug}:`, error);
    }
  });

  // ── Queue: EPUB generation ──
  orchestrator.register("epub-generation", {
    worker: { concurrency: 1, timeoutMs: 120_000 },
  });

  orchestrator.process("epub-generation", async (job) => {
    const payload = job.payload as {
      collectionName: string;
      slugs: string[];
    };
    const chapters: { title: string; data: string }[] = [];
    for (const slug of payload.slugs) {
      const { getDocBySlug } = await import("../database/index.js");
      const doc = await getDocBySlug(slug);
      if (!doc) {
        continue;
      }
      const rawMdx = (doc.rawMdx as string) ?? "";
      const result = parseToIR(rawMdx, slug);
      const { renderHTML } = await import("../renderers/html.js");
      const html = renderHTML(result, config);
      chapters.push({ title: (doc.title as string) ?? slug, data: html });
    }

    try {
      const { EPub } = await import("@lesjoursfr/html-to-epub");
      const epub = new EPub({
        title: payload.collectionName,
        content: chapters,
        author: config.author.name,
        lang: config.site.meta.lang,
        cover: config.site.ebooks?.coverImage
          ? (await import("node:path")).resolve(config.site.ebooks.coverImage)
          : undefined,
      });
      const buffer = await epub.render();
      const { writeStorage } = await import("../storage/index.js");
      await writeStorage(`${payload.collectionName}.epub`, buffer);
    } catch (error) {
      console.error(
        `EPUB generation failed for ${payload.collectionName}:`,
        error
      );
    }
  });

  orchestrator.startAll();
}

export function getOrchestrator(): ReturnType<typeof createOrchestrator> {
  if (!orchestrator) {
    throw new Error("Workmatic not initialized. Call initWorkmatic() first.");
  }
  return orchestrator;
}

export async function enqueueInboundMention(payload: {
  source: string;
  target: string;
  ip: string;
  userAgent: string;
  type: "webmention" | "pingback" | "trackback";
  excerpt?: string;
  title?: string;
  blogName?: string;
}): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("inbound-mentions");
  await client.add(payload, { maxAttempts: 3 });
}

export async function enqueuePosseReplyFetch(
  slug: string,
  docId: number,
  platform: "mastodon" | "bluesky"
): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("posse-replies");

  const records = await getSyndicationForDoc(docId);
  const record = records.find((r) => r.platform === platform);
  if (!record) {
    return;
  }

  const postId = record.url as string;

  await client.add(
    { slug, platform, postId },
    { maxAttempts: 2, delayMs: 5000 }
  );
}

export async function enqueueOutboundSyndication(
  docId: number,
  slug: string,
  content: string
): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("outbound-syndication");
  await client.add({ docId, slug, content }, { maxAttempts: 3, delayMs: 2000 });
}

export async function enqueueIndexing(
  slug: string,
  rawMdx: string
): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("indexing");
  await client.add({ slug, rawMdx }, { maxAttempts: 2 });
}

export async function enqueuePdfGeneration(
  slug: string,
  rawMdx: string
): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("pdf-generation");
  await client.add({ slug, rawMdx }, { maxAttempts: 2 });
}

export async function enqueueEpubGeneration(
  collectionName: string,
  slugs: string[]
): Promise<void> {
  const orch = getOrchestrator();
  const client = orch.client("epub-generation");
  await client.add({ collectionName, slugs }, { maxAttempts: 2 });
}

export async function stopWorkmatic(): Promise<void> {
  if (orchestrator) {
    await orchestrator.stopAll();
    orchestrator = null;
  }
}
