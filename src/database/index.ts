import fs from "node:fs";
import path from "node:path";
import type { EntityManager } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/sqlite";
import { DocMeta } from "./entities/doc-meta.js";
import { OAuthToken } from "./entities/oauth-token.js";
import { Syndication } from "./entities/syndication.js";
import { Term } from "./entities/term.js";
import { TermRelationship } from "./entities/term-relationship.js";
import config from "./mikro-orm.config.js";

const FTS5_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, description, raw_mdx, content='docs_meta', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs_meta BEGIN INSERT INTO docs_fts(rowid, title, description, raw_mdx) VALUES (new.id, new.title, new.description, new.raw_mdx); END;
CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs_meta BEGIN INSERT INTO docs_fts(docs_fts, rowid, title, description, raw_mdx) VALUES ('delete', old.id, old.title, old.description, old.raw_mdx); END;
CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs_meta BEGIN INSERT INTO docs_fts(docs_fts, rowid, title, description, raw_mdx) VALUES ('delete', old.id, old.title, old.description, old.raw_mdx); INSERT INTO docs_fts(rowid, title, description, raw_mdx) VALUES (new.id, new.title, new.description, new.raw_mdx); END;`;

let ormInstance: MikroORM | null = null;

export async function initOrm(dbName?: string): Promise<MikroORM> {
  if (ormInstance) {
    return ormInstance;
  }

  // Ensure the db directory exists
  const resolvedDbName = dbName ?? config.dbName;
  if (resolvedDbName && resolvedDbName !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedDbName), { recursive: true });
  }

  ormInstance = await MikroORM.init({
    ...config,
    dbName: resolvedDbName,
  });
  await ormInstance.schema.ensureDatabase();
  try {
    await ormInstance.schema.create();
  } catch {
    // Tables already exist — schema is up to date
  }
  // Set pragmas for concurrent access (workmatic shares the same file)
  await ormInstance.em.getConnection().execute("PRAGMA busy_timeout = 5000");
  await ormInstance.em.getConnection().execute("PRAGMA journal_mode = WAL");
  await ormInstance.em.getConnection().execute("PRAGMA synchronous = NORMAL");
  // FTS5 virtual table + triggers (MikroORM doesn't support FTS5)
  await ormInstance.em.getConnection().executeDump(FTS5_SQL);
  return ormInstance;
}

export async function initVecTable(vectorDimensions: number): Promise<void> {
  const em = getEm();
  await em
    .getConnection()
    .execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(slug TEXT PRIMARY KEY, embedding FLOAT[${vectorDimensions}]);`
    );
}

export function getOrm(): MikroORM {
  if (!ormInstance) {
    throw new Error("ORM not initialized. Call initOrm() first.");
  }
  return ormInstance;
}

export function getEm(): EntityManager {
  return getOrm().em;
}

export async function closeOrm(): Promise<void> {
  if (ormInstance) {
    await ormInstance.close();
    ormInstance = null;
  }
}

// ── DocMeta CRUD ──

export async function insertDoc(row: {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  type?: string;
  layout?: string;
  canonicalUrl?: string;
  rawMdx?: string;
  irJson?: string;
  htmlCache?: string;
  gemtextCache?: string;
  gopherCache?: string;
  rssCache?: string;
  publishedAt?: string;
  order?: number;
  metaJson?: string;
  contentCid?: string;
  htmlCid?: string;
}): Promise<number> {
  const em = getEm();
  const existing = await em.findOne(DocMeta, { slug: row.slug });
  if (existing) {
    em.assign(existing, {
      title: row.title,
      description: row.description,
      date: row.date,
      type: row.type,
      layout: row.layout,
      canonicalUrl: row.canonicalUrl,
      rawMdx: row.rawMdx,
      irJson: row.irJson,
      htmlCache: row.htmlCache,
      gemtextCache: row.gemtextCache,
      gopherCache: row.gopherCache,
      rssCache: row.rssCache,
      publishedAt: row.publishedAt,
      order: row.order,
      metaJson: row.metaJson,
      contentCid: row.contentCid,
      htmlCid: row.htmlCid,
      updatedAt: new Date(),
      // biome-ignore lint/suspicious/noExplicitAny: MikroORM entity types are complex
    } as any);
    await em.flush();
    return existing.id;
  }
  const doc = em.create(DocMeta, {
    slug: row.slug,
    title: row.title,
    description: row.description,
    date: row.date,
    type: row.type,
    layout: row.layout,
    canonicalUrl: row.canonicalUrl,
    rawMdx: row.rawMdx,
    irJson: row.irJson,
    htmlCache: row.htmlCache,
    gemtextCache: row.gemtextCache,
    gopherCache: row.gopherCache,
    rssCache: row.rssCache,
    publishedAt: row.publishedAt,
    order: row.order,
    metaJson: row.metaJson,
    contentCid: row.contentCid,
    htmlCid: row.htmlCid,
    // biome-ignore lint/suspicious/noExplicitAny: MikroORM entity types are complex
  } as any);
  await em.flush();
  return doc.id;
}

