# Supplementary Plan: Email Syndication, Newsletter, & Contact Form Engine

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Provide a built-in, privacy-first email subsystem for Hypernext. This includes a newsletter subscription engine (instant and weekly digests) and an optional contact form. Both leverage the `@upyo/core` and `@upyo/smtp` libraries for SMTP delivery, `node-email-verifier` for validation, `ribaunt` for CAPTCHA, and the existing Akismet integration for spam filtering. All heavy I/O is offloaded to the `workmatic` worker pool.

## Overriding Decisions

| Area | Original Plan | Actual Implementation | See |
|------|--------------|---------------------|-----|
| Job/worker architecture | Workmatic worker pool | SQLite-persisted queue + piscina | REMEDIATION-PLAN.md §P1-1 |
| Template syntax | `{#each docs as doc}` (Svelte) | `<RecentPosts limit={10} />` (MDX components) | `default-templates.ts` |
| Public API auth | Unspecified | Public endpoints exempted via path allowlist | REMEDIATION-PLAN.md §P0-5 |

---

## 1. Core Architecture & Tooling

Email sending, DNS validation, and spam checks are I/O-heavy tasks that can block the main event loop. All email dispatchment and processing are offloaded to the `workmatic` Worker Thread pool.

*   **Email Transport:** `@upyo/smtp` (Promise-based SMTP client) and `@upyo/core` (Message interfaces).
*   **Email Validation:** `node-email-verifier` (Validates MX records and SMTP handshakes for newsletter signups and contact forms).
*   **CAPTCHA:** `ribaunt` (Privacy-friendly, self-hosted CAPTCHA generation and verification for the contact form).
*   **Spam Filtering:** Reuses the existing Akismet integration for contact form submissions.
*   **Scheduling:** A lightweight `setInterval` loop in the main process checks for weekly digest triggers, offloading the actual sending to `workmatic`.

---

## 2. Configuration (`config.yml`)

The `email` block configures the SMTP connection, sender details, digest schedule, and contact form settings.

```yaml
# config.yml
email:
  enabled: true
  transport: "smtp"       # Future: "mailgun", "ses"
  smtp:
    host: "smtp.mailgun.org"
    port: 587
    secure: false          # true for 465, false for 587 (STARTTLS)
    user: ${SMTP_USER}
    pass: ${SMTP_PASS}
  from:
    name: "My Hypernext Blog"
    address: "newsletter@myblog.com"
  replyTo: "alice@example.com"
  subjectPrefix: "[Hypernext Blog]"
  
  # Newsletter Settings
  newsletter:
    digestSchedule: "friday" # Day of the week to send digests
    digestTime: "09:00"      # 24h format, server timezone
    
  # Contact Form Settings
  contactForm:
    enabled: true
    recipient: "alice@example.com"
    captcha: true            # Use ribaunt CAPTCHA
    akismet: true            # Check submissions via Akismet
```

---

## 3. Database Schema (`@mikro-orm/sqlite`)

A `Subscriber` entity tracks email addresses, subscription preferences, and verification status (double opt-in).

```typescript
// src/database/entities/Subscriber.ts
import { Entity, PrimaryKey, Property, Index, Enum } from '@mikro-orm/core';

export enum SubFrequency {
  INSTANT = 'instant',
  WEEKLY = 'weekly',
}

@Entity()
@Index({ properties: ['email'] })
@Index({ properties: ['frequency', 'verified'] })
export class Subscriber {
  @PrimaryKey()
  id: string; // UUID

  @Property()
  email: string;

  @Enum(() => SubFrequency)
  frequency: SubFrequency = SubFrequency.INSTANT;

  @Property({ default: false })
  verified: boolean;

  @Property({ nullable: true })
  verification_token: string;

  @Property({ nullable: true })
  unsubscribe_token: string; // Included in every email for one-click unsubscribe

  @Property({ onCreate: () => Date.now() })
  subscribed_at: number;
}
```

