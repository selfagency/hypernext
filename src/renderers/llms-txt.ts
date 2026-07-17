import { getDocBySlug, listDocSlugs } from "../database/index.js";
import { isDocPrivate } from "../parser/frontmatter.js";
import type { HypernextConfig } from "../types/config.js";

const TRAILING_SLASH_REGEX = /\/+$/;

export async function renderLlmsTxt(config: HypernextConfig): Promise<string> {
  const slugs = await listDocSlugs();
  const base = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");
  const lines: string[] = [];

  lines.push(`# ${config.site.meta.title}`);
  lines.push(`> ${config.site.meta.description}`);
  lines.push("");

  // Group by collection
  const grouped: Record<
    string,
    { slug: string; title: string; description?: string }[]
  > = {};
  for (const slug of slugs) {
    const doc = await getDocBySlug(slug);
    if (!doc) {
      continue;
    }

    // Skip private documents
    if (isDocPrivate((doc.rawMdx as string) ?? "")) {
      continue;
    }

    const parts = slug.split("/");
    const collection = parts.length > 1 ? parts[0] : "root";
    if (!grouped[collection]) {
      grouped[collection] = [];
    }
    grouped[collection].push({
      slug,
      title: (doc.title as string) ?? slug,
      description: (doc.description as string) ?? undefined,
    });
  }

  for (const [collection, docs] of Object.entries(grouped)) {
    lines.push(`## ${collection}`);
    lines.push("");
    for (const doc of docs) {
      const url = `${base}/${doc.slug}`;
      if (doc.description) {
        lines.push(`- [${doc.title}](${url}): ${doc.description}`);
      } else {
        lines.push(`- [${doc.title}](${url})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
