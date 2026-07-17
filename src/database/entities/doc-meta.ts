import { defineEntity, p } from "@mikro-orm/core";

export const DocMeta = defineEntity({
  name: "DocMeta",
  tableName: "docs_meta",
  properties: {
    id: p.integer().primary(),
    slug: p.string().unique(),
    title: p.string(),
    description: p.string().nullable(),
    date: p.string().nullable(),
    type: p.string().nullable(),
    layout: p.string().nullable(),
    canonicalUrl: p.string().name("canonical_url").nullable(),
    rawMdx: p.text().name("raw_mdx").nullable(),
    irJson: p.text().name("ir_json").nullable(),
    htmlCache: p.text().name("html_cache").nullable(),
    gemtextCache: p.text().name("gemtext_cache").nullable(),
    gopherCache: p.text().name("gopher_cache").nullable(),
    rssCache: p.text().name("rss_cache").nullable(),
    createdAt: p
      .datetime()
      .name("created_at")
      .onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .name("updated_at")
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
    publishedAt: p.string().name("published_at").nullable(),
    order: p.integer().nullable(),
    metaJson: p.text().name("meta_json").nullable(),
    contentCid: p.string().name("content_cid").nullable(),
    htmlCid: p.string().name("html_cid").nullable(),
  },
});
