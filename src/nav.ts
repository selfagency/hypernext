import { DocMeta } from "./database/entities/doc-meta.js";
import { getEm } from "./database/index.js";
import type { HypernextConfig } from "./types/config.js";

export interface NavEntry {
  children?: NavEntry[];
  href: string;
  label: string;
  order: number;
}

export async function buildNav(config?: HypernextConfig): Promise<NavEntry[]> {
  const em = getEm();
  const rows = await em.find(DocMeta, {});

  // Show non-post pages (no collection slug, not type=post)
  const visible = rows
    .filter((row) => {
      const hasCollection = row.slug.indexOf("/") !== -1;
      if (hasCollection) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      label: row.title || row.slug,
      href: `/${row.slug}`,
      order: row.order ?? Number.POSITIVE_INFINITY,
    }));

  visible.sort((a, b) => compareOrder(a.order, b.order, a.label, b.label));

  const root: NavEntry = {
    label: "Home",
    href: "/",
    order: Number.NEGATIVE_INFINITY,
  };

  // Add collection roots from config
  const collections: NavEntry[] = [];
  if (config?.collections) {
    for (const [name, col] of Object.entries(config.collections)) {
      collections.push({
        label: name.charAt(0).toUpperCase() + name.slice(1),
        href: col.path,
        order: 100 + collections.length,
      });
    }
  }

  return [root, ...collections, ...visible];
}

function compareOrder(
  orderA: number,
  orderB: number,
  labelA: string,
  labelB: string
): number {
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return labelA.localeCompare(labelB);
}
