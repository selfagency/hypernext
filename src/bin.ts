#!/usr/bin/env node

import cac from "cac";
import { startAllServers } from "./app.js";
import { getConfig } from "./config.js";
import type { CliOptions } from "./types/config.js";

const cli = cac("hypernext");

cli
  .option("--config <path>", "Path to config file", { default: "config.yml" })
  .option("--port <port>", "Override HTTP server port")
  .option("--no-gemini", "Disable Gemini server")
  .option("--no-gopher", "Disable Gopher server")
  .help()
  .version("0.1.0");

const parsed = cli.parse();

function main(): void {
  const options: CliOptions = {
    config: parsed.options.config,
    port:
      parsed.options.port === undefined
        ? undefined
        : Number(parsed.options.port),
    gemini: parsed.options.gemini,
    gopher: parsed.options.gopher,
  };

  const config = getConfig(process.cwd(), options);
  startAllServers(config);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
