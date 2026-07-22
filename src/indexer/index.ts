import fs from "node:fs";
import path from "node:path";

import { invalidateAll } from "../cache.js";
import { DocMeta } from "../database/entities/doc-meta.js";
import { Term } from "../database/entities/term.js";
import { TermRelationship } from "../database/entities/term-relationship.js";
import {
  getEm,
  insertDoc,
  relateDocToTerm,
  upsertTerm,
} from "../database/index.js";
import { parseToIR } from "../parser/pipeline.js";
import { getStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";
import { logger } from "../utils/logger.js";

const MD_EXT_REGEX = /\.mdx?$/;
const BACKSLASH_REGEX = /\\/g;

export async function indexDocument(
  slug: string,
  rawMdx: string,
  config?: HypernextConfig
): Promise<void> {
  const result = parseToIR(rawMdx, slug);
  const { frontmatter } = result;

  const docId = await insertDoc({
    slug,
    title: String(frontmatter.title ?? slug),
    description: frontmatter.description as string | undefined,
    date: frontmatter.date as string | undefined,
    type: frontmatter.type as string | undefined,
    layout: frontmatter.layout as string | undefined,
    canonicalUrl: frontmatter.canonicalUrl as string | undefined,
    rawMdx,
    irJson: JSON.stringify(result.ir),
    publishedAt: frontmatter.publishedAt as string | undefined,
    scheduledAt: frontmatter.scheduledAt as string | undefined,
    order: frontmatter.order as number | undefined,
    metaJson: JSON.stringify(frontmatter),
  });

  for (const taxonomy of ["tags", "categories"] as const) {
    const values = frontmatter[taxonomy];
    if (Array.isArray(values)) {
      for (const raw of values) {
        const name = String(raw).trim();
        if (!name) {
          continue;
        }
        const termSlug = name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]/g, "");
        const termId = await upsertTerm(taxonomy, termSlug, name);
        await relateDocToTerm(docId, termId);
      }
    }
  }

  invalidateAll(slug);

  // Schedule AI features (auto-tagging, SEO meta) after indexing
  if (config) {
    await scheduleAiFeatures(slug, rawMdx, frontmatter, config);
  }
}

// ── AI feature wiring (gated by agent.enabled + ai.enabled) ──

async function scheduleAiFeatures(
  slug: string,
  rawMdx: string,
  frontmatter: Record<string, unknown>,
  config: HypernextConfig
): Promise<void> {
  if (!(config.agent?.enabled && config.ai?.enabled)) {
    return;
  }

  try {
    const { schedule } = await import("../jobs/queue.js");

    // Auto-tagging: schedule if no tags are set
    const tags = frontmatter.tags;
    if (
      config.ai.features?.autoTagging &&
      (!Array.isArray(tags) || tags.length === 0)
    ) {
      await schedule("ai-text", {
        op: "suggestTags",
        slug,
        rawMdx,
        __config: config,
      });
    }

    // SEO meta: schedule if description is blank
    if (config.ai.features?.seoMeta && !frontmatter.description) {
      await schedule("ai-text", {
        op: "generateSeoMeta",
        slug,
        rawMdx,
        __config: config,
      });
    }
  } catch {
    // Jobs table may not exist (e.g., in tests or before initJobsTable is called)
    // Silently skip AI feature scheduling.
  }
}

export async function reindexAll(_config: HypernextConfig): Promise<void> {
  const storage = getStorage();
  const em = getEm();

  await em.nativeDelete(TermRelationship, {});
  await em.nativeDelete(Term, {});
  await em.nativeDelete(DocMeta, {});

  const slugs = await storage.list();
  let failedCount = 0;
  for (const slug of slugs) {
    try {
      const content = await storage.read(slug);
      await indexDocument(slug, content);
    } catch (err) {
      failedCount++;
      logger.error(`Failed to index document: ${slug}`, {
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failedCount > 0) {
    logger.warn(
      `Reindex complete with ${failedCount} failure(s) out of ${slugs.length} document(s)`
    );
  }
}

export function watchStorage(config: HypernextConfig): () => void {
  if (config.storage.type !== "local") {
    return () => undefined;
  }

  const storagePath = path.resolve(config.storage.local?.path ?? "./content");
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
    return () => undefined;
  }

  const watcher = fs.watch(
    storagePath,
    { recursive: true },
    async (eventType, filename) => {
      if (!(filename?.endsWith(".mdx") || filename?.endsWith(".md"))) {
        return;
      }

      const slug = filename
        .replace(MD_EXT_REGEX, "")
        .replace(BACKSLASH_REGEX, "/");
      const fullPath = path.join(storagePath, filename);

      if (eventType === "rename" && !fs.existsSync(fullPath)) {
        invalidateAll(slug);
        return;
      }

      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        // File may have been deleted between event and read
        return;
      }
      try {
        await indexDocument(slug, content);
      } catch (err) {
        logger.error("Failed to index document in watcher", {
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  return () => {
    watcher.close();
  };
}
