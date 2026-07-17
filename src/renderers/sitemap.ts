import { getDocBySlug, listDocSlugs } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

const TRAILING_SLASH_REGEX = /\/+$/;

export async function renderSitemap(config: HypernextConfig): Promise<string> {
  const slugs = await listDocSlugs();
  const base = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");

  const entries: string[] = [];
  for (const slug of slugs) {
    const doc = await getDocBySlug(slug);
    if (!doc) {
      continue;
    }

    const lastmod =
      (doc.date as string) ?? (doc.publishedAt as string) ?? undefined;
    const type = (doc.type as string) ?? "page";
    const priority = type === "post" ? "0.8" : "0.5";
    const changefreq = type === "post" ? "monthly" : "weekly";

    entries.push("  <url>");
    entries.push(`    <loc>${base}/${slug}</loc>`);
    if (lastmod) {
      entries.push(`    <lastmod>${lastmod}</lastmod>`);
    }
    entries.push(`    <changefreq>${changefreq}</changefreq>`);
    entries.push(`    <priority>${priority}</priority>`);
    entries.push("  </url>");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;
}
