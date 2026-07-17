import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/index.js";
import { indexDocument } from "../indexer/index.js";
import { createStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";
import { writePost } from "./utils.js";

export function registerMicropubEndpoint(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  fastify.post("/micropub", async (request, reply) => {
    const auth = request.headers.authorization as string | undefined;
    const token = auth?.replace("Bearer ", "");
    if (!(await requireAuth(reply, token))) {
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    if (!body?.properties) {
      reply.code(400).send({ error: "Invalid request: missing properties" });
      return;
    }

    const properties = body.properties as Record<string, unknown[]>;
    const slug = await writePost(config, properties);

    // Re-index the new post
    const storage = createStorage(config);
    const content = await storage.read(slug);
    await indexDocument(slug, content);

    reply
      .code(201)
      .header("Location", `${config.site.canonicalBase}/${slug}`)
      .send({ slug });
  });
}
