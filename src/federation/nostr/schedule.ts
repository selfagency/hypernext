import { schedule } from "../../jobs/queue.js";

export function scheduleNostrPublish(
  slug: string,
  action: "create" | "update"
): Promise<string> {
  return schedule(
    "nostr-publish",
    { slug, action },
    { idempotencyKey: `nostr-publish:${slug}:${action}` }
  );
}

export function scheduleNostrDelete(slug: string): Promise<string> {
  return schedule(
    "nostr-delete",
    { slug },
    { idempotencyKey: `nostr-delete:${slug}` }
  );
}

export function scheduleNostrProfile(): Promise<string> {
  return schedule("nostr-profile", {}, { idempotencyKey: "nostr-profile" });
}
