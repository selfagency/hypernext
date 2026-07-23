/**
 * Federated comments REST API routes.
 * Serves comments fetched from syndicated platforms.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type FederatedComment, getFederatedComments } from "../fetch/index.js";

export function registerFederatedCommentsRoutes(app: FastifyInstance): void {
  /**
   * GET /api/comments/federated/:slug
   *
   * Returns federated comments for a document by slug.
   */
  app.get<{
    Params: { slug: string };
    Querystring: {
      platforms?: string;
      timeout?: string;
    };
  }>(
    "/api/comments/federated/:slug",
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Querystring: { platforms?: string; timeout?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const { platforms, timeout } = request.query;

      try {
        const platformList = platforms
          ? (platforms.split(",") as Array<"bluesky" | "nostr" | "mastodon">)
          : undefined;

        const timeoutMs = timeout ? Number.parseInt(timeout, 10) : 5000;

        const comments = await getFederatedComments(slug, {
          platforms: platformList,
          timeoutMs,
        });

        return reply.send(comments);
      } catch (error) {
        request.log.error(error, "Failed to fetch federated comments");
        return reply.status(500).send({
          error: "Failed to fetch comments",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  /**
   * GET /api/comments/federated/:slug/count
   *
   * Returns just the comment count.
   */
  app.get<{ Params: { slug: string } }>(
    "/api/comments/federated/:slug/count",
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;

      try {
        const comments = await getFederatedComments(slug);

        // Filter out the root post (first item for Bluesky)
        const commentCount = comments.filter(
          (c: FederatedComment) => !(c as FederatedComment).isRootPost
        ).length;

        return reply.send({ count: commentCount });
      } catch (error) {
        request.log.error(error, "Failed to fetch federated comment count");
        return reply.status(500).send({
          error: "Failed to fetch comment count",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
}
