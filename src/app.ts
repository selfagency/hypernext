import { registerAiRoutes } from "./api/ai.js";
import { registerApiAuthGuard } from "./api/auth.js";
import { registerModerationRoutes } from "./api/moderation.js";
import { registerNewsletterRoutes } from "./api/newsletter.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerStatsRoutes } from "./api/stats.js";
import { registerIndieAuthRoutes } from "./auth/indieauth.js";
import { registerInboundRoutes } from "./federation/inbound.js";
import { registerFederationRoutes } from "./federation/index.js";
import { initWorkmatic } from "./federation/workmatic.js";
import { registerMcpSseTransport, startMcpServer } from "./mcp/index.js";
import { registerMicropubEndpoint } from "./micropub/index.js";
import { startFingerServer } from "./servers/finger.js";
import { startGeminiServer } from "./servers/gemini.js";
import { startGopherServer } from "./servers/gopher.js";
import { createHttpServer } from "./servers/http.js";
import { startNexServer } from "./servers/nex.js";
import { startSpartanServer } from "./servers/spartan.js";
import { startTextServer } from "./servers/text.js";
import type { HypernextConfig } from "./types/config.js";
import { initLogger } from "./utils/logger.js";

export async function startAllServers(config: HypernextConfig): Promise<void> {
  const { protocols } = config;

  // Initialize logger
  initLogger(config);

  // Start MCP server (stdio transport)
  startMcpServer(config);

  // Initialize workmatic job queue
  initWorkmatic(config);

  // Start weekly digest cron if email is enabled
  if (config.email?.enabled && config.email.newsletter) {
    startDigestCron(config);
  }

  // Index all documents and watch for changes
  const { reindexAll, watchStorage } = await import("./indexer/index.js");
  await reindexAll(config);
  watchStorage(config);

  // Initialize vector table if AI is enabled
  if (config.ai?.enabled) {
    const { initVecTable } = await import("./database/index.js");
    await initVecTable(config.ai.vectorDimensions);
  }

  if (protocols.http.enabled) {
    const fastify = await createHttpServer(config);
    registerIndieAuthRoutes(fastify, config);
    registerApiAuthGuard(fastify);
    registerApiRoutes(fastify, config);
    registerModerationRoutes(fastify, config);
    registerNewsletterRoutes(fastify);
    registerStatsRoutes(fastify);
    registerMcpSseTransport(fastify, config);
    registerFederationRoutes(fastify, config);
    registerInboundRoutes(fastify, config);
    registerMicropubEndpoint(fastify, config);
    registerAiRoutes(fastify, config);
    fastify.listen({ port: protocols.http.port, host: "0.0.0.0" });
  }

  if (protocols.gemini.enabled) {
    startGeminiServer(config);
  }

  if (protocols.gopher.enabled) {
    startGopherServer(config);
  }

  if (protocols.spartan.enabled) {
    startSpartanServer(config);
  }

  if (protocols.nex.enabled) {
    startNexServer(config);
  }

  if (protocols.text.enabled) {
    startTextServer(config);
  }

  if (protocols.finger.enabled) {
    startFingerServer(config);
  }

  // Graceful shutdown on SIGTERM/SIGINT
  process.on("SIGTERM", () => {
    process.exit(0);
  });
  process.on("SIGINT", () => {
    process.exit(0);
  });
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

function startDigestCron(config: HypernextConfig): void {
  const email = config.email;
  if (!email?.newsletter) {
    return;
  }
  const schedule = email.newsletter.digestSchedule?.toLowerCase() ?? "friday";
  const timeStr = email.newsletter.digestTime ?? "09:00";
  const [hourStr, minuteStr] = timeStr.split(":");
  const targetHour = Number(hourStr) || 9;
  const targetMinute = Number(minuteStr) || 0;
  const targetDay = DAY_NAMES.indexOf(schedule);

  // Check every 60 seconds
  setInterval(async () => {
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
      const { getOrchestrator } = await import("./federation/workmatic.js");

      const em = getEm();
      const weeklySubs = await em.find(Subscriber, {
        frequency: "weekly",
        verified: true,
      });
      const slugs = await listDocSlugs();
      const docs = slugs.map((s: string) => ({ slug: s, title: s }));

      const orch = getOrchestrator();
      const client = orch.client("email-digest");
      for (const sub of weeklySubs) {
        await client.add(
          { subscriberId: (sub as Record<string, unknown>).id, docs },
          { maxAttempts: 2 }
        );
      }
    } catch {
      // Digest cron failures are non-fatal
    }
  }, 60_000);
}
