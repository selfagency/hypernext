import { recordSyndication } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

export async function syndicateToMastodon(
  config: HypernextConfig,
  docId: number,
  slug: string,
  content: string
): Promise<void> {
  const mastodonConfig = config.syndication.mastodon;
  if (!mastodonConfig?.enabled) {
    return;
  }

  const url = `${config.site.canonicalBase}/${slug}`;
  // Mastodon default status limit is 500 chars; truncate content to fit
  const maxContentLength = 500 - url.length - 2;
  const truncated =
    content.length > maxContentLength
      ? `${content.slice(0, maxContentLength - 1)}…`
      : content;
  const status = `${truncated}\n\n${url}`;

  try {
    const response = await fetch(`${mastodonConfig.instance}/api/v1/statuses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mastodonConfig.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      console.error(`Mastodon syndication failed: ${response.status}`);
      return;
    }

    const data = (await response.json()) as { id: string; url: string };
    await recordSyndication({ docId, platform: "mastodon", url: data.url });
  } catch (error) {
    console.error("Mastodon syndication error:", error);
  }
}
