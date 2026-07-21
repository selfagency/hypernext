#!/usr/bin/env node

import path from "node:path";
import cac from "cac";
import { startAllServers } from "./app.js";
import { getConfig } from "./config.js";
import { ingestUrl } from "./ingest/ingest-manager.js";
import { scaffoldInit } from "./init.js";
import { pushToRemote, syncTwoWay } from "./sync/sync-manager.js";
import type { CliOptions } from "./types/config.js";

// @ts-expect-error — cac ESM/CJS interop: the default export is callable at runtime
const cli = cac("hypernext");

cli
  .option("--config <path>", "Path to config file", { default: "config.yml" })
  .option("--port <port>", "Override HTTP server port")
  .option("--no-gemini", "Disable Gemini server")
  .option("--no-gopher", "Disable Gopher server")
  .help()
  .version("0.1.0");

// Push command
cli.command("push", "One-way upload to production server").action(() => {
  const config = getConfig(process.cwd(), {} as CliOptions);
  pushToRemote(config, (msg) => console.log(msg)).catch((err) => {
    console.error("Push failed:", err);
    process.exit(1);
  });
});

// Sync command
cli.command("sync", "Two-way sync with production server").action(() => {
  const config = getConfig(process.cwd(), {} as CliOptions);
  syncTwoWay(config, (msg) => console.log(msg)).catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
});

// Init command — scaffold a new Hypernext project
cli
  .command("init", "Scaffold a new Hypernext project")
  .option("--path <dir>", "Project directory (default: current directory)")
  .option("--force", "Overwrite existing files")
  .option("--no-agent-skill", "Skip OpenCode agent skill setup")
  .action(
    (options: { path?: string; force?: boolean; agentSkill?: boolean }) => {
      const projectDir = options.path
        ? path.resolve(options.path)
        : process.cwd();
      scaffoldInit(projectDir, {
        force: options.force ?? false,
        skipAgentSkill: options.agentSkill === false,
      });
    }
  );

// Ingest command
cli
  .command("ingest <url>", "Fetch a URL and convert to MDX")
  .option("--collection <name>", "Target collection (blog/library)", {
    default: "library",
  })
  .option("--filename <name>", "Output filename", { default: "ingested" })
  .action(
    (url: string, options: { collection?: string; filename?: string }) => {
      const config = getConfig(process.cwd(), {} as CliOptions);
      ingestUrl(
        {
          url,
          collection: options.collection ?? "library",
          filename: options.filename ?? "ingested",
        },
        config,
        (msg) => console.log(msg)
      )
        .then((slug) => console.log(`Ingested to ${slug}.mdx`))
        .catch((err) => {
          console.error("Ingest failed:", err);
          process.exit(1);
        });
    }
  );

const parsed = cli.parse();

// Default: start all servers (when no subcommand matched)
if (!parsed.command) {
  const options: CliOptions = {
    config: parsed.options.config,
    port:
      parsed.options.port === undefined
        ? undefined
        : Number(parsed.options.port),
    gemini: parsed.options.gemini,
    gopher: parsed.options.gopher,
  };

  try {
    const config = getConfig(process.cwd(), options);
    await startAllServers(config);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
