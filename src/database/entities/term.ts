import { defineEntity, p } from "@mikro-orm/core";

export const Term = defineEntity({
  name: "Term",
  tableName: "terms",
  properties: {
    id: p.integer().primary(),
    taxonomy: p.string(),
    slug: p.string(),
    name: p.string(),
  },
  uniques: [{ properties: ["taxonomy", "slug"] }],
});
