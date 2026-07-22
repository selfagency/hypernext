# Supplementary Plan: Unified Background Processing, Cross-Protocol Mentions & Spam Management

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Unify inbound pings (Webmention, Pingback, Trackback) and POSSE reply bridging (Mastodon, ATProto/Bluesky) into a single, ORM-backed comment system that renders natively across all protocols. Offload all heavy I/O and CPU tasks (including indexing, caching, and PDF/EPUB generation) to a centralized Worker Thread pool to guarantee main event loop responsiveness. Includes automated Akismet spam filtering, REST-based moderation, and granular per-document controls.

## Overriding Decisions

| Area | Original Plan | Actual Implementation | See |
|------|--------------|---------------------|-----|
| Job queue | `workmatic` (Kysely+fastq, main-thread) | SQLite-persisted (`src/jobs/queue.ts`) + piscina worker pool | REMEDIATION-PLAN.md §P1-1 |
| EntityManager scoping | Implicit singleton | `getEm().fork()` per call site | REMEDIATION-PLAN.md §P0-10 |
| EPUB library | `md-to-epub` | `@lesjoursfr/html-to-epub` | `package.json` |

---

## 1. Unified Background Task Queue (`workmatic`)

To prevent heavy CPU tasks (HTML parsing, mf2 extraction, API polling, PDF generation) from blocking the main event loop and causing TCP timeouts on Gemini/Gopher, we centralize all non-blocking, I/O-intensive, or CPU-heavy operations into a `workmatic` Worker Thread pool. 

Unlike forked processes, worker threads share the main process's memory space, making them highly RAM-efficient and eliminating the need for external message brokers like Redis or RabbitMQ.

### Architectural Flow
```text
┌──────────────────────────────────────────────────────────────┐
│                    $5 VPS (Single Application)                │
│                                                              │
│  ┌──────────────────────────────┐                            │
│  │      Main Process (Fastify)   │                            │
│  │  - HTTP, Gemini, Gopher, etc. │                            │
│  │  - Request Routing            │                            │
│  │  - Read from LRU Cache        │                            │
│  └─────────────┬────────────────┘                            │
│                |                                             │
│                | workmatic.execute(Task, Payload)            │
│                | (Centralized Promise-based Queue)           │
│                ▼                                             │
│  ┌──────────────────────────────┐                            │
│  │  Worker Thread Pool (workmatic)│                           │
│  │  1. Indexing: Parse MDX -> IR │                            │
│  │  2. Caching: Render IR -> HTML│                            │
│  │  3. PDF/EPUB Generation       │                            │
│  │  4. POSSE Syndication         │                            │
│  │  5. Federation/Spam Processing│                            │
│  │  6. Write to SQLite (MikroORM)│                            │
│  └──────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

### Implementation
We define discrete async functions that `workmatic` can execute in a thread. MikroORM is lazily initialized inside the worker context to ensure database writes do not block the main thread.

```typescript
// src/federation/tasks.ts
import { MikroORM } from '@mikro-orm/sqlite';
import { Mention, SpamStatus } from '../database/entities/Mention';
import { checkAkismet } from './akismet';

let orm: MikroORM;

async function initOrm() {
  if (!orm) {
    orm = await MikroORM.init({
      entities: [Mention],
      dbName: './hypernext.db',
    });
  }
  return orm;
}

// Task: Process Inbound Webmention/Pingback/Trackback
export async function processInboundMention(payload: any) {
  const { source, target, ip, userAgent, type } = payload;
  const res = await fetch(source);
  const html = await res.text();
  const mf2 = parseMf2(html); // Heavy CPU
  
  if (!html.includes(target)) throw new Error('Target link not found');
  const spamStatus = await checkAkismet({ /* ... */ });
  
  const orm = await initOrm();
  const em = orm.em.fork();
  const mention = new Mention();
  // ... map mf2 data to mention ...
  mention.spam_status = spamStatus;
  em.persist(mention);
  await em.flush();
}

