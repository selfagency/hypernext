import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";
import { registerActivityPubRoutes } from "./activitypub.js";

export function registerFederationRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  registerActivityPubRoutes(fastify, config);
}
