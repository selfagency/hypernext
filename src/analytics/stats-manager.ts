import crypto from "node:crypto";
import type { MikroORM } from "@mikro-orm/sqlite";
import { getOrm } from "../database/index.js";
import { logger } from "../utils/logger.js";

interface StatsQuery {
  days?: number;
  protocol?: string;
  slug?: string;
}

interface StatsResult {
  byProtocol: Record<string, number>;
  bySlug: Record<string, number>;
  daily: { date: string; views: number; uniques: number }[];
  totalViews: number;
  uniqueVisitors: number;
}

function hashVisitor(ip: string): string {
  const dateSalt = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(`${ip}:${dateSalt}`)
    .digest("hex")
    .slice(0, 16);
}

export async function recordPageview(
  slug: string,
  protocol: string,
  ip: string,
  referrer?: string
): Promise<void> {
  let orm: MikroORM;
  try {
    orm = getOrm();
  } catch {
    // ORM not initialized (e.g. remote mode) — skip analytics
    return;
  }
  try {
    const knex = orm.em.getConnection().getKnex();

    await knex("pageviews").insert({
      slug,
      protocol,
      visitor_hash: hashVisitor(ip),
      referrer: referrer ?? null,
      timestamp: Date.now(),
    });
  } catch (err) {
    // Analytics should never crash the server
    logger.warn(`Failed to record pageview: ${err}`);
  }
}

export async function getStats(query: StatsQuery): Promise<StatsResult> {
  const orm = getOrm();
  const knex = orm.em.getConnection().getKnex();

  const days = query.days ?? 7;
  const since = Date.now() - days * 86_400_000;

  let q = knex("pageviews").where("timestamp", ">=", since);
  if (query.slug) {
    q = q.where("slug", query.slug);
  }
  if (query.protocol) {
    q = q.where("protocol", query.protocol);
  }

  const rows = await q;

  // Total views
  const totalViews = rows.length;

  // Unique visitors
  const uniqueVisitors = new Set(
    rows.map((r: Record<string, unknown>) => r.visitor_hash as string)
  ).size;

  // By protocol
  const byProtocol: Record<string, number> = {};
  for (const row of rows) {
    const proto = row.protocol as string;
    byProtocol[proto] = (byProtocol[proto] ?? 0) + 1;
  }

  // By slug
  const bySlug: Record<string, number> = {};
  for (const row of rows) {
    const s = row.slug as string;
    bySlug[s] = (bySlug[s] ?? 0) + 1;
  }

  // Daily breakdown
  const dailyMap = new Map<string, { views: number; visitors: Set<string> }>();
  for (const row of rows) {
    const date = new Date(row.timestamp as number).toISOString().slice(0, 10);
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { views: 0, visitors: new Set() });
    }
    const day = dailyMap.get(date);
    if (day) {
      day.views++;
      day.visitors.add(row.visitor_hash as string);
    }
  }

  const daily: StatsResult["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const day = dailyMap.get(date);
    daily.push({
      date,
      views: day?.views ?? 0,
      uniques: day?.visitors.size ?? 0,
    });
  }

  return { totalViews, uniqueVisitors, byProtocol, bySlug, daily };
}
