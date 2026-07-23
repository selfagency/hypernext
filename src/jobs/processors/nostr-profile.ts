import {
  buildProfileMetadataEvent,
  buildRelayListEvent,
} from "../../federation/nostr/events.js";
import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import type { HypernextConfig } from "../../types/config.js";

export async function processNostrProfile(
  payload: Record<string, unknown>
): Promise<{
  metadataEventId?: string;
  relayListEventId?: string;
  relayResults: Array<{
    url: string;
    ok: boolean;
    reason?: string;
  }>;
}> {
  const config = payload.__config as HypernextConfig | undefined;
  if (!config) {
    throw new Error("nostr-profile: __config is required");
  }

  const nostrConfig = config.syndication?.nostr;
  if (!nostrConfig?.enabled) {
    return { relayResults: [] };
  }

  const signer = createSigner(nostrConfig, {
    jwtSecret: config.jwtSecret ?? "",
  });

  // Build and publish kind 0 (profile metadata)
  const profileTemplate = buildProfileMetadataEvent({
    name: nostrConfig.profile?.name,
    about: nostrConfig.profile?.about,
    picture: nostrConfig.profile?.picture,
    nip05: nostrConfig.profile?.nip05,
  });

  const { eventId: metadataEventId, relayResults: metadataResults } =
    await publishEvent(nostrConfig.relays, profileTemplate, signer);

  // Build and publish kind 10002 (relay list — NIP-65)
  const relays = nostrConfig.relays.map((url) => ({
    url,
    read: true,
    write: true,
  }));
  const relayListTemplate = buildRelayListEvent({ relays });

  const { eventId: relayListEventId, relayResults: relayListResults } =
    await publishEvent(nostrConfig.relays, relayListTemplate, signer);

  // Merge results
  const allResults = [...metadataResults, ...relayListResults];

  console.log(
    `[nostr] Profile published (metadata: ${metadataEventId}, relayList: ${relayListEventId})`
  );

  return {
    metadataEventId,
    relayListEventId,
    relayResults: allResults,
  };
}
