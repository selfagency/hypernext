import type { HypernextConfig } from "../../types/config.js";

export async function processInboundMention(
  payload: Record<string, unknown>
): Promise<void> {
  // Re-initialize ORM in the worker thread
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as HypernextConfig | undefined;
  if (config) {
    await initOrm(config.database.path);
  }
  const { processInboundMention: mentionHandler } = await import(
    "../../federation/inbound.js"
  );
  await mentionHandler(
    payload.__config as HypernextConfig,
    payload as {
      source: string;
      target: string;
      ip: string;
      userAgent: string;
      type: "webmention" | "pingback" | "trackback";
    }
  );
}