// Task: Fetch POSSE Replies (Mastodon/Bluesky)
export async function fetchPosseReplies(payload: any) {
  const { slug, platform, postId } = payload;
  const replies = platform === 'mastodon' 
    ? await fetchMastodonContext(postId) 
    : await fetchBlueskyThread(postId);
    
  const orm = await initOrm();
  const em = orm.em.fork();
  for (const reply of replies) {
    // ... upsert logic ...
  }
  await em.flush();
}
```

The main Fastify process offloads work instantly, returning `202 Accepted` for pings and keeping TCP sockets clear:

```typescript
// src/api/routes.ts (Main Process)
import { workmatic } from 'workmatic';
import { processInboundMention } from '../federation/tasks';

app.post('/webmention', async (req, reply) => {
  const { source, target } = req.body as any;
  workmatic.execute(processInboundMention, {
    source, target, ip: req.ip, userAgent: req.headers['user-agent'], type: 'webmention'
  }).catch(err => console.error('Worker error:', err));
  
  return reply.code(202).send({ status: 'accepted' });
});
```

---

## 2. Database Schema (`@mikro-orm/sqlite`)

We utilize `@mikro-orm/sqlite` for entity management and type safety. A unified `Mention` entity tracks all inbound interactions and POSSE replies, along with spam classification.

```typescript
// src/database/entities/Mention.ts
import { Entity, PrimaryKey, Property, Index, Enum } from '@mikro-orm/core';

export enum SpamStatus {
  PENDING = 'pending',
  HAM = 'ham',         // Not spam
  SPAM = 'spam',
}

export enum MentionType {
  REPLY = 'reply',
  LIKE = 'like',
  REPOST = 'repost',
}

@Entity()
@Index({ properties: ['target_slug', 'platform', 'spam_status'] })
export class Mention {
  @PrimaryKey()
  id: string; // Hash of source_url + target_slug

  @Property()
  target_slug: string; // The Hypernext doc being replied to

  @Property()
  source_url: string; // URL of the reply

  @Property()
  author_name: string;

  @Property({ nullable: true })
  author_url: string;

  @Property({ nullable: true })
  author_photo: string;

  @Property({ type: 'text' })
  content: string; // Plain text or sanitized HTML

  @Property()
  published_at: number;

  @Enum(() => MentionType)
  type: MentionType = MentionType.REPLY;

  @Property()
  platform: string; // 'webmention', 'pingback', 'trackback', 'mastodon', 'bluesky'

  @Property({ nullable: true })
  sender_ip: string; // IP of the server that sent the ping (for Akismet)

  @Enum(() => SpamStatus)
  spam_status: SpamStatus = SpamStatus.PENDING;

  @Property({ onCreate: () => Date.now() })
  seen_at: number;
}
```

---

## 3. Granular Comment Controls (Config & Frontmatter)

Comment types can be enabled globally in `config.yml` and overridden on a per-document basis in the MDX frontmatter.

### Global Configuration (`config.yml`)
```yaml
# config.yml
comments:
  enabled: true          # Global kill switch for all inbound pings & aggregation
  inbound:
    webmention: true
    pingback: true
    trackback: false     # Trackback is disabled globally by default (high spam ratio)
  aggregation:
    mastodon: true       # Auto-fetch Mastodon replies for syndicated posts
    bluesky: true        # Auto-fetch Bluesky replies for syndicated posts
    cacheTtl: 900        # 15 minutes
  akismet:
    enabled: true
    apiKey: ${AKISMET_API_KEY}
```

### Frontmatter Overrides
Authors can override the global settings for any specific document by adding a `comments` object to their frontmatter. *If present, it is deep-merged with the global config, with frontmatter taking precedence.*

```yaml
---
title: "A Highly Controversial Post"
date: 2026-07-16T12:00:00Z
type: post
syndicateTo: [mastodon, bluesky]
comments:
  inbound:
    webmention: false    # Block new webmentions for this specific post
    pingback: false      # Block pingbacks
  aggregation:
    mastodon: true       # Still show the existing Mastodon replies
    bluesky: false       # Do not fetch Bluesky replies for this post
