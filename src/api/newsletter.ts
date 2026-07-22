import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { Subscriber } from "../database/entities/subscriber.js";
import { getEm } from "../database/index.js";
import { schedule } from "../jobs/queue.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerNewsletterRoutes(fastify: FastifyInstance): void {
  // Register rate limit plugin globally
  fastify.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: "1 minute",
  });

  // ── Public: Subscribe ──
  fastify.post<{
    Body: { email: string; frequency?: string };
  }>(
    "/api/v1/subscribe",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { email, frequency } = request.body;

      if (!(email && EMAIL_REGEX.test(email))) {
        reply.code(400).send({ error: "Invalid email format." });
        return;
      }

      await schedule("email-verification", {
        email,
        frequency: frequency ?? "instant",
      });

      reply.code(202).send({
        status:
          "If valid, please check your email to verify your subscription.",
      });
    }
  );

  // ── Public: Verify subscription ──
  fastify.get(
    "/api/v1/subscribe/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const token = query.token;

      if (!token) {
        reply.code(400).send({ error: "Missing verification token." });
        return;
      }

      const em = getEm();
      const sub = await em.findOne(Subscriber, { verificationToken: token });
      if (!sub) {
        reply.code(404).send({ error: "Invalid or expired token." });
        return;
      }

      sub.verified = true;
      sub.verificationToken = null;
      await em.flush();

      reply.send({ status: "Email verified. You are now subscribed." });
    }
  );

  // ── Public: Unsubscribe form page ──
  fastify.get(
    "/subscribe/unsubscribe",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    (request, reply) => {
      const query = request.query as Record<string, string>;
      const token = query.token ?? "";
      const csrfToken = reply.generateCsrf();

      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribe</title>
  <style>
    body { font-family: sans-serif; max-width: 500px; margin: 40px auto; padding: 0 20px; }
    input[type="hidden"] { display: none; }
    button { background: #e53e3e; color: #fff; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
    button:hover { background: #c53030; }
  </style>
</head>
<body>
  <h1>Unsubscribe</h1>
  <p>Click the button below to unsubscribe from all email updates.</p>
  <form action="/api/v1/subscribe/unsubscribe" method="POST">
    <input type="hidden" name="token" value="${token}" />
    <input type="hidden" name="_csrf" value="${csrfToken}" />
    <button type="submit">Unsubscribe</button>
  </form>
</body>
</html>`);
    }
  );

  // ── Public: Unsubscribe ──
  fastify.post<{
    Body: { token: string; _csrf: string };
  }>(
    "/api/v1/subscribe/unsubscribe",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      preHandler: fastify.csrfProtection ? [fastify.csrfProtection] : undefined,
    },
    async (request, reply) => {
      const { token } = request.body;

      if (!token) {
        reply.code(400).send({ error: "Missing unsubscribe token." });
        return;
      }

      const em = getEm();
      const sub = await em.findOne(Subscriber, { unsubscribeToken: token });
      if (!sub) {
        reply.code(404).send({ error: "Invalid token." });
        return;
      }

      await em.remove(sub).flush();
      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribed</title>
  <style>
    body { font-family: sans-serif; max-width: 500px; margin: 40px auto; padding: 0 20px; text-align: center; }
    h1 { color: #38a169; }
  </style>
</head>
<body>
  <h1>Unsubscribed</h1>
  <p>You have been successfully unsubscribed from all email updates.</p>
</body>
</html>`);
    }
  );

  // ── Public: Contact form ──
  fastify.post<{
    Body: {
      captchaSolution?: string;
      captchaToken?: string;
      email: string;
      message: string;
      name: string;
    };
  }>(
    "/api/v1/contact",
    {
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { name, email, message, captchaToken, captchaSolution } =
        request.body;

      if (!(name && email && message)) {
        reply.code(400).send({ error: "Missing required fields." });
        return;
      }

      await schedule("email-send", {
        type: "contact",
        data: {
          name,
          email,
          message,
          captchaToken,
          captchaSolution,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        },
      });

      reply.code(202).send({ status: "Message sent." });
    }
  );

  // ── Admin: List subscribers ──
  fastify.get("/api/v1/subscribers", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const frequency = query.frequency;

    const em = getEm();
    const where: Record<string, unknown> = {};
    if (frequency) {
      where.frequency = frequency;
    }

    const subs = await em.find(Subscriber, where, {
      orderBy: { subscribedAt: "DESC" },
      limit: 100,
    });
    reply.send({ data: subs });
  });

  // ── Admin: Add subscriber manually ──
  fastify.post<{
    Body: { email: string; frequency?: string };
  }>("/api/v1/subscribers", async (request, reply) => {
    const { email, frequency } = request.body;

    if (!(email && EMAIL_REGEX.test(email))) {
      reply.code(400).send({ error: "Invalid email format." });
      return;
    }

    const crypto = await import("node:crypto");
    const em = getEm();
    const existing = await em.findOne(Subscriber, { email });
    if (existing) {
      reply.code(409).send({ error: "Email already subscribed." });
      return;
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

    reply.code(201).send({ data: sub });
  });

  // ── Admin: Delete subscriber ──
  fastify.delete<{ Params: { email: string } }>(
    "/api/v1/subscribers/:email",
    async (request, reply) => {
      const { email } = request.params;
      const em = getEm();
      const sub = await em.findOne(Subscriber, { email });
      if (!sub) {
        reply.code(404).send({ error: "Subscriber not found." });
        return;
      }

      await em.remove(sub).flush();
      reply.code(204).send();
    }
  );
}
