import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../../types/config.js";

/**
 * Register Waline proxy routes for embedded Waline UI.
 * Proxies /comments-api/* → Waline /api/* and /comments-admin/* → Waline /ui/*
 */
export function registerWalineProxyRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  const waline = config.comments?.waline;
  if (!waline?.enabled) {
    return;
  }

  const mode = waline.mode ?? "embedded";
  if (mode !== "embedded") {
    return; // No proxy needed for external mode
  }

  const walineUrl = `http://127.0.0.1:${waline.port ?? 8360}`;

  // Proxy /comments-api/* → Waline /api/*
  fastify.get<{ Params: { "*": string } }>(
    "/comments-api/*",
    async (request, reply) => {
      const path = (request.params as { "*": string })["*"] ?? "";
      const url = new URL(
        `/api/${path}${request.url.includes("?") ? `?${new URL(request.url).search}` : ""}`,
        walineUrl
      );

      try {
        const response = await fetch(url.toString());
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          reply.send(data);
        } else {
          const text = await response.text();
          reply.type(contentType).send(text);
        }
      } catch {
        reply.code(502).send({ error: "Waline unavailable" });
      }
    }
  );

  // Proxy /comments-admin/* → Waline /ui/*
  fastify.get<{ Params: { "*": string } }>(
    "/comments-admin/*",
    async (request, reply) => {
      const path = (request.params as { "*": string })["*"] ?? "";

      try {
        const url = new URL(`/ui/${path}`, walineUrl);
        const response = await fetch(url.toString());
        const text = await response.text();
        reply.type("text/html").send(text);
      } catch {
        reply.code(502).send({ error: "Waline unavailable" });
      }
    }
  );
}

/**
 * Register Waline comment management REST endpoints.
 * These proxy to the Waline server but provide Hypernext-managed URLs.
 */
export function registerWalineApiRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  const waline = config.comments?.waline;
  if (!waline?.enabled) {
    return;
  }

  const mode = waline.mode ?? "embedded";
  const walineUrl =
    mode === "embedded"
      ? `http://127.0.0.1:${waline.port ?? 8360}`
      : waline.serverURL;

  if (!walineUrl) {
    return;
  }

  // GET /api/comments/:path — list comments for a path
  fastify.get<{
    Params: { path: string };
    Querystring: { page?: string; limit?: string };
  }>("/api/comments/:path(*)", async (request, reply) => {
    const path = `/${request.params.path}`;
    const page = request.query.page ?? "1";
    const limit = request.query.limit ?? "10";

    try {
      const url = new URL("/api/comment", walineUrl);
      url.searchParams.set("type", "list");
      url.searchParams.set("path", path);
      url.searchParams.set("page", page);
      url.searchParams.set("limit", limit);

      const response = await fetch(url.toString());
      const data = await response.json();
      reply.send(data);
    } catch (err) {
      reply.code(502).send({
        error: "Waline unavailable",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /api/comments/:path/count — comment count for a path
  fastify.get<{ Params: { path: string } }>(
    "/api/comments/:path(*)/count",
    async (request, reply) => {
      const path = `/${request.params.path}`;

      try {
        const url = new URL("/api/comment", walineUrl);
        url.searchParams.set("type", "count");
        url.searchParams.set("path", path);

        const response = await fetch(url.toString());
        const count = await response.json();
        reply.send({ path, count });
      } catch {
        reply.code(502).send({
          error: "Waline unavailable",
        });
      }
    }
  );

  // PUT /api/comments/:commentId — update comment status (moderate)
  fastify.put<{ Params: { commentId: string }; Body: { status?: string } }>(
    "/api/comments/:commentId",
    async (request, reply) => {
      const { commentId } = request.params;
      const { status } = request.body ?? {};

      if (!(status && ["approved", "waiting", "spam"].includes(status))) {
        reply.code(400).send({
          error: "Invalid status. Must be: approved, waiting, or spam",
        });
        return;
      }

      try {
        const url = new URL("/api/comment", walineUrl);
        const response = await fetch(url.toString(), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId, status }),
        });

        const data = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          reply.code(response.status).send(data);
          return;
        }
        reply.send({ success: true, commentId, status, ...data });
      } catch {
        reply.code(502).send({
          error: "Waline unavailable",
        });
      }
    }
  );

  // DELETE /api/comments/:commentId — delete a comment
  fastify.delete<{ Params: { commentId: string } }>(
    "/api/comments/:commentId",
    async (request, reply) => {
      const { commentId } = request.params;

      try {
        const url = new URL("/api/comment", walineUrl);
        url.searchParams.set("commentId", commentId);

        const response = await fetch(url.toString(), {
          method: "DELETE",
        });

        if (!response.ok) {
          const data = await response.json();
          reply.code(response.status).send(data);
          return;
        }
        reply.send({ success: true, commentId });
      } catch {
        reply.code(502).send({
          error: "Waline unavailable",
        });
      }
    }
  );
}
