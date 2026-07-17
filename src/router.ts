import { DocMeta } from "./database/entities/doc-meta.js";
import { Term } from "./database/entities/term.js";
import { TermRelationship } from "./database/entities/term-relationship.js";
import { getEm, listDocSlugs } from "./database/index.js";
import type { HypernextConfig } from "./types/config.js";

const COLLECTION_SLUG_REGEX = /^\/(\w[\w-]*)\/(.+)$/;
const COLLECTION_ROOT_REGEX = /^\/(\w[\w-]*)$/;

export interface RouteMatch {
  collection?: string;
  slug?: string;
  taxonomy?: string;
  term?: string;
  type:
    | "home"
    | "doc"
    | "collection"
    | "taxonomy"
    | "feed"
    | "sitemap"
    | "health";
}

export function matchRoute(
  pathname: string,
  config: HypernextConfig
): RouteMatch | null {
  if (pathname === "/" || pathname === "") {
    return { type: "home" };
  }

  if (pathname === "/health") {
    return { type: "health" };
  }

  if (pathname === "/rss.xml") {
    return { type: "feed" };
  }

  if (pathname === "/sitemap.xml") {
    return { type: "sitemap" };
  }

  // /:collection/:slug
  const collectionMatch = pathname.match(COLLECTION_SLUG_REGEX);
  if (collectionMatch) {
    const collection = collectionMatch[1];
    const slug = collectionMatch[2];

    if (config.collections[collection]) {
      return { type: "doc", collection, slug: `${collection}/${slug}` };
    }

    return { type: "doc", collection, slug: `${collection}/${slug}` };
  }

  // /:collection
  const collectionRootMatch = pathname.match(COLLECTION_ROOT_REGEX);
  if (collectionRootMatch) {
    const collection = collectionRootMatch[1];
    if (config.collections[collection]) {
      return { type: "collection", collection };
    }
  }

  return null;
}

export async function getCollectionDocs(collection: string): Promise<string[]> {
  const slugs = await listDocSlugs();
  const prefix = `${collection}/`;
  return slugs.filter((slug) => slug.startsWith(prefix));
}

export async function getTaxonomyDocs(
  taxonomy: string,
  term: string
): Promise<string[]> {
  const em = getEm();
  const termEntity = await em.findOne(Term, { taxonomy, slug: term });
  if (!termEntity) {
    return [];
  }

  const rels = await em.find(TermRelationship, { termId: termEntity.id });
  if (rels.length === 0) {
    return [];
  }

  const docIds = rels.map((r) => r.docId);
  const docs = await em.find(
    DocMeta,
    { id: { $in: docIds } },
    { orderBy: { date: "DESC" }, fields: ["slug"] }
  );
  return docs.map((d) => d.slug);
}

export async function getArchiveDocs(
  year: number,
  month?: number
): Promise<string[]> {
  const em = getEm();
  const start = month
    ? new Date(year, month - 1, 1).toISOString()
    : new Date(year, 0, 1).toISOString();
  const end = month
    ? new Date(year, month, 0, 23, 59, 59).toISOString()
    : new Date(year + 1, 0, 1).toISOString();

  const docs = await em.find(
    DocMeta,
    { date: { $gte: start, $lt: end } },
    { orderBy: { date: "DESC" }, fields: ["slug", "title", "date"] }
  );
  return docs.map((d) => d.slug);
}

export async function getAuthorDocs(author: string): Promise<string[]> {
  const em = getEm();
  const docs = await em.find(
    DocMeta,
    { metaJson: { $like: `%"author"%` } },
    { orderBy: { date: "DESC" }, fields: ["slug"] }
  );
  // Filter in-memory since SQLite JSON filtering is limited
  const filtered = docs.filter((d) => {
    try {
      const meta = JSON.parse(
        ((d as Record<string, unknown>).metaJson as string) ?? "{}"
      );
      return String(meta.author ?? "").toLowerCase() === author.toLowerCase();
    } catch {
      return false;
    }
  });
  return filtered.map((d) => d.slug);
}
