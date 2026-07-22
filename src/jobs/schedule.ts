/**
 * Migration layer: provides the same enqueue*() API as the old workmatic
 * module, but backed by the new SQLite job queue.
 *
 * Import these from call sites instead of importing from workmatic directly.
 */
import { schedule } from "./queue.js";

export async function enqueueInboundMention(payload: {
  source: string;
  target: string;
  ip: string;
  userAgent: string;
  type: "webmention" | "pingback" | "trackback";
  excerpt?: string;
  title?: string;
  blogName?: string;
}): Promise<string> {
  return schedule(
    "inbound-mentions",
    payload as unknown as Record<string, unknown>,
    {
      maxAttempts: 3,
    }
  );
}

export async function enqueuePosseReplyFetch(
  slug: string,
  docId: number,
  platform: "mastodon" | "bluesky"
): Promise<string> {
  return schedule(
    "posse-replies",
    { slug, docId, platform },
    {
      maxAttempts: 2,
    }
  );
}

export async function enqueueOutboundSyndication(
  docId: number,
  slug: string,
  content: string
): Promise<string> {
  return schedule(
    "outbound-syndication",
    { docId, slug, content },
    {
      maxAttempts: 3,
    }
  );
}

export async function enqueueIndexing(
  slug: string,
  rawMdx: string
): Promise<string> {
  return schedule(
    "indexing",
    { slug, rawMdx },
    {
      maxAttempts: 2,
    }
  );
}

export async function enqueuePdfGeneration(slug: string): Promise<string> {
  return schedule("pdf-generation", { slug }, { maxAttempts: 2 });
}

export async function enqueueEpubGeneration(
  collectionName: string
): Promise<string> {
  return schedule("epub-generation", { collectionName }, { maxAttempts: 2 });
}

export async function enqueueIpfsPinning(slug: string): Promise<string> {
  return schedule("ipfs-pinning", { slug }, { maxAttempts: 3 });
}
