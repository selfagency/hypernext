import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";

export function registerAiRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  // AI routes require both agent.enabled (master toggle) and ai.enabled
  if (!(config.agent?.enabled && config.ai?.enabled)) {
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

      // Schedule the summary as a background job via the worker pool
      const { schedule } = await import("../jobs/queue.js");
      const jobId = await schedule("ai-text", {
        op: "summary",
        slug,
        rawMdx,
        __config: config,
      });

      reply.code(202).send({
        status: "processing",
        jobId,
        location: `/api/v1/jobs/${jobId}`,
      });
    }
  );

  // GET /api/v1/jobs/:jobId — poll job status
  fastify.get<{ Params: { jobId: string } }>(
    "/api/v1/jobs/:jobId",
    async (request, reply) => {
      const { jobId } = request.params;
      const { listJobs } = await import("../jobs/queue.js");
      const jobs = await listJobs({ limit: 1 });
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        reply.code(404).send({ error: "Job not found" });
        return;
      }
      reply.send({
        id: job.id,
        type: job.type,
        status: job.status,
        result: job.result ? JSON.parse(job.result) : undefined,
        error: job.error,
      });
    }
  );
}
