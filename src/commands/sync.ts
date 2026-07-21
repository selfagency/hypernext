import { Command } from "@oclif/core";
import { getConfig } from "../config.js";
import { syncTwoWay } from "../sync/sync-manager.js";
import type { CliOptions } from "../types/config.js";

export default class Sync extends Command {
  static summary = "Sync with production server";

  async run(): Promise<void> {
    try {
      const config = getConfig(process.cwd(), {} as CliOptions);
      await syncTwoWay(config, (msg) => this.log(msg));
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
