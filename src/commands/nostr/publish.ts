import { Args } from "@oclif/core";
import { getConfig } from "../../config.js";
import {
  buildLongFormArticleEvent,
  rewriteInternalLinks,
} from "../../federation/nostr/events.js";
import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import BaseCommand from "../../lib/base-command.js";

const NUMBER_REGEX = /^\d+$/;

export default class NostrPublish extends BaseCommand {
  static readonly summary = "Syndicate a document to Nostr";

  static readonly args = {
    slug: Args.string({
      description: "Document slug to publish",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NostrPublish);
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

      const frontmatter = parseSimpleFrontmatter(doc.rawMdx ?? "");
      if (!frontmatter.nostr) {
        this.error(
          `Post "${args.slug}" does not have nostr: true in frontmatter`
        );
      }

      const publishedAt = frontmatter.nostrPublishedAt
        ? Number(frontmatter.nostrPublishedAt)
        : Math.floor(Date.now() / 1000);

      const tags = Array.isArray(frontmatter.tags)
        ? (frontmatter.tags as string[])
        : [];
      const allHashtags = [
        ...tags.map((t: string) => t.toLowerCase()),
        ...(nostrConfig.defaultHashtags ?? []),
      ];

      const content = rewriteInternalLinks(
        doc.rawMdx ?? "",
        config.site.canonicalBase
      );
      const eventTemplate = buildLongFormArticleEvent({
        slug: args.slug,
        title: doc.title ?? args.slug,
        summary: doc.description ?? undefined,
        contentMarkdown: content,
        hashtags: allHashtags,
        publishedAt,
      });

      const signer = createSigner(nostrConfig, {
        jwtSecret: config.jwtSecret ?? "",
      });
      const { relayResults } = await publishEvent(
        nostrConfig.relays,
        eventTemplate,
        signer
      );

      const okCount = relayResults.filter((r) => r.ok).length;
      this.log(
        `Published to Nostr: ${okCount}/${relayResults.length} relays OK`
      );
      for (const r of relayResults) {
        if (!r.ok) {
          this.log(`  ${r.url}: FAILED — ${r.reason ?? "unknown"}`);
        }
      }
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
