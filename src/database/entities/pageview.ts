import { defineEntity, p } from "@mikro-orm/core";

export const Pageview = defineEntity({
  name: "Pageview",
  tableName: "pageviews",
  properties: {
    id: p.integer().primary().autoincrement(),
    slug: p.string().name("slug"),
    protocol: p.string().name("protocol"), // 'http', 'gemini', 'gopher', etc.
    visitorHash: p.string().name("visitor_hash"),
    referrer: p.string().name("referrer").nullable(),
    timestamp: p
      .integer()
      .name("timestamp")
      .onCreate(() => Date.now()),
  },
  indexes: [{ properties: ["slug", "protocol", "timestamp"] }],
});
