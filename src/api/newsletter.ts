import type { FastifyInstance } from "fastify";
import { Subscriber } from "../database/entities/subscriber.js";
import { getEm } from "../database/index.js";
import { getOrchestrator } from "../federation/workmatic.js";
import type { HypernextConfig } from "../types/config.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerNewsletterRoutes(
  fastify: FastifyInstance,
  _config: HypernextConfig
): void {
  // ── Public: Subscribe ──
  fastify.post<{
    Body: { email: string; frequency?: string };
  }>("/api/v1/subscribe", async (request, reply) => {
    const { email, frequency } = request.body;

    if (!(email && EMAIL_REGEX.test(email))) {
      reply.code(400).send({ error: "Invalid email format." });
      return;
    }

    const orch = getOrchestrator();
    const client = orch.client("email-verification");
    await client.add(
      { email, frequency: frequency ?? "instant" },
      { maxAttempts: 2 }
    );

    reply.code(202).send({
      status: "If valid, please check your email to verify your subscription.",
    });
  });

  // ── Public: Verify subscription ──
  fastify.get("/api/v1/subscribe/verify", async (request, reply) => {
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
  });

  // ── Public: Unsubscribe ──
  fastify.get("/api/v1/subscribe/unsubscribe", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const token = query.token;

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
    reply.send({ status: "You have been unsubscribed." });
  });

  // ── Public: Contact form ──
  fastify.post<{
    Body: {
      captchaSolution?: string;
      captchaToken?: string;
      email: string;
      message: string;
      name: string;
    };
  }>("/api/v1/contact", async (request, reply) => {
    const { name, email, message, captchaToken, captchaSolution } =
      request.body;

    if (!(name && email && message)) {
      reply.code(400).send({ error: "Missing required fields." });
      return;
    }

    const orch = getOrchestrator();
    const client = orch.client("email-send");
    await client.add(
      {
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
      },
      { maxAttempts: 2 }
    );

    reply.code(202).send({ status: "Message sent." });
  });

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