---
```

### Implementation: Resolver Logic

When an inbound ping is received, or when the `<Comments />` component evaluates whether to fetch POSSE replies, Hypernext uses a resolver function to merge the global config with the document's frontmatter.

```typescript
// src/federation/config-resolver.ts
import { getDb } from '../database';

interface CommentConfig {
  inbound: { webmention: boolean; pingback: boolean; trackback: boolean; };
  aggregation: { mastodon: boolean; bluesky: boolean; };
}

export function resolveCommentConfig(slug: string): CommentConfig {
  const globalConfig = getConfig().comments;
  const db = getDb();
  const doc = db.prepare('SELECT metadata_json FROM docs_meta WHERE slug = ?').get(slug);
  
  if (!doc) throw new Error('Document not found');
  const frontmatter = JSON.parse(doc.metadata_json);

  const finalConfig: CommentConfig = {
    inbound: {
      webmention: frontmatter.comments?.inbound?.webmention ?? globalConfig.inbound.webmention,
      pingback: frontmatter.comments?.inbound?.pingback ?? globalConfig.inbound.pingback,
      trackback: frontmatter.comments?.inbound?.trackback ?? globalConfig.inbound.trackback,
    },
    aggregation: {
      mastodon: frontmatter.comments?.aggregation?.mastodon ?? globalConfig.aggregation.mastodon,
      bluesky: frontmatter.comments?.aggregation?.bluesky ?? globalConfig.aggregation.bluesky,
    }
  };

  if (!globalConfig.enabled) {
    finalConfig.inbound.webmention = false;
    finalConfig.inbound.pingback = false;
    finalConfig.inbound.trackback = false;
    finalConfig.aggregation.mastodon = false;
    finalConfig.aggregation.bluesky = false;
  }

  return finalConfig;
}
```

---

## 4. Inbound Receivers (Webmention, Pingback, Trackback)

Hypernext exposes three endpoints. All three normalize the incoming data and pass it to the `workmatic` worker pool.

### Endpoints
*   `POST /webmention` (Form-encoded: `source` & `target`)
*   `POST /pingback` (XML-RPC: `pingback.ping(source, target)`)
*   `POST /trackback` (Form-encoded: `url`, `title`, `excerpt`, `blog_name`)

### Worker Pipeline (`src/federation/tasks.ts -> processInboundMention`)
1.  **Validate Target & Config:** Ensure the `target` URL resolves to a valid Hypernext document slug. Call `resolveCommentConfig(targetSlug)`. If the specific inbound type is disabled, abort.
2.  **SSRF Protection:** Validate the `source` URL. Reject localhost, private IPs (10.x, 192.168.x), and non-HTTP schemes.
3.  **Fetch Source:** Download the HTML content of the `source` URL (limit 1MB, 5s timeout).
4.  **Verify Link:** Confirm the `target` URL actually appears in the source HTML (Required by Webmention/Pingback specs to prevent spoofing).
5.  **Parse mf2:** Use a microformats2 parser to extract `h-entry` data (author, content, published date).
6.  **Spam Check:** Call the Akismet service.
7.  **Store:** Upsert into the `Mention` entity via MikroORM.

---

## 5. POSSE Reply Aggregator (Mastodon & ATProto/Bluesky)

Hypernext fetches Mastodon and Bluesky threads server-side and renders them natively into the IR. This means comments appear perfectly in Gemini, Gopher, and RSS. We use a **Lazy Server-Side Fetch** strategy.

### The Lazy Fetch Strategy
When a user requests a page containing the `<Comments />` component:
1.  Call `resolveCommentConfig(currentSlug)` to check if `aggregation.mastodon` or `aggregation.bluesky` is enabled.
2.  Check the `Syndication` entity for the Mastodon/Bluesky Post IDs associated with this slug.
3.  Check an LRU cache (TTL: 15 minutes) to see if we recently fetched threads for this slug.
4.  If cache is cold, trigger a `workmatic.execute(fetchPosseReplies)` task:
    *   **Mastodon:** `GET https://{instance}/api/v1/statuses/{id}/context`
    *   **Bluesky (ATProto):** `GET https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri={at_uri}`
