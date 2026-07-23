import type { FastifyInstance } from "fastify";
import { indexDocument } from "../indexer/index.js";
import { getStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";
import { writePost } from "./utils.js";

/**
 * Transform a form-encoded Micropub body into the standard JSON properties format.
 *
 * Form-encoded: h=entry&name=Test&content=Hello&category=tag1&category=tag2
 * JSON equivalent: { type: ["h-entry"], properties: { name: ["Test"], content: ["Hello"], category: ["tag1", "tag2"] } }
 */
function formToMicropubJson(
  formBody: Record<string, unknown>
): Record<string, unknown> | null {
  const h = (formBody.h as string) ?? "entry";
  const properties: Record<string, unknown[]> = {};

  for (const [key, value] of Object.entries(formBody)) {
    if (key === "h" || key === "access_token") {
      continue;
    }
    if (Array.isArray(value)) {
      properties[key] = value;
    } else if (typeof value === "string") {
      properties[key] = [value];
    }
  }

  return {
    type: [`h-${h}`],
    properties,
  };
}

export function registerMicropubEndpoint(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  fastify.post("/micropub", async (request, reply) => {
    const auth = request.headers.authorization as string | undefined;
    if (!auth?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    const rawBody = request.body as Record<string, unknown> | undefined;
    if (!rawBody) {
      reply.code(400).send({ error: "Invalid request: empty body" });
      return;
    }

    // Handle both JSON (with .properties) and form-encoded (with .h) bodies
    const contentType = request.headers["content-type"] ?? "";
    let properties: Record<string, unknown[]>;

    if (rawBody.properties) {
      // JSON format: { type: ["h-entry"], properties: { ... } }
      properties = rawBody.properties as Record<string, unknown[]>;
    } else if (rawBody.h || contentType.includes("x-www-form-urlencoded")) {
      // Form-encoded format: { h: "entry", name: "...", content: "..." }
      const jsonBody = formToMicropubJson(rawBody);
      if (!jsonBody?.properties) {
        reply.code(400).send({ error: "Invalid form-encoded request" });
        return;
      }
      properties = jsonBody.properties as Record<string, unknown[]>;
    } else {
      reply.code(400).send({ error: "Invalid request: missing properties" });
      return;
    }

    const slug = await writePost(properties);

    // Re-index the new post
    const content = await getStorage().read(slug);
    await indexDocument(slug, content, config);
    reply
      .code(201)
      .header("Location", `${config.site.canonicalBase}/${slug}`)
      .send({ slug });
  });
}
