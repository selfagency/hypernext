import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";

export function registerAiRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  if (!config.ai?.enabled) {
    return;
  }

  // GET /api/v1/docs/:slug/summary — AI-generated summary
  fastify.get<{ Params: { slug: string } }>(
    "/api/v1/docs/:slug/summary",
    async (request, reply) => {
      const { slug } = request.params;

      const { getDocBySlug } = await import("../database/index.js");
      const doc = await getDocBySlug(slug);
      if (!doc) {
        reply.code(404).send({ error: "Not found" });
        return;
      }

      const rawMdx = (doc.rawMdx as string) ?? "";
      const { generateSummary } = await import("../federation/ai-tasks.js");

      try {
        const summary = await generateSummary(config, rawMdx);
        reply.send({ data: { slug, summary } });
      } catch {
        reply.code(503).send({ error: "AI service unavailable" });
      }
    }
  );
}
