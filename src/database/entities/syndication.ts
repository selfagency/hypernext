import { defineEntity, p } from "@mikro-orm/core";

export const Syndication = defineEntity({
  name: "Syndication",
  tableName: "syndication",
  properties: {
    id: p.integer().primary(),
    docId: p.integer().name("doc_id"),
    platform: p.string(),
    url: p.string(),
    publishedAt: p
      .datetime()
      .name("published_at")
      .onCreate(() => new Date()),
  },
});
