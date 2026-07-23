import { getConfig } from "../../../config.js";
import BaseCommand from "../../../lib/base-command.js";

export default class NostrRelaysList extends BaseCommand {
  static readonly summary = "List configured Nostr relays";

  async run(): Promise<void> {
    const { flags } = await this.parse(NostrRelaysList);
    const rootDir = this.getProjectDir(flags);

    const config = getConfig(rootDir, {});
    const nostrConfig = config.syndication?.nostr;
    if (!nostrConfig?.enabled || nostrConfig.relays.length === 0) {
      this.log("No Nostr relays configured.");
      return;
    }

    this.log(`Nostr relays (${nostrConfig.relays.length}):`);
    for (const relay of nostrConfig.relays) {
      this.log(`  - ${relay}`);
    }
  }
}
