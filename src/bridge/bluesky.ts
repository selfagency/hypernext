import { recordSyndication } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

// Module-level BskyAgent singleton for session persistence
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _agent: any = null;

async function createAgent(config: HypernextConfig) {
  const { BskyAgent } = await import("@atproto/api");
  const bskyConfig = config.syndication.bluesky;
  if (!bskyConfig) return null;

  const agent = new BskyAgent({ service: bskyConfig.service });
  await agent.login({
    identifier: bskyConfig.identifier ?? "",
    password: bskyConfig.accessToken ?? "",
  });
  return agent;
}

async function getAgent(config: HypernextConfig) {
  if (_agent) return _agent;
  _agent = await createAgent(config);
  return _agent;
}

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
    const agent = await getAgent(config);
    if (!agent) return;

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
