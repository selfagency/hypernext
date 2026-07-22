import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Mention } from "../database/entities/mention.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

const VALID_SPAM_STATUSES = ["pending", "ham", "spam"];

export function registerModerationRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  // ── Comments API ──

  // GET /api/v1/comments — list comments with optional filters
  fastify.get("/api/v1/comments", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const status = query.status; // 'ham' | 'spam' | 'hidden' | 'all'
    const slug = query.slug;
    const limit = Math.min(Number(query.limit) || 50, 100);
    const offset = Number(query.offset) || 0;

    const em = getEm();
    const where: Record<string, unknown> = {};

    if (status === "hidden") {
      where.hidden = true;
    } else if (status && status !== "all") {
      where.spamStatus = status;
      where.hidden = false;
    } else if (!status || status === "all") {
      // No filter — return everything
    } else {
      where.spamStatus = status;
    }

    if (slug) {
      where.targetSlug = slug;
    }

    const mentions = await em.find(Mention, where, {
      limit,
      offset,
      orderBy: { publishedAt: "DESC" },
    });
    const total = await em.count(Mention, where);

    reply.send({ data: mentions, meta: { limit, offset, total } });
  });

  // PATCH /api/v1/comments/:id — update comment status (spam/ham)
  fastify.patch<{
    Params: { id: string };
    Body: { spam_status?: string };
  }>("/api/v1/comments/:id", async (request, reply) => {
    const { id } = request.params;
    const { spam_status } = request.body;

    if (!(spam_status && VALID_SPAM_STATUSES.includes(spam_status))) {
      reply.code(400).send({
        error: `Invalid spam_status. Must be one of: ${VALID_SPAM_STATUSES.join(", ")}`,
      });
      return;
    }

    const em = getEm();
    const mention = await em.findOne(Mention, { id });
    if (!mention) {
      reply.code(404).send({ error: "Comment not found" });
      return;
    }

    mention.spamStatus = spam_status;
    await em.flush();
    reply.send({ data: mention });
  });

  // POST /api/v1/comments/:id/hide — hide a comment
  fastify.post<{ Params: { id: string } }>(
    "/api/v1/comments/:id/hide",
    async (request, reply) => {
      const { id } = request.params;
      const em = getEm();
      const mention = await em.findOne(Mention, { id });
      if (!mention) {
        reply.code(404).send({ error: "Comment not found" });
        return;
      }

      mention.hidden = true;
      await em.flush();
      reply.send({ data: mention });
    }
  );

  // POST /api/v1/comments/:id/unhide — unhide a comment
  fastify.post<{ Params: { id: string } }>(
    "/api/v1/comments/:id/unhide",
    async (request, reply) => {
      const { id } = request.params;
      const em = getEm();
      const mention = await em.findOne(Mention, { id });
      if (!mention) {
        reply.code(404).send({ error: "Comment not found" });
        return;
      }

      mention.hidden = false;
      await em.flush();
      reply.send({ data: mention });
    }
  );

  // DELETE /api/v1/comments/:id — delete a comment
  fastify.delete<{ Params: { id: string } }>(
    "/api/v1/comments/:id",
    async (request, reply) => {
      const { id } = request.params;
      const em = getEm();
      const mention = await em.findOne(Mention, { id });
      if (!mention) {
        reply.code(404).send({ error: "Comment not found" });
        return;
      }

      await em.remove(mention).flush();
      reply.code(204).send();
    }
  );

  // ── Blocklist API ──

  // GET /api/v1/blocklist — list blocked items (merges config + DB)
  fastify.get("/api/v1/blocklist", async (_request, reply) => {
    const em = getEm();
    let dbEntries: { type: string; value: string }[] = [];
    try {
      dbEntries = await em
        .getConnection()
        .execute<{ type: string; value: string }[]>(
          "SELECT type, value FROM blocklist_entries ORDER BY created_at DESC"
        );
    } catch {
      // Table may not exist yet — that's fine
    }
    const configBlocklist = config.comments?.blocklist ?? {
      handles: [],
      domains: [],
      ips: [],
    };
    // Merge DB entries into config blocklist
    for (const entry of dbEntries) {
      const list = configBlocklist[entry.type as keyof typeof configBlocklist];
      if (Array.isArray(list) && !list.includes(entry.value)) {
        list.push(entry.value);
      }
    }
    reply.send({ data: configBlocklist });
  });

  // POST /api/v1/blocklist — add a blocked item
  fastify.post<{
    Body: { type: "handle" | "domain" | "ip"; value: string };
  }>("/api/v1/blocklist", async (request, reply) => {
    const { type, value } = request.body;
    if (!(type && value)) {
      reply.code(400).send({ error: "Missing type or value" });
      return;
    }

    if (!["handle", "domain", "ip"].includes(type)) {
      reply
        .code(400)
        .send({ error: "Invalid type. Must be: handle, domain, ip" });
      return;
    }

    const em = getEm();
    // Ensure the blocklist_entries table exists
    await em
      .getConnection()
      .execute(
        "CREATE TABLE IF NOT EXISTS blocklist_entries (id TEXT PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
      );
    const id = crypto.randomUUID();
    await em
      .getConnection()
      .execute(
        "INSERT OR IGNORE INTO blocklist_entries (id, type, value) VALUES (?, ?, ?)",
        [id, type, value]
      );
    reply.send({ data: { type, value }, status: "added" });
  });

  // DELETE /api/v1/blocklist — remove a blocked item
  fastify.delete<{
    Params: { type: string; value: string };
  }>("/api/v1/blocklist/:type/:value", async (request, reply) => {
    const { type, value } = request.params;
    if (!["handle", "domain", "ip"].includes(type)) {
      reply.code(400).send({ error: "Invalid type" });
      return;
    }

    const em = getEm();
    await em
      .getConnection()
      .execute("DELETE FROM blocklist_entries WHERE type = ? AND value = ?", [
        type,
        value,
      ]);
    reply.send({ data: { type, value }, status: "removed" });
  });

  // ── Legacy /api/v1/mentions routes (backward compat) ──

  // GET /api/v1/mentions — list mentions
  fastify.get("/api/v1/mentions", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const status = query.status;
    const slug = query.slug;
    const limit = Math.min(Number(query.limit) || 50, 100);
    const offset = Number(query.offset) || 0;

    const em = getEm();
    const where: Record<string, unknown> = {};
    if (status && VALID_SPAM_STATUSES.includes(status)) {
      where.spamStatus = status;
    }
    if (slug) {
      where.targetSlug = slug;
    }

    const mentions = await em.find(Mention, where, {
      limit,
      offset,
      orderBy: { publishedAt: "DESC" },
    });
    const total = await em.count(Mention, where);

    reply.send({ data: mentions, meta: { limit, offset, total } });
  });

  // PATCH /api/v1/mentions/:id — update mention status
  fastify.patch<{
    Params: { id: string };
    Body: { spam_status?: string };
  }>("/api/v1/mentions/:id", async (request, reply) => {
    const { id } = request.params;
    const { spam_status } = request.body;

    if (!(spam_status && VALID_SPAM_STATUSES.includes(spam_status))) {
      reply.code(400).send({
        error: `Invalid spam_status. Must be one of: ${VALID_SPAM_STATUSES.join(", ")}`,
      });
      return;
    }

    const em = getEm();
    const mention = await em.findOne(Mention, { id });
    if (!mention) {
      reply.code(404).send({ error: "Mention not found" });
      return;
    }

    mention.spamStatus = spam_status;
    await em.flush();
    reply.send({ data: mention });
  });

  // DELETE /api/v1/mentions/:id — delete a mention
  fastify.delete<{ Params: { id: string } }>(
    "/api/v1/mentions/:id",
    async (request, reply) => {
      const { id } = request.params;
      const em = getEm();
      const mention = await em.findOne(Mention, { id });
      if (!mention) {
        reply.code(404).send({ error: "Mention not found" });
        return;
      }

      await em.remove(mention).flush();
      reply.code(204).send();
    }
  );
}
