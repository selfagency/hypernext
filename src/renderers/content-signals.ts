import type { FastifyReply } from "fastify";
import type { HypernextConfig } from "../types/config.js";

export function addContentSignalHeader(
  reply: FastifyReply,
  config: HypernextConfig
): void {
  if (!(config.agent?.enabled && config.agent.contentSignals.enabled)) {
    return;
  }

  const cs = config.agent.contentSignals;
  const parts: string[] = [];
  if (cs.aiTrain !== undefined) {
    parts.push(`ai-train=${cs.aiTrain ? "yes" : "no"}`);
  }
  if (cs.search !== undefined) {
    parts.push(`search=${cs.search ? "yes" : "no"}`);
  }
  if (cs.aiInput !== undefined) {
    parts.push(`ai-input=${cs.aiInput ? "yes" : "no"}`);
  }

  if (parts.length > 0) {
    reply.header("Content-Signal", parts.join(", "));
  }
}
