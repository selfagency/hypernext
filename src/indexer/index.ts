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
import { createStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";

const MDX_EXT_REGEX = /\.mdx$/;
const BACKSLASH_REGEX = /\\/g;

export async function indexDocument(
  slug: string,
  rawMdx: string
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
}

export async function reindexAll(config: HypernextConfig): Promise<void> {
  const storage = createStorage(config);
  const em = getEm();

  await em.nativeDelete(TermRelationship, {});
  await em.nativeDelete(Term, {});
  await em.nativeDelete(DocMeta, {});

  const slugs = await storage.list();
  for (const slug of slugs) {
    const content = await storage.read(slug);
    await indexDocument(slug, content);
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
    (eventType, filename) => {
      if (!filename?.endsWith(".mdx")) {
        return;
      }

      const slug = filename
        .replace(MDX_EXT_REGEX, "")
        .replace(BACKSLASH_REGEX, "/");
      const fullPath = path.join(storagePath, filename);

      if (eventType === "rename" && !fs.existsSync(fullPath)) {
        invalidateAll(slug);
        return;
      }

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        indexDocument(slug, content);
      } catch {
        // File may have been deleted between event and read
      }
    }
  );

  return () => {
    watcher.close();
  };
}
