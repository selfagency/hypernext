import TurndownService from "turndown";
import { unfurl } from "unfurl.js";
import { validateSourceUrl } from "../federation/ssrf.js";
import { writeStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";
import {
  type DownloadedAsset,
  downloadImage,
  ensureAssetSubfolder,
  extractInlineImages,
  rewriteImageUrls,
} from "./assets.js";

const turndown = new TurndownService({ headingStyle: "atx" });

const SCRIPT_TAG_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_TAG_REGEX = /<style[\s\S]*?<\/style>/gi;
const NAV_TAG_REGEX = /<nav[\s\S]*?<\/nav>/gi;
const FOOTER_TAG_REGEX = /<footer[\s\S]*?<\/footer>/gi;
const TITLE_TAG_REGEX = /<title>(.*?)<\/title>/i;
const H1_TAG_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

export interface IngestPayload {
  collection: string;
  downloadMedia?: boolean;
  filename: string;
  url: string;
}

export interface IngestResult {
  assets: DownloadedAsset[];
  slug: string;
}

export async function ingestUrl(
  payload: IngestPayload,
  config: HypernextConfig,
  onProgress?: (msg: string) => void
): Promise<string> {
  const result = await ingestUrlWithMeta(payload, config, onProgress);
  return result.slug;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ingestion pipeline is inherently complex
export async function ingestUrlWithMeta(
  payload: IngestPayload,
  _config: HypernextConfig,
  onProgress?: (msg: string) => void
): Promise<IngestResult> {
  const log =
    onProgress ??
    ((_msg: string) => {
      // No-op when no progress callback provided
    });
  const { url, collection, filename, downloadMedia } = payload;

  // SSRF protection — reject private IPs and localhost
  if (!validateSourceUrl(url)) {
    throw new Error(`URL rejected by SSRF check: ${url}`);
  }

  log(`Fetching ${url}...`);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Hypernext/1.0" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status}`);
  }

  let html = await res.text();

  log("Cleaning HTML and converting to Markdown...");
  html = html
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(STYLE_TAG_REGEX, "")
    .replace(NAV_TAG_REGEX, "")
    .replace(FOOTER_TAG_REGEX, "");

  const markdownBody = turndown.turndown(html);

  // Extract metadata via unfurl.js
  log("Extracting metadata...");
  let meta: Record<string, unknown> = {};
  try {
    meta = (await unfurl(url)) as Record<string, unknown>;
  } catch {
    // Unfurl failure is non-fatal — continue with basic extraction
  }

  const openGraph = (meta.open_graph as Record<string, unknown>) ?? {};
  const twitterCard = (meta.twitter_card as Record<string, unknown>) ?? {};

  // Extract title from <h1>, <title>, or unfurl
  const h1Match = html.match(H1_TAG_REGEX);
  const titleMatch = html.match(TITLE_TAG_REGEX);
  const title =
    h1Match?.[1]?.trim() ??
    titleMatch?.[1]?.trim() ??
    (meta.title as string) ??
    (openGraph.title as string) ??
    filename;

  const description =
    (meta.description as string) ??
    (openGraph.description as string) ??
    (twitterCard.description as string) ??
    "";

  const ogImage =
    (openGraph.image as string) ?? (twitterCard.image as string) ?? "";

  const slug = `${collection}/${filename}`;
  const date = new Date().toISOString();
  const downloaded: DownloadedAsset[] = [];

  // Download media if requested
  if (downloadMedia) {
    const assetDir = ensureAssetSubfolder(slug);

    // Download featured image (og:image)
    if (ogImage) {
      log("Downloading featured image...");
      const localPath = await downloadImage(ogImage, assetDir, "featured");
      if (localPath) {
        downloaded.push({
          originalUrl: ogImage,
          localPath,
          type: "featured",
        });
      }
    }

    // Download inline images
    log("Downloading inline images...");
    const inlineUrls = extractInlineImages(markdownBody);
    let inlineCount = 0;
    for (const imgUrl of inlineUrls) {
      inlineCount++;
      const localPath = await downloadImage(
        imgUrl,
        assetDir,
        `inline-${inlineCount}`
      );
      if (localPath) {
        downloaded.push({
          originalUrl: imgUrl,
          localPath,
          type: "inline",
        });
      }
    }
  }

  // Rewrite image URLs in markdown if media was downloaded
  const finalBody =
    downloaded.length > 0
      ? rewriteImageUrls(markdownBody, "", downloaded)
      : markdownBody;

  // Build frontmatter with all extracted metadata
  const frontmatterLines = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${date}`,
    `type: ${collection === "blog" ? "post" : "page"}`,
    `source_url: "${url.replace(/"/g, '\\"')}"`,
  ];

  if (description) {
    frontmatterLines.push(`description: "${description.replace(/"/g, '\\"')}"`);
  }

  if (ogImage && !downloadMedia) {
    frontmatterLines.push(`featuredImage: "${ogImage.replace(/"/g, '\\"')}"`);
  } else if (downloaded.find((a) => a.type === "featured")) {
    const featured = downloaded.find((a) => a.type === "featured");
    if (featured) {
      frontmatterLines.push(`featuredImage: "${featured.localPath}"`);
    }
  }

  if (openGraph.title) {
    frontmatterLines.push(
      `ogTitle: "${String(openGraph.title).replace(/"/g, '\\"')}"`
    );
  }
  if (openGraph.description) {
    frontmatterLines.push(
      `ogDescription: "${String(openGraph.description).replace(/"/g, '\\"')}"`
    );
  }

  const keywords = meta.keywords as string | undefined;
  if (keywords) {
    frontmatterLines.push(
      `keywords: [${keywords
        .split(",")
        .map((k) => `"${k.trim()}"`)
        .join(", ")}]`
    );
  }

  frontmatterLines.push("---\n");

  const mdxContent = frontmatterLines.join("\n") + finalBody;

  log(`Saving to ${slug}.mdx...`);
  await writeStorage(slug, mdxContent);

  return { slug, assets: downloaded };
}
