import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export async function verifyBearerToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = request.headers.authorization as string | undefined;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export function registerApiAuthGuard(fastify: FastifyInstance): void {
  fastify.addHook("onRequest", async (request: FastifyRequest, reply) => {
    if (!request.url.startsWith("/api/v1/")) {
      return;
    }

    await verifyBearerToken(request, reply);
  });
}
