import path from "node:path";

import { Command, Flags } from "@oclif/core";
import { startAllServers } from "../app.js";
import { getConfig } from "../config.js";
import type { CliOptions } from "../types/config.js";

export default class Serve extends Command {
  static summary = "Start protocol servers";
  static description =
    "Start all Hypernext protocol servers (HTTP, Gemini, Gopher, Spartan, NEX, Finger, Text, MCP)";

  static flags = {
    port: Flags.integer({
      summary: "Override HTTP server port",
      env: "HYPERNEXT_PORT",
    }),
    "serve-from": Flags.string({
      summary: "Project root directory",
      description:
        "Project root directory containing config.yml (default: current directory)",
      env: "HYPERNEXT_SERVE_FROM",
    }),
    http: Flags.boolean({
      summary: "Enable HTTP",
      description: "Enable HTTP server (default: from config)",
      allowNo: true,
      env: "HYPERNEXT_HTTP",
    }),
    gemini: Flags.boolean({
      summary: "Enable Gemini",
      allowNo: true,
      env: "HYPERNEXT_GEMINI",
    }),
    gopher: Flags.boolean({
      summary: "Enable Gopher",
      allowNo: true,
      env: "HYPERNEXT_GOPHER",
    }),
    spartan: Flags.boolean({
      summary: "Enable Spartan",
      allowNo: true,
      env: "HYPERNEXT_SPARTAN",
    }),
    nex: Flags.boolean({
      summary: "Enable NEX",
      allowNo: true,
      env: "HYPERNEXT_NEX",
    }),
    finger: Flags.boolean({
      summary: "Enable Finger",
      allowNo: true,
      env: "HYPERNEXT_FINGER",
    }),
    text: Flags.boolean({
      summary: "Enable Text protocol",
      allowNo: true,
      env: "HYPERNEXT_TEXT",
    }),
    mcp: Flags.boolean({
      summary: "Enable MCP",
      allowNo: true,
      env: "HYPERNEXT_MCP",
    }),
    config: Flags.string({
      summary: "Path to config file",
      default: "config.yml",
      env: "HYPERNEXT_CONFIG",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Serve);

    const cliOptions: CliOptions = {
      config: flags.config,
      port: flags.port,
      http: flags.http,
      gemini: flags.gemini,
      gopher: flags.gopher,
      spartan: flags.spartan,
      nex: flags.nex,
      finger: flags.finger,
      text: flags.text,
      mcp: flags.mcp,
    };

    const rootDir = flags["serve-from"]
      ? path.resolve(flags["serve-from"])
      : process.cwd();

    try {
      const config = getConfig(rootDir, cliOptions);
      await startAllServers(config);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
