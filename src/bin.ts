#! /usr/bin/env node

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

// Global options
cli.option("--config <path>", "Path to config file", {
  default: "config.yml",
});
cli.help();
cli.version("0.1.0");

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") {
    return;
  }
  return !(v === "0" || v === "false" || v === "no");
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") {
    return;
  }
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function envStr(name: string): string | undefined {
  return process.env[name] || undefined;
}

// Serve command — start all protocol servers
cli
  .command("serve", "Start protocol servers")
  .option("--port <port>", "Override HTTP server port")
  .option("--http", "Enable HTTP (default: from config)")
  .option("--gemini", "Enable Gemini (default: from config)")
  .option("--gopher", "Enable Gopher (default: from config)")
  .option("--spartan", "Enable Spartan (default: from config)")
  .option("--nex", "Enable NEX (default: from config)")
  .option("--finger", "Enable Finger (default: from config)")
  .option("--text", "Enable Text protocol (default: from config)")
  .option("--mcp", "Enable MCP (default: from config)")
  .action((options: Record<string, unknown>) => {
    // CLI flags take precedence, then env vars, then config defaults
    const cliOptions: CliOptions = {
      config:
        (options.config as string | undefined) ?? envStr("HYPERNEXT_CONFIG"),
      port:
        options.port === undefined
          ? envInt("HYPERNEXT_PORT")
          : Number(options.port),
      http: (options.http as boolean | undefined) ?? envBool("HYPERNEXT_HTTP"),
      gemini:
        (options.gemini as boolean | undefined) ?? envBool("HYPERNEXT_GEMINI"),
      gopher:
        (options.gopher as boolean | undefined) ?? envBool("HYPERNEXT_GOPHER"),
      spartan:
        (options.spartan as boolean | undefined) ??
        envBool("HYPERNEXT_SPARTAN"),
      nex: (options.nex as boolean | undefined) ?? envBool("HYPERNEXT_NEX"),
      finger:
        (options.finger as boolean | undefined) ?? envBool("HYPERNEXT_FINGER"),
      text: (options.text as boolean | undefined) ?? envBool("HYPERNEXT_TEXT"),
      mcp: (options.mcp as boolean | undefined) ?? envBool("HYPERNEXT_MCP"),
    };

    try {
      const config = getConfig(process.cwd(), cliOptions);
      startAllServers(config).catch((err) => {
        console.error("Server error:", err);
        process.exit(1);
      });
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

// Push command
cli.command("push", "Upload to production server").action(() => {
  const config = getConfig(process.cwd(), {} as CliOptions);
  pushToRemote(config, (msg) => console.log(msg)).catch((err) => {
    console.error("Push failed:", err);
    process.exit(1);
  });
});

// Sync command
cli.command("sync", "Sync with production server").action(() => {
  const config = getConfig(process.cwd(), {} as CliOptions);
  syncTwoWay(config, (msg) => console.log(msg)).catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
});

// Init command — scaffold a new Hypernext project
cli
  .command("init", "Scaffold a new project")
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
  .option("--collection <name>", "Target collection", { default: "library" })
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

cli.parse();
