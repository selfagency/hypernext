import path from "node:path";

import { Command, Flags } from "@oclif/core";
import { scaffoldInit } from "../init.js";

export default class Init extends Command {
  static summary = "Scaffold a new project";
  static description = "Create a new Hypernext project with default structure";

  static flags = {
    path: Flags.string({
      summary: "Project directory",
      description: "Project directory (default: current directory)",
    }),
    force: Flags.boolean({
      summary: "Overwrite existing files",
    }),
    "agent-skill": Flags.boolean({
      summary: "Set up OpenCode agent skill",
      description: "Set up OpenCode agent skill (default: true)",
      allowNo: true,
      default: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    const projectDir = flags.path ? path.resolve(flags.path) : process.cwd();
    scaffoldInit(projectDir, {
      force: flags.force ?? false,
      skipAgentSkill: flags["agent-skill"] === false,
    });
  }
}
