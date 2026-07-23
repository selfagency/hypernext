import type { McpTool } from "../../mcp/tools.js";
import type { HypernextConfig } from "../../types/config.js";
import { scheduleNostrDelete, scheduleNostrPublish } from "./schedule.js";

const NUMBER_REGEX = /^\d+$/;

/**
 * Create Nostr MCP tools.
 * Gated by syndication.nostr.enabled only (per D2 — not gated by agent.enabled).
 */
export function createNostrTools(config: HypernextConfig): McpTool[] {
  const nostrConfig = config.syndication?.nostr;
  if (!nostrConfig?.enabled) {
    return [];
  }

  const relayCount = nostrConfig.relays.length;
  const relaysSummary =
    relayCount > 0
      ? `Configured relays (${relayCount}): ${nostrConfig.relays.slice(0, 3).join(", ")}${relayCount > 3 ? "…" : ""}`
      : "No relays configured";

  return [
    {
      name: "nostr_publish",
      description: `Publish (or re-publish) a document to Nostr as a kind 30023 long-form article. ${relaysSummary}`,
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Document slug to syndicate",
          },
        },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        if (!slug) {
          return {
            content: [{ type: "text", text: "Error: slug is required" }],
          };
        }
        const jobId = await scheduleNostrPublish(slug, "create");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "scheduled", jobId, slug },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "nostr_delete",
      description: `Delete a document from Nostr (publishes a kind 5 deletion event). ${relaysSummary}`,
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Document slug to remove from Nostr",
          },
        },
        required: ["slug"],
      },
      async handler(args) {
        const slug = String(args.slug ?? "");
        if (!slug) {
          return {
            content: [{ type: "text", text: "Error: slug is required" }],
          };
        }
        const jobId = await scheduleNostrDelete(slug);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "scheduled", jobId, slug },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "nostr_inspect",
      description:
        "View the Nostr configuration: npub, configured relays, and profile info.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description:
              "Optional slug to check Nostr status for a specific document",
          },
        },
      },
      async handler(args) {
        const slug = args.slug ? String(args.slug) : undefined;

        const info: Record<string, unknown> = {
          relayCount,
          relays: nostrConfig.relays,
          profile: nostrConfig.profile,
          signerType: nostrConfig.signer.type,
        };

        if (slug) {
          info.slug = slug;
          // Load document to check frontmatter
          try {
            const { DocMeta } = await import(
              "../../database/entities/doc-meta.js"
            );
            const { getEm } = await import("../../database/index.js");
            const doc = await getEm().findOne(DocMeta, { slug });
            if (doc) {
              const frontmatter = parseSimpleFrontmatter(doc.rawMdx ?? "");
              info.nostrEnabled = frontmatter.nostr === true;
              info.nostrNaddr = frontmatter.nostrNaddr ?? null;
              info.nostrPublishedAt = frontmatter.nostrPublishedAt ?? null;
            } else {
              info.error = `Document not found: ${slug}`;
            }
          } catch (err) {
            info.error = err instanceof Error ? err.message : String(err);
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        };
      },
    },
  ];
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
