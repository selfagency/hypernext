import path from "node:path";

import { Command, Flags } from "@oclif/core";

export default abstract class BaseCommand extends Command {
  static hidden = true;

  static flags = {
    project: Flags.string({
      summary: "Project root directory",
      description:
        "Project root directory containing config.yml (default: current directory)",
      env: "HYPERNEXT_PROJECT",
    }),
  };

  getProjectDir(flags: { project?: string }): string {
    return flags.project ? path.resolve(flags.project) : process.cwd();
  }
}
