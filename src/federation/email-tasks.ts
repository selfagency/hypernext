import crypto from "node:crypto";
import { createMessage } from "@upyo/core";
import { SmtpTransport } from "@upyo/smtp";
import { Subscriber } from "../database/entities/subscriber.js";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";
import { checkAkismet } from "./akismet.js";

// HTML-escape a string for safe interpolation into HTML email bodies
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render an email template by reading the template file, parsing it to IR,
 * and rendering to HTML. Falls back to null if the template can't be loaded.
 */
async function renderEmailTemplate(
  config: HypernextConfig,
  templateName: string,
  context: Record<string, string>
): Promise<string | null> {
  try {
    const { readLayoutRaw } = await import("../parser/layout.js");
    const raw = readLayoutRaw("templates", `${templateName}.mdx`);
    if (!raw) {
      return null;
    }

    // Replace template variables like {{title}} with context values
    let processed = raw;
    for (const [key, value] of Object.entries(context)) {
      processed = processed.replace(
        new RegExp(String.raw`\{\{${key}\}\}`, "g"),
        escapeHtml(value)
      );
    }

    const { parseToIR } = await import("../parser/pipeline.js");
    const result = parseToIR(processed, templateName);

    const { renderHTML } = await import("../renderers/html.js");
    return renderHTML(result, config, templateName, {});
  } catch {
    return null;
  }
}

// @types/ribaunt doesn't exist — declare the module for type safety
declare module "ribaunt" {
  export function verifyCaptcha(
    token?: string,
    solution?: string
  ): Promise<boolean>;
}

function createTransport(config: HypernextConfig): SmtpTransport {
  const emailCfg = config.email;
  if (!emailCfg) {
    throw new Error("Email not configured");
  }

  // When mailpit mode is enabled, override SMTP to Mailpit defaults
  // (localhost:1025, no auth, no TLS) so developers don't need to manually
  // configure SMTP for local testing.
  if (emailCfg.mailpit) {
    return new SmtpTransport({
      host: "localhost",
      port: 1025,
      secure: false,
      auth: { user: "", pass: "" },
    });
  }

  return new SmtpTransport({
    host: emailCfg.smtp.host,
    port: emailCfg.smtp.port,
    secure: emailCfg.smtp.secure,
    auth: {
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
      `<${config.site.canonicalBase}/subscribe/unsubscribe?token=${unsubscribeToken}>`
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

  // Validate email deliverability (MX records, format)
  try {
    const { default: emailValidator } = await import("node-email-verifier");
    const isValid = await emailValidator(email, {
      checkMx: true,
      timeout: 5000,
    });
    if (!isValid) {
      return; // Silently drop invalid emails
    }
  } catch {
    // DNS validation failed — proceed anyway to avoid blocking subscriptions
    // during transient DNS failures
  }

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
  sub: Record<string, unknown>
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
    to: sub.email as string,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} Please verify your email`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken as string | undefined),
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── B. Instant Notification ──

export async function sendInstantNotification(
  config: HypernextConfig,
  sub: Record<string, unknown>,
  doc: { slug: string; title: string; html?: string }
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    return;
  }

  // Try to render from email template, fall back to inline
  const html =
    (await renderEmailTemplate(config, "email", {
      title: doc.title,
      content: doc.html ?? "",
      unsubscribeUrl: `${config.site.canonicalBase}/subscribe/unsubscribe?token=${sub.unsubscribeToken}`,
    })) ??
    `<h1>${escapeHtml(doc.title)}</h1>
${doc.html ?? ""}
<hr />
<p style="font-size: 12px; color: #999;">
  <a href="${config.site.canonicalBase}/subscribe/unsubscribe?token=${sub.unsubscribeToken}">Unsubscribe</a>
</p>`;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: sub.email as string,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} New Post: ${doc.title}`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken as string | undefined),
  });

  const transport = createTransport(config);
  await sendAndClose(transport, message);
}

// ── C. Weekly Digest ──

export async function sendWeeklyDigest(
  config: HypernextConfig,
  sub: Record<string, unknown>,
  docs: { slug: string; title: string; description?: string }[]
): Promise<void> {
  const emailCfg = config.email;
  if (!emailCfg?.enabled) {
    return;
  }

  const items = docs
    .map((d) => {
      const link = `${config.site.canonicalBase}/${d.slug}`;
      const title = escapeHtml(d.title);
      const desc = d.description ? ` — ${escapeHtml(d.description)}` : "";
      return `<li><a href="${link}">${title}</a>${desc}</li>`;
    })
    .join("\n");

  // Try to render from email-digest template, fall back to inline
  const html =
    (await renderEmailTemplate(config, "email-digest", {
      title: "Weekly Digest",
      content: `<ul>${items}</ul>`,
      unsubscribeUrl: `${config.site.canonicalBase}/subscribe/unsubscribe?token=${sub.unsubscribeToken}`,
    })) ??
    `<h1>Weekly Digest</h1>
<ul>${items}</ul>
<hr />
<p style="font-size: 12px; color: #999;">
  <a href="${config.site.canonicalBase}/subscribe/unsubscribe?token=${sub.unsubscribeToken}">Unsubscribe</a>
</p>`;

  const message = createMessage({
    from: `${emailCfg.from.name} <${emailCfg.from.address}>`,
    to: sub.email as string,
    replyTo: emailCfg.replyTo,
    subject: `${emailCfg.subjectPrefix} Weekly Digest`,
    content: { html },
    headers: buildHeaders(config, sub.unsubscribeToken as string | undefined),
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
  const subject = `${emailCfg.subjectPrefix} New Contact Form Message from ${escapeHtml(name)}`;
  const htmlBody = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
    <hr>
    <p>${escapeHtml(bodyText).replaceAll("\n", "<br>")}</p>
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
