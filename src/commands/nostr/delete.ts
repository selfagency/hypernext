import { Args } from "@oclif/core";
import { getConfig } from "../../config.js";
import { buildDeletionEvent } from "../../federation/nostr/events.js";
import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import BaseCommand from "../../lib/base-command.js";

const NUMBER_REGEX = /^\d+$/;

export default class NostrDelete extends BaseCommand {
  static readonly summary = "Delete a document from Nostr";

  static readonly args = {
    slug: Args.string({
      description: "Document slug to remove from Nostr",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NostrDelete);
    const rootDir = this.getProjectDir(flags);

    try {
      const config = getConfig(rootDir, {});
      const nostrConfig = config.syndication?.nostr;
      if (!nostrConfig?.enabled) {
        this.error("Nostr syndication is not enabled in config");
      }

      const { initOrm, getEm } = await import("../../database/index.js");
      await initOrm(config.database.path);

      const { DocMeta } = await import("../../database/entities/doc-meta.js");
      const em = getEm();
      const doc = await em.findOne(DocMeta, { slug: args.slug });
      if (!doc) {
        this.error(`Document not found: ${args.slug}`);
      }

      const signer = createSigner(nostrConfig, {
        jwtSecret: config.jwtSecret ?? "",
      });

      const frontmatter = parseSimpleFrontmatter(doc.rawMdx ?? "");
      const naddr = frontmatter.nostrNaddr as string | undefined;
      const pubkey = await signer.getPublicKey();

      const deletionTemplate = buildDeletionEvent({
        targetEventId: naddr ?? args.slug,
        reason: "Deleted from Hypernext",
      });

      // Override tags for replaceable coordinate deletion
      deletionTemplate.tags = [
        ...(deletionTemplate.tags as string[][]),
        ["a", `30023:${pubkey}:${args.slug}`],
      ];

      const { eventId, relayResults } = await publishEvent(
        nostrConfig.relays,
        deletionTemplate,
        signer
      );

      this.log(
        `Delete event published: ${eventId} (${relayResults.filter((r) => r.ok).length}/${relayResults.length} relays OK)`
      );
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
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
    if (key === "nostrNaddr") {
      result[key] = line.slice(colonIdx + 1).trim();
    } else {
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
  }
  return result;
}
