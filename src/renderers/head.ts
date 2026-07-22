import type { HypernextConfig } from "../types/config.js";
import { buildJsonLd } from "./json-ld.js";

const ALLOWED_META_KEYS = new Set([
  "ogTitle",
  "ogDescription",
  "ogImage",
  "ogImageAlt",
  "featuredImage",
  "featuredImageAlt",
  "description",
  "title",
  "canonicalUrl",
]);

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(text: string): string {
  return text.replaceAll('"', "&quot;").replaceAll("&", "&amp;");
}

function resolveMeta(
  frontmatter: Record<string, unknown>,
  config: HypernextConfig,
  key: string,
  configKey?: string
): string | undefined {
  if (!ALLOWED_META_KEYS.has(key)) {
    return;
  }
  const fm = frontmatter[key] as string | undefined;
  if (fm) {
    return fm;
  }
  if (configKey && !ALLOWED_META_KEYS.has(configKey)) {
    return;
  }
  const cfg = configKey
    ? config.site.meta[configKey as keyof typeof config.site.meta]
    : (config.site.meta as unknown as Record<string, string | undefined>)[key];
  return cfg as string | undefined;
}

function buildIpfsMetaTags(contentCid?: string, htmlCid?: string): string {
  if (!(contentCid || htmlCid)) {
    return "";
  }
  const tags: string[] = [];
  if (contentCid) {
    tags.push(`<meta name="ipfs-cid" content="${escapeAttr(contentCid)}" />`);
  }
  if (htmlCid) {
    tags.push(`<meta name="ipfs-html-cid" content="${escapeAttr(htmlCid)}" />`);
  }
  return `\n  ${tags.join("\n  ")}`;
}

function buildViewTransitionCss(config: HypernextConfig): string {
  if (!(config.agent?.enabled && config.agent.viewTransitions)) {
    return "";
  }
  return `\n  <style>
    @view-transition { navigation: auto; }
    main { view-transition-name: main-content; }
    header { view-transition-name: header; }
    ::view-transition-old(root) { animation: 0.3s ease-out both fade-out; }
    ::view-transition-new(root) { animation: 0.3s ease-in both fade-in; }
    @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  </style>`;
}

export interface BuildHeadOptions {
  cids?: { contentCid?: string; htmlCid?: string };
}

/** Build the complete <head> section with OG meta, JSON-LD, stylesheets */
export function buildHead(
  config: HypernextConfig,
  frontmatter: Record<string, unknown>,
  title: string,
  description: string,
  slug: string | undefined,
  pageUrl: string,
  options?: BuildHeadOptions
): string {
  const canonicalUrl =
    (frontmatter.canonicalUrl as string) ?? config.site.canonicalBase;
  const cssPath = config.site.theme?.cssPath ?? "";

  // OG meta resolution
  const ogTitle =
    resolveMeta(frontmatter, config, "ogTitle", "ogTitle") ?? title;
  const ogDescription =
    resolveMeta(frontmatter, config, "ogDescription", "ogDescription") ??
    description;
  const ogImage =
    resolveMeta(frontmatter, config, "ogImage", "ogImage") ??
    (frontmatter.featuredImage as string | undefined);
  const ogImageAlt =
    resolveMeta(frontmatter, config, "ogImageAlt", "ogImageAlt") ??
    (frontmatter.featuredImageAlt as string | undefined);
  const ogType = slug ? "article" : "website";

  const ogTags = [
    `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeAttr(ogDescription)}" />`,
    `<meta property="og:url" content="${escapeAttr(pageUrl)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:site_name" content="${escapeAttr(config.site.meta.title)}" />`,
  ];
  if (ogImage) {
    ogTags.push(
      `<meta property="og:image" content="${escapeAttr(ogImage)}" />`
    );
    if (ogImageAlt) {
      ogTags.push(
        `<meta property="og:image:alt" content="${escapeAttr(ogImageAlt)}" />`
      );
    }
  }

  const ipfsMetaTags = buildIpfsMetaTags(
    options?.cids?.contentCid,
    options?.cids?.htmlCid
  );
  const viewTransitionCss = buildViewTransitionCss(config);

  const jsonLd = buildJsonLd(config, frontmatter, slug);

  let cssHref = "";
  if (cssPath) {
    cssHref = cssPath.startsWith("/") ? cssPath : `/${cssPath}`;
  }
  const cssLink = cssHref
    ? `<link rel="stylesheet" href="${escapeAttr(cssHref)}" />`
    : "";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}" />${ipfsMetaTags}
  ${ogTags.join("\n  ")}
  ${jsonLd}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
  ${cssLink}
  ${viewTransitionCss}
</head>`;
}
