import { getConfig } from "../config.js";
import { pushToRemote } from "../sync/sync-manager.js";
import type { CliOptions } from "../types/config.js";
import BaseCommand from "./base.js";

export default class Push extends BaseCommand {
  static summary = "Upload to production server";

  async run(): Promise<void> {
    const { flags } = await this.parse(Push);
    try {
      const config = getConfig(this.getProjectDir(flags), {} as CliOptions);
      await pushToRemote(config, (msg) => this.log(msg));
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
