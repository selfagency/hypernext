import { defineEntity, p } from "@mikro-orm/core";

export const OAuthToken = defineEntity({
  name: "OAuthToken",
  tableName: "oauth_tokens",
  properties: {
    id: p.integer().primary(),
    provider: p.string(),
    token: p.string(),
    refreshToken: p.string().name("refresh_token").nullable(),
    expiresAt: p.string().name("expires_at").nullable(),
    createdAt: p
      .datetime()
      .name("created_at")
      .onCreate(() => new Date()),
  },
});
