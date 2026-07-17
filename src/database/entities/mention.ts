import { defineEntity, p } from "@mikro-orm/core";

export const Mention = defineEntity({
  name: "Mention",
  tableName: "mentions",
  properties: {
    id: p.string().primary(),
    targetSlug: p.string().name("target_slug"),
    sourceUrl: p.string().name("source_url"),
    authorName: p.string().name("author_name"),
    authorUrl: p.string().name("author_url").nullable(),
    authorPhoto: p.string().name("author_photo").nullable(),
    content: p.text(),
    publishedAt: p.integer().name("published_at"),
    type: p.string(), // 'reply' | 'like' | 'repost'
    platform: p.string(), // 'webmention' | 'pingback' | 'trackback' | 'mastodon' | 'bluesky'
    senderIp: p.string().name("sender_ip").nullable(),
    spamStatus: p.string().name("spam_status"), // 'pending' | 'ham' | 'spam'
    hidden: p.boolean().default(false),
    seenAt: p
      .integer()
      .name("seen_at")
      .onCreate(() => Date.now()),
  },
  indexes: [{ properties: ["targetSlug", "platform", "spamStatus"] }],
});