export function getDocBySlug(
  slug: string
): Promise<Record<string, unknown> | null> {
  return getEm().findOne(DocMeta, { slug });
}

export async function listDocSlugs(
  includeFuture = false,
  limit?: number,
  offset?: number
): Promise<string[]> {
  const now = new Date().toISOString();
  const em = getEm();
  if (!includeFuture) {
    // Filter out docs where publishedAt > now AND date > now
    // We use raw SQL because the filter is complex (OR between two fields)
    let sql = `SELECT slug FROM docs_meta
         WHERE (published_at IS NULL OR published_at <= ?)
         AND (date IS NULL OR date <= ?)
         ORDER BY date DESC, id DESC`;
    const params: (string | number)[] = [now, now];
    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    if (offset !== undefined) {
      sql += " OFFSET ?";
      params.push(offset);
    }
    const rows = await em
      .getConnection()
      .execute<{ slug: string }[]>(sql, params);
    return rows.map((r: { slug: string }) => r.slug);
  }
  const docs = await em.find(
    DocMeta,
    {},
    {
      orderBy: { date: "DESC", id: "DESC" },
      fields: ["slug"],
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    }
  );
  return docs.map((d: Record<string, unknown>) => d.slug as string);
}

// ── FTS5 search (raw SQL required — FTS5 is a virtual table) ──

export async function searchDocs(
  query: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  const em = getEm();
  const rows = await em.getConnection().execute<{ id: number }[]>(
    `SELECT m.id FROM docs_fts f
     JOIN docs_meta m ON m.id = f.rowid
     WHERE docs_fts MATCH ?
     ORDER BY rank
     LIMIT ?`,
    [query, limit]
  );
  if (rows.length === 0) {
    return [];
  }
  return em.find(DocMeta, {
    id: { $in: rows.map((r: { id: number }) => r.id) },
  });
}

// ── Term CRUD ──

export async function upsertTerm(
  taxonomy: string,
  slug: string,
  name: string
): Promise<number> {
  const em = getEm();
  const existing = await em.findOne(Term, { taxonomy, slug });
  if (existing) {
    existing.name = name;
    await em.flush();
    return existing.id;
  }
  // biome-ignore lint/suspicious/noExplicitAny: MikroORM entity types are complex
  const term = em.create(Term, { taxonomy, slug, name } as any);
  await em.flush();
  return term.id;
}

export function getTermBySlug(
  taxonomy: string,
  slug: string
): Promise<Record<string, unknown> | null> {
  return getEm().findOne(Term, { taxonomy, slug });
}

export async function relateDocToTerm(
  docId: number,
  termId: number
): Promise<void> {
  const em = getEm();
  const existing = await em.findOne(TermRelationship, { docId, termId });
  if (existing) {
    return;
  }
  em.create(TermRelationship, { docId, termId });
  await em.flush();
}

export async function getTermsForDoc(
  docId: number,
  taxonomy: string
): Promise<Record<string, unknown>[]> {
  const em = getEm();
  const rels = await em.find(TermRelationship, { docId });
  if (rels.length === 0) {
    return [];
  }
  const termIds = rels.map((r: Record<string, unknown>) => r.termId as number);
  return em.find(Term, { id: { $in: termIds }, taxonomy });
}

// ── Syndication ──

export async function recordSyndication(record: {
  docId: number;
  platform: string;
  url: string;
}): Promise<void> {
  const em = getEm();
  em.create(Syndication, record);
  await em.flush();
}

export function getSyndicationForDoc(
  docId: number
): Promise<Record<string, unknown>[]> {
  return getEm().find(
    Syndication,
    { docId },
    { orderBy: { publishedAt: "DESC" } }
  );
}

// ── OAuth Tokens ──

export async function storeOAuthToken(token: {
  provider: string;
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}): Promise<void> {
  const em = getEm();
  em.create(OAuthToken, token);
  await em.flush();
}

export function getOAuthToken(
  provider: string
): Promise<Record<string, unknown> | null> {
  return getEm().findOne(
    OAuthToken,
    { provider },
    { orderBy: { createdAt: "DESC" } }
  );
}

export async function deleteOAuthToken(provider: string): Promise<void> {
  const em = getEm();
  const tokens = await em.find(OAuthToken, { provider });
  for (const t of tokens) {
    em.remove(t);
  }
  await em.flush();
}
