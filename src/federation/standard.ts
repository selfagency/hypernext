import type { HypernextConfig } from "../types/config.js";

export async function publishStandardSite(
  config: HypernextConfig,
  slug: string,
  content: string
): Promise<void> {
  const bskyConfig = config.syndication.bluesky;
  if (!(bskyConfig?.standardSite && bskyConfig?.enabled)) {
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
    await agent.post({
      text: content,
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: url,
          title: config.site.meta.title,
          description: config.site.meta.description,
        },
      },
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Standard.site publishing error:", error);
  }
}
