import { Args } from "@oclif/core";
import { getConfig } from "../../config.js";
import BaseCommand from "../../lib/base-command.js";

const NUMBER_REGEX = /^\d+$/;

export default class NostrInspect extends BaseCommand {
  static readonly summary = "Display Nostr configuration";

  static readonly args = {
    slug: Args.string({
      description:
        "Optional slug to check Nostr status for a specific document",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NostrInspect);
    const rootDir = this.getProjectDir(flags);

    try {
      const config = getConfig(rootDir, {});
      const nostrConfig = config.syndication?.nostr;
      if (!nostrConfig?.enabled) {
        this.log("Nostr syndication is not enabled.");
        return;
      }

      this.logNostrConfig(nostrConfig);

      if (args.slug) {
        await this.logDocumentStatus(config, args.slug);
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }

  private logNostrConfig(
    nostrConfig: NonNullable<
      NonNullable<
        NonNullable<ReturnType<typeof getConfig>["syndication"]>["nostr"]
      >
    >
  ): void {
    this.log("Nostr Configuration:");
    this.log(`  Signer type: ${nostrConfig.signer.type}`);
    this.log(`  Relays (${nostrConfig.relays.length}):`);
    for (const relay of nostrConfig.relays) {
      this.log(`    - ${relay}`);
    }
    if (nostrConfig.profile) {
      this.log("  Profile:");
      if (nostrConfig.profile.name) {
        this.log(`    Name: ${nostrConfig.profile.name}`);
      }
      if (nostrConfig.profile.about) {
        this.log(`    About: ${nostrConfig.profile.about}`);
      }
      if (nostrConfig.profile.picture) {
        this.log(`    Picture: ${nostrConfig.profile.picture}`);
      }
      if (nostrConfig.profile.nip05) {
        this.log(`    NIP-05: ${nostrConfig.profile.nip05}`);
      }
    }
    if (nostrConfig.defaultHashtags?.length) {
      this.log(`  Default hashtags: ${nostrConfig.defaultHashtags.join(", ")}`);
    }
  }

  private async logDocumentStatus(
    config: ReturnType<typeof getConfig>,
    slug: string
  ): Promise<void> {
    try {
      const { initOrm, getEm } = await import("../../database/index.js");
      await initOrm(config.database.path);
      const { DocMeta } = await import("../../database/entities/doc-meta.js");
      const em = getEm();
      const doc = await em.findOne(DocMeta, { slug });
      if (doc) {
        const frontmatter = parseSimpleFrontmatter(doc.rawMdx ?? "");
        this.log(`\nDocument "${slug}":`);
        this.log(`  nostr: ${frontmatter.nostr === true ? "true" : "false"}`);
        if (frontmatter.nostrNaddr) {
          this.log(`  naddr: ${frontmatter.nostrNaddr}`);
        }
        if (frontmatter.nostrPublishedAt) {
          this.log(
            `  Published at: ${new Date(Number(frontmatter.nostrPublishedAt) * 1000).toISOString()}`
          );
        }
      } else {
        this.log(`\nDocument "${slug}": not found`);
      }
    } catch (err) {
      this.log(
        `\nCould not load document: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

function parseSimpleFrontmatter(rawMdx: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!rawMdx.startsWith("---")) {
    return result;
  }
  const endIdx = rawMdx.indexOf("---", 3);
  if (endIdx === -1) {
    return result;
  }
  const yamlBlock = rawMdx.slice(3, endIdx).trim();
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (NUMBER_REGEX.test(value as string)) {
      value = Number(value);
    }
    result[key] = value;
  }
  return result;
}
