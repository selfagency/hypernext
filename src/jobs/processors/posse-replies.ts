export async function processPosseReplies(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { fetchMastodonReplies } = await import(
    "../../federation/posse-replies.js"
  );
  const { fetchBlueskyReplies } = await import(
    "../../federation/posse-replies.js"
  );

  const platform = payload.platform as string;
  const slug = payload.slug as string;
  const postId = payload.postId as string;

  if (platform === "mastodon") {
    await fetchMastodonReplies(config as never, slug, postId);
  } else {
    await fetchBlueskyReplies(config as never, slug, postId);
  }
}
