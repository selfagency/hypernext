import { getConfig } from "../config.js";
import BaseCommand from "../lib/base-command.js";
import { syncTwoWay } from "../sync/sync-manager.js";
import type { CliOptions } from "../types/config.js";

export default class Sync extends BaseCommand {
  static summary = "Sync with production server";

  async run(): Promise<void> {
    const { flags } = await this.parse(Sync);
    try {
      const config = getConfig(this.getProjectDir(flags), {} as CliOptions);
      await syncTwoWay(config, (msg) => this.log(msg));
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
