export async function processOutboundSyndication(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { getSyndicationForDoc } = await import("../../database/index.js");
  const { syndicateToMastodon } = await import("../../bridge/mastodon.js");
  const { syndicateToBluesky } = await import("../../bridge/bluesky.js");

  const docId = payload.docId as number;
  const slug = payload.slug as string;
  const content = payload.content as string;

  const existing = await getSyndicationForDoc(docId);
  const alreadySyndicated = new Set(existing.map((r) => r.platform as string));

  const syndication = (config?.syndication ?? {}) as Record<string, unknown>;
  const mastodonCfg = syndication.mastodon as
    | Record<string, unknown>
    | undefined;
  const blueskyCfg = syndication.bluesky as Record<string, unknown> | undefined;

  if (mastodonCfg?.enabled && !alreadySyndicated.has("mastodon")) {
    await syndicateToMastodon(config as never, docId, slug, content);
  }

  if (blueskyCfg?.enabled && !alreadySyndicated.has("bluesky")) {
    await syndicateToBluesky(config as never, docId, slug, content);
  }
}
