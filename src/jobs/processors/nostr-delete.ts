import { publishEvent } from "../../federation/nostr/relay.js";
import { createSigner } from "../../federation/nostr/signer.js";
import type { HypernextConfig } from "../../types/config.js";

const NUMBER_REGEX = /^\d+$/;

export async function processNostrDelete(
  payload: Record<string, unknown>
): Promise<{
  deletedEventId?: string;
  relayResults: Array<{
    url: string;
    ok: boolean;
    reason?: string;
  }>;
}> {
  const config = payload.__config as HypernextConfig | undefined;
  if (!config) {
    throw new Error("nostr-delete: __config is required");
  }

  const { initOrm, getEm } = await import("../../database/index.js");
  await initOrm(config.database.path);

  const slug = payload.slug as string;
  if (!slug) {
    throw new Error("nostr-delete: slug is required");
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
    return { relayResults: [] }; // already gone
  }

  // Parse frontmatter to find the naddr
  const frontmatter = parseFrontmatter(doc.rawMdx ?? "");
  const naddr = frontmatter.nostrNaddr as string | undefined;
  if (!naddr) {
    return { relayResults: [] }; // nothing to delete
  }

  // For deletion, we need the event id. We can:
  // 1. Look up the event id from a local cache (not implemented yet)
  // 2. Fetch from relays via filter (complex)
  // 3. Re-derive from parameters (not possible without the sig)
  //
  // Best-effort: publish a kind 5 event with the slug as reference.
  // The deletion event references the d-tag of the 30023, not the event id,
  // so we wrap it in a deletion that references the replaceable coordinate.

  const signer = createSigner(nostrConfig, {
    jwtSecret: config.jwtSecret ?? "",
  });
  const pubkey = await signer.getPublicKey();

  // Build a deletion event for the 30023 replaceable coordinate
  const tags = [
    ["a", `30023:${pubkey}:${slug}`],
    ["e", naddr],
  ];
  const deletionTemplate = {
    kind: 5,
    content: "Post deleted from Hypernext",
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };

  const { eventId, relayResults } = await publishEvent(
    nostrConfig.relays,
    deletionTemplate,
    signer
  );

  // Clear frontmatter fields
  let updatedMdx = updateFrontmatterField(doc.rawMdx ?? "", "nostrNaddr", "");
  updatedMdx = updateFrontmatterField(updatedMdx, "nostrPublishedAt", "");
  doc.rawMdx = updatedMdx;
  await em.flush();

  console.log(
    `[nostr] Deleted ${slug} → event ${eventId} (relays: ${relayResults.filter((r) => r.ok).length}/${relayResults.length} OK)`
  );

  return { deletedEventId: eventId, relayResults };
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
