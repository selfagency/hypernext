import { defineEntity, p } from "@mikro-orm/core";

export const Subscriber = defineEntity({
  name: "Subscriber",
  tableName: "subscribers",
  properties: {
    id: p.string().primary(),
    email: p.string().name("email"),
    frequency: p.string().name("frequency"), // 'instant' | 'weekly'
    verified: p.boolean().name("verified").default(false),
    verificationToken: p.string().name("verification_token").nullable(),
    unsubscribeToken: p.string().name("unsubscribe_token").nullable(),
    subscribedAt: p
      .integer()
      .name("subscribed_at")
      .onCreate(() => Date.now()),
  },
  indexes: [
    { properties: ["email"] },
    { properties: ["frequency", "verified"] },
  ],
});
