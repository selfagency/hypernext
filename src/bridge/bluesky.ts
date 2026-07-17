import { recordSyndication } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

export async function syndicateToBluesky(
  config: HypernextConfig,
  docId: number,
  slug: string,
  content: string
): Promise<void> {
  const bskyConfig = config.syndication.bluesky;
  if (!bskyConfig?.enabled) {
    return;
  }

  try {
    const { BskyAgent } = await import("@atproto/api");
    const agent = new BskyAgent({ service: bskyConfig.service });

    await agent.login({
      identifier: bskyConfig.identifier ?? "",
      password: bskyConfig.accessToken ?? "",
    });

    const url = `${config.site.canonicalBase}/${slug}`;
    const post = await agent.post({
      text: `${content}\n\n${url}`,
      createdAt: new Date().toISOString(),
    });

    const uri = post.uri;
    await recordSyndication({ docId, platform: "bluesky", url: uri });
  } catch (error) {
    console.error("Bluesky syndication error:", error);
  }
}