5.  Map the descendants/replies to the `Mention` entity and upsert them into SQLite via MikroORM.
6.  The renderer queries MikroORM for all `Mention` records where `target_slug = current_slug` AND `spam_status = 'ham'`.

### Example: Fetching Bluesky Thread (Inside Worker)
```typescript
// src/federation/bluesky-comments.ts
import { EntityManager } from '@mikro-orm/sqlite';
import { Mention, SpamStatus, MentionType } from '../database/entities/Mention';

export async function fetchBlueskyReplies(em: EntityManager, slug: string, atUri: string) {
  const res = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${atUri}`);
  const data = await res.json();
  
  if (!data.thread || !data.thread.replies) return;

  for (const reply of data.thread.replies) {
    const existing = await em.findOne(Mention, { source_url: reply.post.uri });
    if (!existing) {
      const mention = new Mention();
      mention.id = hashString(reply.post.uri + slug);
      mention.target_slug = slug;
      mention.source_url = reply.post.uri;
      mention.author_name = reply.post.author.handle;
      mention.author_url = `https://bsky.app/profile/${reply.post.author.handle}`;
      mention.author_photo = reply.post.author.avatar;
      mention.content = reply.post.record.text; 
      mention.published_at = new Date(reply.post.indexedAt).getTime();
      mention.type = MentionType.REPLY;
      mention.platform = 'bluesky';
      mention.spam_status = SpamStatus.HAM; // Assume trusted origin for aggregated replies
      em.persist(mention);
    }
  }
  await em.flush();
}
```

---

## 6. The `<Comments />` MDX Component

A built-in component added to the parser's allowlist. Because we aggregate everything into the standard IR, comments appear natively in Gemini, Gopher, and RSS.

| Component | Description | HTML Rendering (Microformats2) | Gemini/Gopher Rendering |
| :--- | :--- | :--- | :--- |
| `<Comments />` | Renders unified, non-spam mentions | `<section class="h-feed comments">...</section>` | Flattened list of `=> {source_url} Author: Content excerpt` |

### HTML Output Example
The HTML renderer wraps each mention in an `h-entry` microformat, allowing IndieWeb crawlers to see the conversation graph.

```html
<section class="comments">
  <h2>Replies</h2>
  <article class="h-entry comment">
    <div class="p-author h-card">
      <img class="u-photo" src="alice.jpg" />
      <a class="p-name u-url" href="https://bsky.app/profile/alice.bsky.social">Alice</a>
    </div>
    <time class="dt-published" datetime="2026-07-16T12:00:00Z">July 16</time>
    <div class="e-content">Great post! I totally agree.</div>
    <a class="u-in-reply-to" href="https://myblog.com/blog/my-post"></a>
  </article>
</section>
```

---

## 7. Spam Protection via Akismet API

Inbound pings are notorious for spam. We integrate the [Akismet `comment-check` endpoint](https://akismet.com/developers/detailed-docs/comment-check/) to filter malicious submissions before they are stored. If Akismet is not configured (no API key), it falls back to marking mentions as `PENDING` for manual review.

### Akismet Service (`src/federation/akismet.ts`)

```typescript
import { SpamStatus } from '../database/entities/Mention';

interface AkismetPayload {
  api_key: string;
  blog: string;          // config.site.canonicalBase
  user_ip: string;
  user_agent: string;
  referrer: string;
  permalink: string;     // The target URL on your site
  comment_type: string;  // 'webmention', 'pingback', 'trackback'
  comment_author: string;
  comment_author_url: string;
  comment_content: string;
}

