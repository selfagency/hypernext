import TurndownService from "turndown";
import { writeStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";

const turndown = new TurndownService({ headingStyle: "atx" });

const SCRIPT_TAG_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_TAG_REGEX = /<style[\s\S]*?<\/style>/gi;
const NAV_TAG_REGEX = /<nav[\s\S]*?<\/nav>/gi;
const FOOTER_TAG_REGEX = /<footer[\s\S]*?<\/footer>/gi;
const TITLE_TAG_REGEX = /<title>(.*?)<\/title>/i;
const H1_TAG_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

export interface IngestPayload {
  collection: string;
  filename: string;
  url: string;
}

export async function ingestUrl(
  payload: IngestPayload,
  _config: HypernextConfig,
  onProgress?: (msg: string) => void
): Promise<string> {
  const log =
    onProgress ??
    ((_msg: string) => {
      // No-op when no progress callback provided
    });
  const { url, collection, filename } = payload;

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

  // Extract title from <h1> or <title>
  const h1Match = html.match(H1_TAG_REGEX);
  const titleMatch = html.match(TITLE_TAG_REGEX);
  const title = h1Match?.[1] ?? titleMatch?.[1] ?? filename;

  const slug = `${collection}/${filename}`;
  const date = new Date().toISOString();
  const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${date}
type: ${collection === "blog" ? "post" : "page"}
source_url: "${url.replace(/"/g, '\\"')}"
---

`;
  const mdxContent = frontmatter + markdownBody;

  log(`Saving to ${slug}.mdx...`);
  await writeStorage(slug, mdxContent);

  return slug;
}
