import crypto from "node:crypto";
import { createMessage } from "@upyo/core";
import { SmtpTransport } from "@upyo/smtp";
import { Subscriber } from "../database/entities/subscriber.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { checkAkismet } from "./akismet.js";

function createTransport(config: HypernextConfig): SmtpTransport {
  const emailCfg = config.email;
  if (!emailCfg) {
    throw new Error("Email not configured");
  }
  return new SmtpTransport({
    host: emailCfg.smtp.host,
    port: emailCfg.smtp.port,
    secure: emailCfg.smtp.secure,
    auth: {
      type: "user-pass" as const,
      user: emailCfg.smtp.user,
      pass: emailCfg.smtp.pass,
    },
  });
}

async function sendAndClose(
  transport: SmtpTransport,
  message: ReturnType<typeof createMessage>
): Promise<void> {
  await transport.send(message);
  await transport.closeAllConnections();
}

function buildHeaders(
  config: HypernextConfig,
  unsubscribeToken?: string
): Headers {
  const headers = new Headers();
  if (unsubscribeToken) {
    headers.set(
      "List-Unsubscribe",
      `<${config.site.canonicalBase}/api/v1/subscribe/unsubscribe?token=${unsubscribeToken}>`
    );
    headers.set("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
  }
  return headers;
}

// ── A. Newsletter Subscription & Validation ──

export async function processNewSubscription(
  config: HypernextConfig,
  payload: { email: string; frequency: string }
): Promise<void> {
  const { email, frequency } = payload;

  const em = getEm();
  const existing = await em.findOne(Subscriber, { email });
  if (existing) {
    return;
  }

  const sub = em.create(Subscriber, {
    id: crypto.randomUUID(),
    email,
    frequency: frequency === "weekly" ? "weekly" : "instant",
    verified: false,
    verificationToken: crypto.randomBytes(32).toString("hex"),
    unsubscribeToken: crypto.randomBytes(32).toString("hex"),
    subscribedAt: Date.now(),
  });
  await em.flush();

  await sendVerificationEmail(config, sub);
}

async function sendVerificationEmail(
  config: HypernextConfig,
  sub: (typeof Subscriber)["prototype"]
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    return;
  }

  const verifyUrl = `${config.site.canonicalBase}/api/v1/subscribe/verify?token=${sub.verificationToken}`;
  const html = `<p>Please verify your email by clicking the link below:</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>
<p>If you did not request this, you can ignore this email.</p>`;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: sub.email,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} Please verify your email`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken ?? undefined),
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── B. Instant Notification ──

export async function sendInstantNotification(
  config: HypernextConfig,
  sub: (typeof Subscriber)["prototype"],
  doc: { slug: string; title: string; html?: string }
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    return;
  }

  const html = `<h1>${doc.title}</h1>
${doc.html ?? ""}
<hr />
<p style="font-size: 12px; color: #999;">
  <a href="${config.site.canonicalBase}/api/v1/subscribe/unsubscribe?token=${sub.unsubscribeToken}">Unsubscribe</a>
</p>`;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: sub.email,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} New Post: ${doc.title}`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken ?? undefined),
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── C. Weekly Digest ──

export async function sendWeeklyDigest(
  config: HypernextConfig,
  sub: (typeof Subscriber)["prototype"],
  docs: { slug: string; title: string; description?: string }[]
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    return;
  }

  const items = docs
    .map(
      (d) =>
        `<li><a href="${config.site.canonicalBase}/${d.slug}">${d.title}</a>${d.description ? ` — ${d.description}` : ""}</li>`
    )
    .join("\n");

  const html = `<h1>Weekly Digest</h1>
<ul>${items}</ul>
<hr />
<p style="font-size: 12px; color: #999;">
  <a href="${config.site.canonicalBase}/api/v1/subscribe/unsubscribe?token=${sub.unsubscribeToken}">Unsubscribe</a>
</p>`;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: sub.email,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} Weekly Digest`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken ?? undefined),
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── D. Contact Form Pipeline ──

export async function processContactForm(
  config: HypernextConfig,
  payload: {
    captchaSolution?: string;
    captchaToken?: string;
    email: string;
    ip: string;
    message: string;
    name: string;
    userAgent?: string;
  }
): Promise<void> {
  const emailCfg = config.email;
  if (!(emailCfg?.enabled && emailCfg.contactForm.enabled)) {
    return;
  }

  const { name, email, message: bodyText, ip, userAgent } = payload;

  // 1. Verify CAPTCHA (ribaunt)
  if (emailCfg.contactForm.captcha) {
    const { verifyCaptcha } = await import("ribaunt");
    const isValidCaptcha = await verifyCaptcha(
      payload.captchaToken,
      payload.captchaSolution
    );
    if (!isValidCaptcha) {
      return;
    }
  }

  // 2. Check Akismet Spam
  if (emailCfg.contactForm.akismet && config.comments?.akismet?.apiKey) {
    const spamStatus = await checkAkismet({
      apiKey: config.comments.akismet.apiKey,
      blog: config.site.canonicalBase,
      userIp: ip,
      userAgent: userAgent ?? "",
      commentType: "contact-form",
      commentAuthor: name,
      commentAuthorUrl: "",
      commentContent: bodyText,
      permalink: "",
      referrer: "",
    });

    if (spamStatus === "spam") {
      return;
    }
  }

  // 3. Dispatch Email to Site Owner
  const subject = `${emailCfg.subjectPrefix} New Contact Form Message from ${name}`;
  const htmlBody = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <hr>
    <p>${bodyText.replace(/\n/g, "<br>")}</p>
  `;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: emailCfg.contactForm.recipient,
    replyTo: `${name} <${email}>`,
    subject,
    content: { html: htmlBody },
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── E. Test Email ──

export async function sendTestEmail(
  config: HypernextConfig,
  to: string
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    throw new Error("Email not configured");
  }

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to,
    subject: `${emailCfg.subjectPrefix} Test Email`,
    content: {
      html: "<h1>Test</h1><p>This is a test email from Hypernext.</p>",
    },
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}
