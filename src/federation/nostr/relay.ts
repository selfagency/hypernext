import { SimplePool } from "nostr-tools";
import type { NostrSigner } from "./signer.js";

export interface RelayResult {
  ok: boolean;
  reason?: string;
  url: string;
}

/**
 * Publish a signed event to all configured relays.
 * Returns per-relay results. The job is considered successful
 * if at least one relay accepted the event.
 *
 * Uses nostr-tools' SimplePool for WebSocket management.
 * Each call opens fresh connections and closes them after a drain window.
 */
export async function publishEvent(
  relays: string[],
  eventTemplate: Record<string, unknown>,
  signer: NostrSigner
): Promise<{ eventId: string; relayResults: RelayResult[] }> {
  const pool = new SimplePool();
  const signed = await signer.signEvent(eventTemplate);
  const eventId = (signed as Record<string, unknown>).id as string;

  const results: RelayResult[] = await Promise.all(
    relays.map(async (url) => {
      try {
        await pool.publish(
          [url],
          signed as Parameters<SimplePool["publish"]>[1]
        );
        return { url, ok: true };
      } catch (err) {
        return {
          url,
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  // Close pool connections after a short drain window
  setTimeout(() => {
    pool.close(relays);
  }, 1000);

  return { eventId, relayResults: results };
}
