import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/index.js";

export function registerApiAuthGuard(fastify: FastifyInstance): void {
  fastify.addHook("onRequest", async (request: FastifyRequest, reply) => {
    if (!request.url.startsWith("/api/v1/")) {
      return;
    }

    const auth = request.headers.authorization as string | undefined;
    const token = auth?.replace("Bearer ", "");
    const ok = await requireAuth(reply, token);
    if (!ok) {
      return;
    }
  });
}
