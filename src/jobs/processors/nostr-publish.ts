import { nip19 } from "nostr-tools";
import { recordSyndication } from "../../database/index.js";
import {
  buildLongFormArticleEvent,
  rewriteInternalLinks,
} from "../../federation/nostr/events.js";
import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import type { HypernextConfig } from "../../types/config.js";

const NUMBER_REGEX = /^\d+$/;

export async function processNostrPublish(
  payload: Record<string, unknown>
): Promise<{
  naddr?: string;
  relayResults: Array<{
    url: string;
    ok: boolean;
    reason?: string;
  }>;
}> {
  const config = payload.__config as HypernextConfig | undefined;
  if (!config) {
    throw new Error("nostr-publish: __config is required");
  }

  const { initOrm, getEm } = await import("../../database/index.js");
  await initOrm(config.database.path);

  const slug = payload.slug as string;
  if (!slug) {
    throw new Error("nostr-publish: slug is required");
  }

  const nostrConfig = config.syndication?.nostr;
  if (!nostrConfig?.enabled) {
    return { relayResults: [] };
  }

  // Load the document
  const { DocMeta } = await import("../../database/entities/doc-meta.js");
  const em = getEm();
  const doc = await em.findOne(DocMeta, { slug });
  if (!doc) {
    throw new Error(`Document not found: ${slug}`);
  }

  // Check per-post opt-in
  const frontmatter = parseFrontmatter(doc.rawMdx ?? "");
  if (!frontmatter.nostr) {
    return { relayResults: [] }; // skipped — not opted in
  }

  // Check scheduledAt — don't syndicate future posts
  if (frontmatter.scheduledAt) {
    const scheduled = new Date(frontmatter.scheduledAt as string).getTime();
    if (scheduled > Date.now()) {
      return { relayResults: [] }; // skipped — not yet visible
    }
  }

  // Determine publishedAt — use existing or current
  const existingPublishedAt = frontmatter.nostrPublishedAt;
  const publishedAt = existingPublishedAt
    ? Number(existingPublishedAt)
    : Math.floor(Date.now() / 1000);

  // Build hashtags from frontmatter tags + config defaults
  const tags = Array.isArray(frontmatter.tags)
    ? (frontmatter.tags as string[])
    : [];
  const defaultHashtags = nostrConfig.defaultHashtags ?? [];
  const allHashtags = [
    ...tags.map((t: string) => t.toLowerCase()),
    ...defaultHashtags,
  ];

  // Rewrite internal links
  const content = rewriteInternalLinks(
    doc.rawMdx ?? "",
    config.site.canonicalBase
  );

  // Build the 30023 event
  const eventTemplate = buildLongFormArticleEvent({
    slug,
    title: doc.title ?? slug,
    summary: doc.description ?? undefined,
    contentMarkdown: content,
    hashtags: allHashtags,
    publishedAt,
  });

  // Sign and publish
  const signer = createSigner(nostrConfig, {
    jwtSecret: config.jwtSecret ?? "",
  });

  const { relayResults } = await publishEvent(
    nostrConfig.relays,
    eventTemplate,
    signer
  );

  // Compute naddr for the permalink
  const pubkey = await signer.getPublicKey();
  const naddr = nip19.naddrEncode({
    pubkey,
    kind: 30_023,
    identifier: slug,
    relays: nostrConfig.defaultRelayHints,
  });

  // Persist nostr metadata to frontmatter
  const updatedMdx = updateFrontmatterField(
    doc.rawMdx ?? "",
    "nostrNaddr",
    naddr
  );
  const updatedWithPublishedAt = updateFrontmatterField(
    updatedMdx,
    "nostrPublishedAt",
    String(publishedAt)
  );

  // Update the document in DB
  doc.rawMdx = updatedWithPublishedAt;
  await em.flush();

  console.log(
    `[nostr] Published ${slug} → ${naddr} (relays: ${relayResults.filter((r) => r.ok).length}/${relayResults.length} OK)`
  );

  // Store naddr in Syndication table for comment fetching
  await recordSyndication({
    docId: doc.id,
    platform: "nostr",
    url: naddr,
  });

  return { naddr, relayResults };
}

function parseFrontmatter(rawMdx: string): Record<string, unknown> {
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
    } else if ((value as string).startsWith("[")) {
      try {
        value = JSON.parse(value as string);
      } catch {
        // keep as string
      }
    }

    result[key] = value;
  }
  return result;
}

function updateFrontmatterField(
  rawMdx: string,
  key: string,
  value: string
): string {
  if (!rawMdx.startsWith("---")) {
    return rawMdx;
  }

  const endIdx = rawMdx.indexOf("---", 3);
  if (endIdx === -1) {
    return rawMdx;
  }

  const yamlBlock = rawMdx.slice(3, endIdx);
  const rest = rawMdx.slice(endIdx);

  const lineRegex = new RegExp(`^${key}:\\s*.*$`, "m");
  const newYamlBlock = lineRegex.test(yamlBlock)
    ? yamlBlock.replace(lineRegex, `${key}: ${value}`)
    : `${yamlBlock.trimEnd()}\n${key}: ${value}`;

  return `---${newYamlBlock}${rest}`;
}
