import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import type tls from "node:tls";
import type { FastifyInstance } from "fastify";
import { registerAiRoutes } from "./api/ai.js";
import { registerApiAuthGuard } from "./api/auth.js";
import { registerModerationRoutes } from "./api/moderation.js";
import { registerNewsletterRoutes } from "./api/newsletter.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerStatsRoutes } from "./api/stats.js";
import { registerIndieAuthRoutes } from "./auth/indieauth.js";
import { registerInboundRoutes } from "./federation/inbound.js";
import { registerFederationRoutes } from "./federation/index.js";
import { registerMcpSseTransport, startMcpServer } from "./mcp/index.js";
import { registerMicropubEndpoint } from "./micropub/index.js";
import { startFingerServer } from "./servers/finger.js";
import { startGeminiServer } from "./servers/gemini.js";
import { startGopherServer } from "./servers/gopher.js";
import { createHttpServer } from "./servers/http.js";
import { startNexServer } from "./servers/nex.js";
import { startSpartanServer } from "./servers/spartan.js";
import { startTextServer } from "./servers/text.js";
import { createStorage } from "./storage/index.js";
import type { HypernextConfig } from "./types/config.js";
import { initLogger } from "./utils/logger.js";

export async function startAllServers(config: HypernextConfig): Promise<void> {
  const { protocols } = config;
  const servers: (net.Server | tls.Server | FastifyInstance)[] = [];

  // Initialize logger
  initLogger(config);

  // Ensure database directory exists before any database operations
  const dbPath = config.database.path;
  if (dbPath && dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  // Database initialisation is handled by the modules below
  const { initOrm, closeOrm } = await import("./database/index.js");
  await initOrm(config.database.path);

  // Initialize SQLite-backed job queue
  const { initJobsTable, recoverOrphanedJobs } = await import(
    "./jobs/queue.js"
  );
  await initJobsTable();
  await recoverOrphanedJobs();

  // Initialize piscina worker pool for background jobs
  const { startWorkerPool } = await import("./jobs/worker.js");
  await startWorkerPool("config.yml", config.database.path);

  // Initialize storage provider (must be available before any read/write operations)
  createStorage(config);

  // Start weekly digest cron if email is enabled
  let digestInterval: ReturnType<typeof setInterval> | null = null;
  if (config.email?.enabled && config.email.newsletter) {
    digestInterval = startDigestCron(config);
  }

  // Index all documents and watch for changes
  const { reindexAll, watchStorage } = await import("./indexer/index.js");
  await reindexAll(config);
  const unwatch = watchStorage(config);

  // Initialize vector table if agent + AI are both enabled
  if (config.agent?.enabled && config.ai?.enabled) {
    const { initVecTable } = await import("./database/index.js");
    await initVecTable(config.ai.vectorDimensions);
  }

  // Start MCP server (stdio transport) if agent features are enabled
  if (config.agent?.enabled && config.mcp?.transport === "stdio") {
    startMcpServer(config);
  }

  if (protocols.http.enabled) {
    const fastify = await createHttpServer(config);
    servers.push(fastify);
    registerIndieAuthRoutes(fastify, config);
    registerApiAuthGuard(fastify, config);
    registerApiRoutes(fastify, config);
    registerModerationRoutes(fastify, config);
    registerNewsletterRoutes(fastify);
    registerStatsRoutes(fastify);
    registerMcpSseTransport(fastify, config);
    registerFederationRoutes(fastify, config);
    registerInboundRoutes(fastify, config);
    registerMicropubEndpoint(fastify, config);
    registerAiRoutes(fastify, config);
    await fastify.listen({ port: protocols.http.port, host: "0.0.0.0" });
    const addr = fastify.addresses();
    console.log(
      `HTTP server listening on ${addr.map((a) => `${a.address}:${a.port}`).join(", ")}` // NOSONAR
    );
  }

  if (protocols.gemini.enabled) {
    servers.push(startGeminiServer(config));
  }

  if (protocols.gopher.enabled) {
    servers.push(startGopherServer(config));
  }

  if (protocols.spartan.enabled) {
    servers.push(startSpartanServer(config));
  }

  if (protocols.nex.enabled) {
    servers.push(startNexServer(config));
  }

  if (protocols.text.enabled) {
    servers.push(startTextServer(config));
  }

  if (protocols.finger.enabled) {
    servers.push(startFingerServer(config));
  }

  // Graceful shutdown on SIGTERM/SIGINT
  const shutdown = async () => {
    console.log("\nShutting down gracefully...");

    // Stop file watcher
    if (unwatch) {
      unwatch();
    }

    // Stop digest cron
    if (digestInterval) {
      clearInterval(digestInterval);
    }

    // Close all servers
    await Promise.allSettled(
      servers.map((s) => {
        if ("close" in s && typeof s.close === "function") {
          return new Promise<void>((resolve) => {
            s.close(() => resolve()); // NOSONAR
          });
        }
        return Promise.resolve();
      })
    );

    // Stop worker pool
    const { stopWorkerPool } = await import("./jobs/worker.js");
    stopWorkerPool();

    // Close ORM
    await closeOrm();

    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function startDigestCron(
  config: HypernextConfig
): ReturnType<typeof setInterval> | null {
  const email = config.email;
  if (!email?.newsletter) {
    return null;
  }
  const schedule = email.newsletter.digestSchedule?.toLowerCase() ?? "friday";
  const timeStr = email.newsletter.digestTime ?? "09:00";
  const [hourStr, minuteStr] = timeStr.split(":");
  const targetHour = Number(hourStr) || 9;
  const targetMinute = Number(minuteStr) || 0;
  const targetDay = DAY_NAMES.indexOf(schedule);

  // Check every 60 seconds
  return setInterval(async () => {
    const now = new Date();
    const dayName = DAY_NAMES[now.getDay()] ?? "";
    const matchesDay = targetDay === -1 || dayName === schedule;
    const matchesTime =
      now.getHours() === targetHour && now.getMinutes() === targetMinute;

    if (!(matchesDay && matchesTime)) {
      return;
    }

    try {
      const { getEm, listDocSlugs } = await import("./database/index.js");
      const { Subscriber } = await import("./database/entities/subscriber.js");
      const { schedule } = await import("./jobs/queue.js");

      const em = getEm();
      const weeklySubs = await em.find(Subscriber, {
        frequency: "weekly",
        verified: true,
      });
      const slugs = await listDocSlugs();
      const docs = slugs.map((s: string) => ({ slug: s, title: s }));

      for (const sub of weeklySubs) {
        await schedule("email-digest", {
          subscriberId: (sub as Record<string, unknown>).id,
          docs,
        });
      }
    } catch {
      // Digest cron failures are non-fatal
    }
  }, 60_000);
}
