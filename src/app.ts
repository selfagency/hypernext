import { registerApiAuthGuard } from "./api/auth.js";
import { registerModerationRoutes } from "./api/moderation.js";
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

export function startAllServers(config: HypernextConfig): void {
  const { protocols } = config;

  // Initialize logger
  initLogger(config);

  // Start MCP server (stdio transport)
  startMcpServer(config);

  // Initialize workmatic job queue
  initWorkmatic(config);

  if (protocols.http.enabled) {
    const fastify = createHttpServer(config);
    registerIndieAuthRoutes(fastify, config);
    registerApiAuthGuard(fastify);
    registerApiRoutes(fastify, config);
    registerModerationRoutes(fastify, config);
    registerStatsRoutes(fastify);
    registerMcpSseTransport(fastify, config);
    registerFederationRoutes(fastify, config);
    registerInboundRoutes(fastify, config);
    registerMicropubEndpoint(fastify, config);
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
}
