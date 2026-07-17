import type { FastifyInstance } from "fastify";
import { getStats } from "../analytics/stats-manager.js";

export function registerStatsRoutes(fastify: FastifyInstance): void {
  // GET /api/v1/stats/overview — site-wide totals
  fastify.get("/api/v1/stats/overview", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const stats = await getStats({ days: Number(query.days) || 7 });
    return reply.send(stats);
  });

  // GET /api/v1/stats — per-slug or filtered stats
  fastify.get("/api/v1/stats", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const stats = await getStats({
      days: Number(query.days) || 7,
      slug: query.slug ?? undefined,
      protocol: query.protocol ?? undefined,
    });
    return reply.send(stats);
  });
}