---

## 4. API & Management Endpoints

### Public Endpoints (No Auth)
*   `POST /api/v1/subscribe`: Accepts `{ email, frequency }`. Offloads validation to `workmatic`. If valid, creates an unverified subscriber, generates a token, and sends a verification email.
*   `GET /api/v1/subscribe/verify?token=...`: Verifies the email and sets `verified = true`.
*   `GET /api/v1/subscribe/unsubscribe?token=...`: Removes the subscriber based on their unique `unsubscribe_token`.
*   `POST /api/v1/contact`: Accepts `{ name, email, message, captchaToken, captchaSolution }`. Offloads to `workmatic` for CAPTCHA/Akismet verification and SMTP dispatch.

### Admin Endpoints (Requires `admin` Scope)
*   `GET /api/v1/subscribers?frequency=...`: List all subscribers.
*   `POST /api/v1/subscribers`: Manually add a subscriber (bypasses opt-in, auto-verifies).
*   `DELETE /api/v1/subscribers/:email`: Manually remove a subscriber.

```typescript
// src/api/newsletter.ts
import { FastifyInstance } from 'fastify';
import { getEntityManager } from '../database';
import { Subscriber, SubFrequency } from '../database/entities/Subscriber';
import { workmatic } from 'workmatic';
import { processNewSubscription, processContactForm } from '../federation/email-tasks';

export default async function newsletterRoutes(app: FastifyInstance) {
  // Public Subscribe
  app.post('/api/v1/subscribe', async (req, reply) => {
    const { email, frequency } = req.body as any;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'Invalid email format.' });
    }
    workmatic.execute(processNewSubscription, { email, frequency }).catch(console.error);
    return reply.code(202).send({ status: 'If valid, please check your email to verify your subscription.' });
  });

  // Public Contact Form
  app.post('/api/v1/contact', async (req, reply) => {
    const { name, email, message, captchaToken, captchaSolution } = req.body as any;
    if (!name || !email || !message) {
      return reply.code(400).send({ error: 'Missing required fields.' });
    }
    workmatic.execute(processContactForm, { 
      name, email, message, captchaToken, captchaSolution, ip: req.ip, userAgent: req.headers['user-agent'] 
    }).catch(console.error);
    
    return reply.code(202).send({ status: 'Message sent.' });
  });
}
```

---

## 5. MDX Component Library

New components allow users to embed subscription and contact forms anywhere on their site.

| Component | Description | HTML Rendering | Gemini/Gopher Rendering |
| :--- | :--- | :--- | :--- |
| `<EmailSubscribe />` | Newsletter signup form | `<form action="/api/v1/subscribe" method="POST">...</form>` | `=> /subscribe Manage Subscription` (Link to HTTP version) |
| `<ContactForm />` | Contact form with CAPTCHA | `<form action="/api/v1/contact" method="POST">...<input type="hidden" name="captchaToken" />...</form>` | `=> mailto:alice@example.com Send Email` |

---

## 6. Email Processing Pipeline (`workmatic` tasks)

All email logic runs inside the `workmatic` Worker Thread to prevent blocking the main HTTP/TCP servers.

### Implementation (`src/federation/email-tasks.ts`)

