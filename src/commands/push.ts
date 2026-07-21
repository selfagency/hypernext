import { Command } from "@oclif/core";
import { getConfig } from "../config.js";
import { pushToRemote } from "../sync/sync-manager.js";
import type { CliOptions } from "../types/config.js";

export default class Push extends Command {
  static summary = "Upload to production server";

  async run(): Promise<void> {
    try {
      const config = getConfig(process.cwd(), {} as CliOptions);
      await pushToRemote(config, (msg) => this.log(msg));
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
