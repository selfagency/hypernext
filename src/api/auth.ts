import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HypernextConfig } from "../types/config.js";

// Public-read paths: public docs, collections, AI summaries, MCP SSE
const PUBLIC_READ_PATHS = [
  /^\/api\/v1\/docs$/,
  /^\/api\/v1\/docs\/[^/]+$/,
  /^\/api\/v1\/collections\/[^/]+$/,
  /^\/api\/v1\/collections\/[^/]+\/posts$/,
  /^\/api\/v1\/docs\/[^/]+\/summary$/,
  /^\/api\/v1\/mcp$/,
];

// Public-write paths: email subscription, verification, unsubscribe, contact form
const PUBLIC_WRITE_PATHS = new Set([
  "/api/v1/subscribe",
  "/api/v1/subscribe/verify",
  "/api/v1/subscribe/unsubscribe",
  "/api/v1/contact",
  "/api/v1/mcp/message",
]);

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

function isPublicReadPath(path: string): boolean {
  return PUBLIC_READ_PATHS.some((re) => re.test(path));
}

function isPublicWritePath(path: string): boolean {
  return PUBLIC_WRITE_PATHS.has(path);
}

export function registerApiAuthGuard(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  fastify.addHook("onRequest", async (request: FastifyRequest, reply) => {
    const rawUrl = request.url;
    if (!rawUrl.startsWith("/api/v1/")) {
      return;
    }

    const path = rawUrl.split("?")[0] ?? "";

    // Public-write endpoints are always open (subscribe, unsubscribe, contact)
    if (isPublicWritePath(path)) {
      return;
    }

    // Public-read endpoints (GET only) are open by default, but can be tightened
    if (
      request.method === "GET" &&
      isPublicReadPath(path) &&
      !config.api?.requireAuthForPublicRead
    ) {
      return;
    }

    await verifyBearerToken(request, reply);
  });
}