```typescript
import { SMTPClient } from '@upyo/smtp';
import { Message } from '@upyo/core';
import { verify } from 'node-email-verifier';
import { verifyCaptcha } from 'ribaunt';
import { getConfig } from '../config';
import { renderEmailHtml } from '../parser';
import { getEntityManager } from '../database';
import { Subscriber, SubFrequency } from '../database/entities/Subscriber';
import { checkAkismet } from './akismet';

const config = getConfig().email;
const client = new SMTPClient({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.smtp.user, pass: config.smtp.pass },
});

// A. Newsletter Subscription & Validation
export async function processNewSubscription(payload: any) {
  const { email, frequency } = payload;
  const isValid = await verify(email, { timeout: 5000 });
  if (!isValid) return; // Silently drop invalid emails

  const em = getEntityManager();
  const existing = await em.findOne(Subscriber, { email });
  if (existing) return;

  const sub = new Subscriber();
  sub.id = crypto.randomUUID();
  sub.email = email;
  sub.frequency = frequency === 'weekly' ? SubFrequency.WEEKLY : SubFrequency.INSTANT;
  sub.verification_token = crypto.randomBytes(32).toString('hex');
  sub.unsubscribe_token = crypto.randomBytes(32).toString('hex');
  
  em.persist(sub);
  await em.flush();
  await sendVerificationEmail(sub);
}

// B. Instant Notifications (Triggered by Indexer 'New' event)
export async function sendInstantNotification(sub: Subscriber, doc: any) {
  const subject = `${config.subjectPrefix} New Post: ${doc.title}`;
  const htmlBody = await renderEmailHtml('email.mdx', { doc, unsubscribeToken: sub.unsubscribe_token });

  const message = new Message({
    from: `${config.from.name} <${config.from.address}>`,
    to: sub.email,
    replyTo: config.replyTo,
    subject,
    html: htmlBody,
    headers: {
      'List-Unsubscribe': `<https://myblog.com/api/v1/subscribe/unsubscribe?token=${sub.unsubscribe_token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });

  await client.send(message);
}

