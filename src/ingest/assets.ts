import fs from "node:fs";
import path from "node:path";
import { validateSourceUrl } from "../federation/ssrf.js";

const ASSETS_BASE = "assets";
const INGESTED_DIR = "ingested";

const IMG_MARKDOWN_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;
const IMG_HTML_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
const EXT_REGEX = /\.(\w+)(?:\?.*)?$/;

export interface DownloadedAsset {
  localPath: string;
  originalUrl: string;
  type: "featured" | "inline" | "enclosure";
}

export function ensureAssetSubfolder(slug: string): string {
  const dir = path.join(ASSETS_BASE, INGESTED_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensurePostAssetSubfolder(
  slug: string,
  type: "posts" | "pages"
): string {
  const dir = path.join(ASSETS_BASE, type, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractExtension(url: string): string {
  const match = url.match(EXT_REGEX);
  return match?.[1] ?? "bin";
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function downloadImage(
  imageUrl: string,
  destDir: string,
  name: string
): Promise<string | null> {
  if (!validateSourceUrl(imageUrl)) {
    return null;
  }

  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Hypernext/1.0" },
    });

    if (!res.ok) {
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = extractExtension(imageUrl);
    const filename = `${sanitizeFilename(name)}.${ext}`;
    const filePath = path.join(destDir, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch {
    return null;
  }
}

export function extractInlineImages(markdown: string): string[] {
  const urls: string[] = [];

  const mdRegex = new RegExp(IMG_MARKDOWN_REGEX.source, "g");
  for (
    let mdMatch = mdRegex.exec(markdown);
    mdMatch !== null;
    mdMatch = mdRegex.exec(markdown)
  ) {
    urls.push(mdMatch[2] ?? "");
  }

  const htmlRegex = new RegExp(IMG_HTML_REGEX.source, "gi");
  for (
    let htmlMatch = htmlRegex.exec(markdown);
    htmlMatch !== null;
    htmlMatch = htmlRegex.exec(markdown)
  ) {
    urls.push(htmlMatch[1] ?? "");
  }

  return [...new Set(urls)];
}

export function rewriteImageUrls(
  markdown: string,
  _assetDir: string,
  downloaded: DownloadedAsset[]
): string {
  let result = markdown;

  for (const asset of downloaded) {
    if (asset.type !== "inline") {
      continue;
    }
    const escapedUrl = asset.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mdPattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedUrl}\\)`, "g");
    result = result.replace(mdPattern, `![$1](${asset.localPath})`);

    const htmlPattern = new RegExp(
      `(<img[^>]+src=["'])${escapedUrl}(["'][^>]*>)`,
      "gi"
    );
    result = result.replace(htmlPattern, `$1${asset.localPath}$2`);
  }

  return result;
}
