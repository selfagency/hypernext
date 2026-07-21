import crypto from "node:crypto";

import { Pageview } from "../database/entities/pageview.js";
import { getEm } from "../database/index.js";
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

export function hashVisitor(ip: string): string {
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
  let em: ReturnType<typeof getEm> | null = null;
  try {
    em = getEm();
  } catch {
    // ORM not initialized (e.g. remote mode) — skip analytics
    return;
  }
  try {
    const pv = em.create(Pageview, {
      slug,
      protocol,
      visitorHash: hashVisitor(ip),
      referrer: referrer ?? null,
      timestamp: Date.now(),
    });
    em.persist(pv);
    await em.flush();
  } catch (err) {
    // Analytics should never crash the server
    logger.warn(`Failed to record pageview: ${err}`);
  }
}

export async function getStats(query: StatsQuery): Promise<StatsResult> {
  const em = getEm();

  const days = query.days ?? 7;
  const since = Date.now() - days * 86_400_000;

  const where: Record<string, unknown> = { timestamp: { $gte: since } };
  if (query.slug) {
    where.slug = query.slug;
  }
  if (query.protocol) {
    where.protocol = query.protocol;
  }

  const rows = await em.find(Pageview, where);

  // Total views
  const totalViews = rows.length;

  // Unique visitors
  const uniqueVisitors = new Set(
    rows.map(
      (r) => (r as unknown as Record<string, unknown>).visitorHash as string
    )
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
      day.visitors.add(
        (row as unknown as Record<string, unknown>).visitorHash as string
      );
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
