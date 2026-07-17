import { Mention } from "../database/entities/mention.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { hashString } from "../utils/crypto.js";

export async function fetchMastodonReplies(
  config: HypernextConfig,
  slug: string,
  postId: string
): Promise<void> {
  const mastodonConfig = config.syndication.mastodon;
  if (!mastodonConfig?.enabled) {
    return;
  }

  // Extract numeric ID from Mastodon URL (e.g. https://instance/@user/12345 -> 12345)
  const numericId = postId.split("/").pop() ?? postId;

  try {
    const response = await fetch(
      `${mastodonConfig.instance}/api/v1/statuses/${numericId}/context`,
      {
        headers: {
          Authorization: `Bearer ${mastodonConfig.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`Mastodon context fetch failed: ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      descendants: Array<{
        id: string;
        content: string;
        account: {
          acct: string;
          display_name: string;
          url: string;
          avatar: string;
        };
        created_at: string;
        url: string;
      }>;
    };

    if (!data.descendants || data.descendants.length === 0) {
      return;
    }

    const em = getEm();
    for (const reply of data.descendants) {
      const sourceUrl =
        reply.url ||
        `${mastodonConfig.instance}/@${reply.account.acct}/${reply.id}`;
      const id = hashString(`${sourceUrl}:${slug}`);
      const existing = await em.findOne(Mention, { id });
      if (existing) {
        continue;
      }

      const content = reply.content.replace(/<[^>]+>/g, "").trim();

      em.create(Mention, {
        id,
        targetSlug: slug,
        sourceUrl,
        authorName: reply.account.display_name || reply.account.acct,
        authorUrl: reply.account.url,
        authorPhoto: reply.account.avatar,
        content,
        publishedAt: new Date(reply.created_at).getTime(),
        type: "reply",
        platform: "mastodon",
        senderIp: null,
        spamStatus: "ham",
      });
    }
    await em.flush();
  } catch (error) {
    console.error("Mastodon reply fetch error:", error);
  }
}

export async function fetchBlueskyReplies(
  _config: HypernextConfig,
  slug: string,
  atUri: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}`
    );

    if (!response.ok) {
      console.error(`Bluesky thread fetch failed: ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      thread: {
        replies?: Array<{
          post: {
            uri: string;
            author: {
              handle: string;
              displayName?: string;
              avatar?: string;
            };
            record: {
              text: string;
              createdAt: string;
            };
            indexedAt: string;
          };
        }>;
      };
    };

    if (!data.thread?.replies || data.thread.replies.length === 0) {
      return;
    }

    const em = getEm();
    for (const reply of data.thread.replies) {
      const sourceUrl = reply.post.uri;
      const id = hashString(`${sourceUrl}:${slug}`);
      const existing = await em.findOne(Mention, { id });
      if (existing) {
        continue;
      }

      em.create(Mention, {
        id,
        targetSlug: slug,
        sourceUrl,
        authorName: reply.post.author.displayName || reply.post.author.handle,
        authorUrl: `https://bsky.app/profile/${reply.post.author.handle}`,
        authorPhoto: reply.post.author.avatar ?? null,
        content: reply.post.record.text,
        publishedAt: new Date(reply.post.indexedAt).getTime(),
        type: "reply",
        platform: "bluesky",
        senderIp: null,
        spamStatus: "ham",
      });
    }
    await em.flush();
  } catch (error) {
    console.error("Bluesky reply fetch error:", error);
  }
}
