import type { FastifyReply } from "fastify";
import { getOAuthToken } from "../database/index.js";

export async function requireAuth(
  reply: FastifyReply,
  token: string | undefined
): Promise<boolean> {
  if (!token) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }

  const stored = await getOAuthToken("indieauth");
  if (!stored || stored.token !== token) {
    reply.code(401).send({ error: "Invalid token" });
    return false;
  }

  if (stored.expiresAt && new Date(stored.expiresAt) < new Date()) {
    reply.code(401).send({ error: "Token expired" });
    return false;
  }

  return true;
}
