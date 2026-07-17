import { getSyndicationForDoc } from "../database/index.js";
import { enqueueOutboundSyndication } from "../federation/workmatic.js";
import type { HypernextConfig } from "../types/config.js";

export function shouldSyndicate(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.type === "post";
}

export async function syndicate(
  config: HypernextConfig,
  docId: number,
  slug: string,
  content: string
): Promise<void> {
  const existing = await getSyndicationForDoc(docId);
  const alreadySyndicated = new Set(existing.map((r) => r.platform as string));

  const hasPendingTarget =
    (config.syndication.mastodon?.enabled &&
      !alreadySyndicated.has("mastodon")) ||
    (config.syndication.bluesky?.enabled && !alreadySyndicated.has("bluesky"));

  if (!hasPendingTarget) {
    return;
  }

  // Enqueue as a background job — the worker handles both platforms
  await enqueueOutboundSyndication(docId, slug, content);
}
