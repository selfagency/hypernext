import { getConfig } from "../../config.js";
import {
  buildProfileMetadataEvent,
  buildRelayListEvent,
} from "../../federation/nostr/events.js";
import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import BaseCommand from "../../lib/base-command.js";

export default class NostrProfile extends BaseCommand {
  static readonly summary = "Publish Nostr profile metadata";

  async run(): Promise<void> {
    const { flags } = await this.parse(NostrProfile);
    const rootDir = this.getProjectDir(flags);

    try {
      const config = getConfig(rootDir, {});
      const nostrConfig = config.syndication?.nostr;
      if (!nostrConfig?.enabled) {
        this.error("Nostr syndication is not enabled in config");
      }

      const signer = createSigner(nostrConfig, {
        jwtSecret: config.jwtSecret ?? "",
      });

      // Publish kind 0 (profile)
      const profileTemplate = buildProfileMetadataEvent({
        name: nostrConfig.profile?.name,
        about: nostrConfig.profile?.about,
        picture: nostrConfig.profile?.picture,
        nip05: nostrConfig.profile?.nip05,
      });
      await publishEvent(nostrConfig.relays, profileTemplate, signer);
      this.log("Profile metadata (kind 0) published.");

      // Publish kind 10002 (relay list)
      const relays = nostrConfig.relays.map((url) => ({
        url,
        read: true,
        write: true,
      }));
      const relayListTemplate = buildRelayListEvent({ relays });
      await publishEvent(nostrConfig.relays, relayListTemplate, signer);
      this.log("Relay list (kind 10002) published.");
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
