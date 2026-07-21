import { Args, Flags } from "@oclif/core";
import { getConfig } from "../config.js";
import { ingestUrl } from "../ingest/ingest-manager.js";
import type { CliOptions } from "../types/config.js";
import BaseCommand from "./base.js";

export default class Ingest extends BaseCommand {
  static summary = "Fetch a URL and convert to MDX";
  static description = "Fetch a remote URL and convert its content to MDX";

  static args = {
    url: Args.string({ description: "URL to fetch", required: true }),
  };

  static flags = {
    ...BaseCommand.flags,
    collection: Flags.string({
      summary: "Target collection",
      default: "library",
    }),
    filename: Flags.string({
      summary: "Output filename",
      default: "ingested",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Ingest);
    const config = getConfig(this.getProjectDir(flags), {} as CliOptions);
    try {
      const slug = await ingestUrl(
        {
          url: args.url,
          collection: flags.collection,
          filename: flags.filename,
        },
        config,
        (msg: string) => this.log(msg)
      );
      this.log(`Ingested to ${slug}.mdx`);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
