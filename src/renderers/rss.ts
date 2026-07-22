import { getDocBySlug, listDocSlugs } from "../database/index.js";
import { extractFrontmatter, isDocPrivate } from "../parser/frontmatter.js";
import { parseToIR } from "../parser/pipeline.js";
import type { HypernextConfig } from "../types/config.js";
import { renderHTMLBody } from "./html.js";

interface RssEnclosure {
  length?: number;
  type?: string;
  url: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseEnclosures(value: unknown): RssEnclosure[] {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      url: String(item.url ?? ""),
      type: item.type ? String(item.type) : undefined,
      length: typeof item.length === "number" ? item.length : undefined,
    }))
    .filter((item) => item.url.length > 0);
}

function buildGuid(
  config: HypernextConfig,
  slug: string,
  date: string
): string {
  const host = new URL(config.site.canonicalBase).host;
  const datePart = date
    ? new Date(date).toISOString().slice(0, 10).replace(/-/g, "")
    : "";
  return `tag:${host},${datePart}:${slug}`;
}

export async function renderRSS(
  config: HypernextConfig,
  limit = 20
): Promise<string> {
  const slugs = (await listDocSlugs()).slice(0, limit);

  const items: string[] = [];
  for (const slug of slugs) {
    const doc = await getDocBySlug(slug);
    if (!doc?.rawMdx) {
      continue;
    }

    const rawMdx = doc.rawMdx as string;

    if (isDocPrivate(rawMdx)) {
      continue;
    }

    const docType =
      (doc.type as string | undefined) ??
      extractFrontmatter(rawMdx).attributes.type;
    if (docType !== "post") {
      continue;
    }

    const { attributes } = extractFrontmatter(rawMdx);
    const title = (doc.title as string | undefined) ?? slug;
    const link = `${config.site.canonicalBase}/${slug}`;
    const date =
      (doc.date as string | undefined) ??
      (doc.publishedAt as string | undefined) ??
      "";
    const guid = buildGuid(config, slug, date);
    const result = parseToIR(rawMdx, slug);
    const bodyContent = renderHTMLBody(result.ir);
    const enclosures = parseEnclosures(
      attributes.enclosure ?? attributes.enclosures
    );
    const enclosureXml = enclosures
      .map(
        (enc) =>
          `<enclosure url="${escapeXml(enc.url)}" type="${escapeXml(enc.type ?? "application/octet-stream")}" length="${enc.length ?? 0}" />`
      )
      .join("\n      ");

    items.push(`    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <description>${escapeXml(bodyContent)}</description>
      ${date ? `<pubDate>${escapeXml(new Date(date).toUTCString())}</pubDate>` : ""}
      ${enclosureXml}
    </item>`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.site.meta.title)}</title>
    <link>${escapeXml(config.site.canonicalBase)}</link>
    <description>${escapeXml(config.site.meta.description)}</description>
    <atom:link href="${escapeXml(config.site.canonicalBase)}/rss.xml" rel="self" type="application/rss+xml" />
${items.join("\n")}
  </channel>
</rss>`;
}
