import { defineEntity, p } from "@mikro-orm/core";

export const TermRelationship = defineEntity({
  name: "TermRelationship",
  tableName: "term_relationships",
  properties: {
    docId: p.integer().name("doc_id").primary(),
    termId: p.integer().name("term_id").primary(),
  },
});