export async function checkAkismet(payload: AkismetPayload): Promise<SpamStatus> {
  if (!payload.api_key) return SpamStatus.PENDING; // Safe fallback

  const endpoint = `https://${payload.api_key}.rest.akismet.com/1.1/comment-check`;
  const body = new URLSearchParams({
    blog: payload.blog,
    user_ip: payload.user_ip,
    user_agent: payload.user_agent,
    referrer: payload.referrer,
    permalink: payload.permalink,
    comment_type: payload.comment_type,
    comment_author: payload.comment_author,
    comment_author_url: payload.comment_author_url,
    comment_content: payload.comment_content,
  }).toString();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    
    const text = await response.text();
    if (text === 'true') return SpamStatus.SPAM;
    if (text === 'false') return SpamStatus.HAM;
    
    console.warn('Akismet API Error:', text);
    return SpamStatus.PENDING;
  } catch (error) {
    console.error('Akismet fetch failed:', error);
    return SpamStatus.PENDING;
  }
}
```

---

## 8. Spam Management REST API

Spam management is handled via the existing Headless REST API, allowing users to build their own moderation UIs. These endpoints are protected by the Admin API key (`api.apiKey`).

### Endpoints
*   `GET /api/v1/mentions`: List mentions with optional filters (`status`, `slug`).
*   `PATCH /api/v1/mentions/:id`: Update a mention's status (e.g., approve a pending mention).
*   `DELETE /api/v1/mentions/:id`: Delete a mention entirely.

### Fastify Route Implementation

```typescript
// src/api/moderation.ts
import { FastifyInstance } from 'fastify';
import { getEntityManager } from '../database';
import { Mention, SpamStatus } from '../database/entities/Mention';

export default async function moderationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.REST_API_KEY}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/api/v1/mentions', async (req, reply) => {
    const { status, slug, limit = 50, offset = 0 } = req.query as any;
    const em = getEntityManager();
    const where: any = {};
    if (status) where.spam_status = status;
    if (slug) where.target_slug = slug;

    const mentions = await em.find(Mention, where, {
      limit: parseInt(limit), offset: parseInt(offset), orderBy: { published_at: 'DESC' }
    });
    return { data: mentions, meta: { limit, offset } };
  });

  app.patch('/api/v1/mentions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const { spam_status } = req.body as any;
    if (!Object.values(SpamStatus).includes(spam_status)) {
      return reply.code(400).send({ error: 'Invalid spam_status' });
    }
    const em = getEntityManager();
    const mention = await em.findOne(Mention, { id });
    if (!mention) return reply.code(404).send({ error: 'Mention not found' });
    mention.spam_status = spam_status;
    await em.persistAndFlush(mention);
    return { data: mention };
  });

  app.delete('/api/v1/mentions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const em = getEntityManager();
    const mention = await em.findOne(Mention, { id });
    if (!mention) return reply.code(404).send({ error: 'Mention not found' });
    await em.removeAndFlush(mention);
    return reply.code(204).send();
  });
}
```

---

## 9. Expanded Worker Queue Usage (Indexing, Caching, Generation)

To guarantee the main event loop *never* blocks, `workmatic` is also used for core Hypernext tasks beyond federation:

1.  **Indexing & Pre-Caching:** When the file watcher detects a changed MDX file, `workmatic.execute(processDocumentJob)` handles MDX parsing, SQLite FTS5 updates, and pre-warming the LRU cache.
2.  **POSSE Syndication:** When a document is indexed and marked as `type: post`, `workmatic.execute(syndicatePostJob)` handles calling the Mastodon/Bluesky APIs and storing the returned IDs in SQLite.
3.  **PDF/EPUB Generation:** `workmatic.execute(generateEpubJob)` handles headless browser compilation for on-demand file downloads without spiking main process memory.

---

## 10. Security & Performance Considerations

1.  **V8 Heap Isolation:** By using `workmatic`, heavy HTML parsing and API polling happen in isolated V8 worker threads. Memory spikes and GC sweeps happen in the worker heap, completely bypassing the main server's TCP sockets.
2.  **SSRF Mitigation:** The Webmention/Pingback source URL fetcher strictly blocks internal IP ranges (IPv4 and IPv6) to prevent server-side request forgery.
3.  **Spam Protection:** Inbound pings are only accepted if the source HTML explicitly links to the target URL. Akismet filters out known spam IPs and content patterns automatically.
4.  **API Rate Limits:** The lazy polling strategy for Mastodon/Bluesky is naturally throttled by the 15-minute LRU cache. High traffic spikes will not result in duplicate API calls.
5.  **No External Daemons:** All aggregation is done via standard HTTPS `fetch` calls within Node.js worker threads. MikroORM handles the SQLite layer cleanly without requiring a separate database server.