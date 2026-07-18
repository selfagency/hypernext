import type { HypernextConfig } from "../types/config.js";
import type { McpTool } from "./tools.js";

export function createEmailTools(config: HypernextConfig): McpTool[] {
  return [
    {
      name: "list_subscribers",
      description: "List all email subscribers",
      inputSchema: {
        type: "object",
        properties: {
          frequency: {
            type: "string",
            description: "Filter by frequency (instant/weekly)",
          },
        },
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const frequency = String(args.frequency ?? "");
        const em = getEm();
        const where: Record<string, unknown> = {};
        if (frequency) {
          where.frequency = frequency;
        }
        const subs = await em.find(Subscriber, where, {
          orderBy: { subscribedAt: "DESC" },
          limit: 100,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(subs, null, 2) }],
        };
      },
    },
    {
      name: "add_subscriber",
      description: "Manually add a subscriber (bypasses opt-in)",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Email address" },
          frequency: {
            type: "string",
            description: "Frequency (instant/weekly)",
          },
        },
        required: ["email"],
      },
      async handler(args) {
        const crypto = await import("node:crypto");
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const email = String(args.email ?? "");
        const frequency = String(args.frequency ?? "instant");
        const em = getEm();
        const existing = await em.findOne(Subscriber, { email });
        if (existing) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Email already subscribed" }),
              },
            ],
          };
        }
        const sub = em.create(Subscriber, {
          id: crypto.randomUUID(),
          email,
          frequency: frequency === "weekly" ? "weekly" : "instant",
          verified: true,
          verificationToken: null,
          unsubscribeToken: crypto.randomBytes(32).toString("hex"),
          subscribedAt: Date.now(),
        });
        await em.flush();
        return {
          content: [{ type: "text", text: JSON.stringify(sub, null, 2) }],
        };
      },
    },
    {
      name: "delete_subscriber",
      description: "Remove a subscriber by email",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Email address to remove" },
        },
        required: ["email"],
      },
      async handler(args) {
        const { getEm } = await import("../database/index.js");
        const { Subscriber } = await import(
          "../database/entities/subscriber.js"
        );
        const email = String(args.email ?? "");
        const em = getEm();
        const sub = await em.findOne(Subscriber, { email });
        if (!sub) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Subscriber not found" }),
              },
            ],
          };
        }
        await em.remove(sub).flush();
        return {
          content: [{ type: "text", text: `Subscriber ${email} deleted.` }],
        };
      },
    },
    {
      name: "send_test_email",
      description: "Send a test email to verify SMTP configuration",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
        },
        required: ["to"],
      },
      async handler(args) {
        const to = String(args.to ?? "");
        const { sendTestEmail } = await import("../federation/email-tasks.js");
        await sendTestEmail(config, to);
        return {
          content: [{ type: "text", text: `Test email sent to ${to}.` }],
        };
      },
    },
  ];
}