// C. Weekly Digest (Triggered by setInterval cron-like check)
export async function sendWeeklyDigest(sub: Subscriber, docs: any[]) {
  const subject = `${config.subjectPrefix} Weekly Digest`;
  const htmlBody = await renderEmailHtml('email-digest.mdx', { docs, unsubscribeToken: sub.unsubscribe_token });

  const message = new Message({
    from: `${config.from.name} <${config.from.address}>`,
    to: sub.email,
    replyTo: config.replyTo,
    subject,
    html: htmlBody,
    headers: {
      'List-Unsubscribe': `<https://myblog.com/api/v1/subscribe/unsubscribe?token=${sub.unsubscribe_token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });

  await client.send(message);
}

// D. Contact Form Pipeline (CAPTCHA -> Email Verify -> Akismet -> Send)
export async function processContactForm(payload: any) {
  const { name, email, message, captchaToken, captchaSolution, ip, userAgent } = payload;
  const contactConfig = getConfig().email.contactForm;

  // 1. Verify CAPTCHA (ribaunt)
  if (contactConfig.captcha) {
    const isValidCaptcha = await verifyCaptcha(captchaToken, captchaSolution);
    if (!isValidCaptcha) {
      console.log('Contact form rejected: Invalid CAPTCHA');
      return; // Silently drop or handle error
    }
  }

  // 2. Verify Email Deliverability (node-email-verifier)
  const isEmailValid = await verify(email, { timeout: 5000 });
  if (!isEmailValid) {
    console.log('Contact form rejected: Invalid sender email');
    return;
  }

  // 3. Check Akismet Spam
  if (contactConfig.akismet) {
    const spamStatus = await checkAkismet({
      api_key: getConfig().comments.akismet.apiKey,
      blog: getConfig().site.canonicalBase,
      user_ip: ip,
      user_agent: userAgent,
      comment_type: 'contact-form',
      comment_author: name,
      comment_author_email: email,
      comment_content: message,
    });

    if (spamStatus === 'spam') {
      console.log('Contact form rejected: Akismet flagged as spam');
      return; // Drop spam silently
    }
  }

  // 4. Dispatch Email to Site Owner
  const subject = `${config.subjectPrefix} New Contact Form Message from ${name}`;
  const htmlBody = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <hr>
    <p>${message.replace(/\n/g, '<br>')}</p>
  `;

  const messageObj = new Message({
    from: `${config.from.name} <${config.from.address}>`,
    to: contactConfig.recipient,
    replyTo: `${name} <${email}>`, // Owner can hit "Reply" directly
    subject,
    html: htmlBody,
  });

  await client.send(messageObj);
}
```

---

## 7. Customizable Email Templates

Users can customize the look and feel of their newsletters by editing MDX files in the `templates/` directory.

1.  **`templates/email.mdx`:** Used for instant notifications. Has access to the `{doc}` object.
2.  **`templates/email-digest.mdx`:** Used for weekly digests. Has access to the `{docs}` array.

```mdx
<!-- templates/email.mdx -->
<div style="font-family: sans-serif; max-width: 600px; margin: auto;">
  <h1 style="color: #333;">New Post: {doc.title}</h1>
  <div style="color: #555;">
    {doc.html}
  </div>
  <hr style="margin: 20px 0;" />
  <p style="font-size: 12px; color: #999;">
    You are receiving this because you subscribed to instant updates.
    <a href="https://myblog.com/api/v1/subscribe/unsubscribe?token={unsubscribeToken}">Unsubscribe</a>.
  </p>
</div>
```

---

## 8. TUI Dashboard Integration

The TUI gains a "Subscribers" management view, accessible via the Command Palette (`> Manage Subscribers`).

*   **UI:** A list of all subscribers, showing their email, frequency, and verified status.
*   **Actions:**
    *   `N`: Manually add a new subscriber (prompts for email and frequency).
    *   `D`: Delete a subscriber.
    *   `Enter`: View subscriber details (subscribe date, etc.).

```typescript
// src/tui/components/SubscribersManager.tsx
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { getConfig } from '../../config';

export function SubscribersManager() {
  const [subs, setSubs] = useState([]);
  const config = getConfig();

  useEffect(() => {
    const fetchSubs = async () => {
      const res = await fetch(`${config.remote.url}/api/v1/subscribers`, {
        headers: { 'Authorization': `Bearer ${config.remote.token}` }
      });
      const { data } = await res.json();
      setSubs(data);
    };
    fetchSubs();
  }, []);

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold color="cyan">Email Subscribers ({subs.length})</Text>
      {subs.map(s => (
        <Box key={s.id} justifyContent="space-between">
          <Text color={s.verified ? 'green' : 'yellow'}>{s.email}</Text>
          <Text color="gray">[{s.frequency}]</Text>
        </Box>
      ))}
      <Text marginTop={1} color="blue">[N] Add New  [D] Delete</Text>
    </Box>
  );
}
```

---

## 9. MCP Agent Access

The MCP server exposes tools for AI agents to manage the newsletter.

*   `list_subscribers()`: Returns a list of all email subscribers.
*   `add_subscriber(email, frequency)`: Manually adds a subscriber.
*   `delete_subscriber(email)`: Removes a subscriber.
*   `send_test_email(email)`: Triggers a test email to a specified address to verify SMTP configuration.

This ensures complete programmatic control over the email syndication pipeline, accessible via standard AI interfaces.

---

## 10. Dependencies

Added `@upyo/core`, `@upyo/smtp`, `node-email-verifier`, and `ribaunt` to the production dependencies.

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "@atproto/api": "^0.x",
    "@upyo/core": "^0.x",            // Upyo core message interfaces
    "@upyo/smtp": "^0.x",            // Upyo SMTP transport
    "node-email-verifier": "^1.x",   // Email MX/SMTP validation
    "ribaunt": "^1.x",               // Privacy-friendly CAPTCHA
    "asciify-engine": "^1.x",
    "better-sqlite3": "^11.x",
    "cac": "^6.x",
    "fastify": "^4.x",
    "gray-matter": "^4.x",
    "katex": "^0.16.x",
    "lru-cache": "^10.x",
    "md-to-pdf": "^5.x",
    "md-to-epub": "^1.x",
    "remark": "^15.x",
    "remark-mdx": "^3.x",
    "remark-math": "^6.x",
    "remark-parse": "^11.x",
    "turndown": "^7.x",
    "yaml": "^2.x"
  }
}
```