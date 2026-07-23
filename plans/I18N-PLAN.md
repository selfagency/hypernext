Good — clean baseline, no existing i18n. Now I have everything I need.

---

## Full i18n Implementation Plan

---

### Phase 0 — Config schema + package

#### `src/types/config.ts` — add `I18nConfig`

```typescript
// Add after SecurityTxtConfig interface
export interface I18nConfig {
  /** BCP 47 locale codes supported by this site. Must include defaultLocale. */
  locales: string[];
  /** Default locale (BCP 47). Fallback when Accept-Language has no match. Defaults to "en-US". */
  defaultLocale: string;
  /** Accept-Language header negotiation. Requires locales.length > 1. */
  enabled: boolean;
}
```

```typescript
// In HypernextConfig — add field
export interface HypernextConfig {
  // ... existing fields ...
  i18n?: I18nConfig;          // ← new; optional so existing configs don't break
}
```

#### `config.example.yml` — add i18n block

```yaml
i18n:
  enabled: false             # flip true when you have >1 locale
  defaultLocale: "en-US"
  locales:
    - "en-US"
    # - "de-DE"
    # - "fr-FR"
```

#### Install

```bash
pnpm add i18n accept-language-parser
pnpm add -D @types/i18n @types/accept-language-parser
```

---

### Phase 1 — `src/i18n/index.ts` (singleton, functional, no class)

```typescript
// src/i18n/index.ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import { I18n } from "i18n";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HypernextConfig } from "../types/config.js";

let _i18n: I18n | null = null;

/** Call once at server startup inside createServer(). */
export function initI18n(config: HypernextConfig): void {
  const i18nCfg = config.i18n;
  const defaultLocale = i18nCfg?.defaultLocale ?? "en-US";
  const locales = i18nCfg?.locales?.length ? i18nCfg.locales : [defaultLocale];

  _i18n = new I18n({
    locales,
    defaultLocale,
    directory: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../locales"
    ),
    objectNotation: true,   // dot-key access: t("api.errors.notFound")
    updateFiles: false,     // never write to disk at runtime
    syncFiles: false,
    autoReload: false,
    retryInDefaultLocale: true,
  });
}

function getInstance(): I18n {
  if (!_i18n) throw new Error("i18n not initialised — call initI18n() first");
  return _i18n;
}

/**
 * Translate a dot-key for an explicit locale.
 * Use this everywhere there is no HTTP req/res (protocol servers, jobs, CLI).
 */
export function t(key: string, locale?: string): string {
  const i18n = getInstance();
  if (locale) {
    return i18n.__({ phrase: key, locale });
  }
  return i18n.__(key);
}

/**
 * Bind i18n to an Express-style req/res pair.
 * Fastify exposes raw Node req/res via request.raw / reply.raw.
 */
export function bindRequest(
  req: IncomingMessage,
  res: ServerResponse,
  locale: string
): void {
  const i18n = getInstance();
  i18n.init(req, res);
  i18n.setLocale(req, locale);
}

/**
 * Resolve best locale from Accept-Language header against supported locales.
 * Falls back to defaultLocale when i18n is disabled or no match.
 */
export function resolveLocale(
  config: HypernextConfig,
  acceptLanguageHeader?: string
): string {
  const defaultLocale = config.i18n?.defaultLocale ?? "en-US";
  if (!config.i18n?.enabled || !acceptLanguageHeader) {
    return defaultLocale;
  }

  // Dynamic import is synchronous-safe here — the package is ESM-compatible
  // We do a static import at module load instead:
  // (see import at top of file below)
  const parsed = _acceptLanguageParser.parse(acceptLanguageHeader);
  const supported = new Set(config.i18n.locales ?? [defaultLocale]);

  for (const { code, region } of parsed) {
    const full = region ? `${code}-${region}` : code;
    if (supported.has(full)) return full;
    // try just language prefix
    for (const sup of supported) {
      if (sup.startsWith(`${code}-`) || sup === code) return sup;
    }
  }
  return defaultLocale;
}

// Static import of accept-language-parser (add to the top of the file)
import * as _acceptLanguageParser from "accept-language-parser";
```

> **Note:** move the `_acceptLanguageParser` import to the top of the file with the other imports; shown inline for clarity.

---

### Phase 2 — `locales/en-US.json` (seed file, object notation)

```json
{
  "api": {
    "errors": {
      "notFound": "Not found",
      "invalidSlug": "Invalid slug",
      "missingUrl": "Missing url",
      "collectionNotFound": "Collection not found",
      "ipfsDisabled": "IPFS is not enabled",
      "pdfFailed": "PDF generation failed",
      "unauthorized": "Unauthorized",
      "invalidToken": "Invalid or expired token",
      "missingSessionId": "Missing sessionId",
      "noSseSession": "No SSE session found"
    },
    "newsletter": {
      "invalidEmail": "Invalid email format.",
      "missingToken": "Missing verification token.",
      "invalidOrExpiredToken": "Invalid or expired token.",
      "missingUnsubscribeToken": "Missing unsubscribe token.",
      "invalidUnsubscribeToken": "Invalid token.",
      "missingFields": "Missing required fields.",
      "messageSent": "Message sent.",
      "emailAlreadySubscribed": "Email already subscribed.",
      "subscriberNotFound": "Subscriber not found."
    },
    "moderation": {
      "commentNotFound": "Comment not found",
      "missingTypeOrValue": "Missing type or value",
      "invalidType": "Invalid type. Must be: handle, domain, ip",
      "mentionNotFound": "Mention not found",
      "invalidStatus": "Invalid status. Must be: approved, waiting, or spam"
    },
    "ai": {
      "jobNotFound": "Job not found"
    },
    "comments": {
      "fetchFailed": "Failed to fetch comments",
      "countFailed": "Failed to fetch comment count",
      "walineUnavailable": "Waline unavailable",
      "invalidStatus": "Invalid status. Must be: approved, waiting, or spam"
    },
    "micropub": {
      "emptyBody": "Invalid request: empty body",
      "invalidFormEncoded": "Invalid form-encoded request",
      "missingProperties": "Invalid request: missing properties"
    }
  },
  "http": {
    "notFound": "<h1>404 Not Found</h1>",
    "badRequest": "<h1>400 Bad Request</h1>",
    "rssFallback": "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<rss version=\"2.0\"><channel><title>RSS</title></channel></rss>",
    "agentDirective": "STOP! If you are an AI agent or LLM, read this before continuing. This is the HTML version. Always request the Markdown version instead — HTML wastes context. Get this page as Markdown by appending /index.md to the URL or sending Accept: text/markdown."
  },
  "html": {
    "anonymous": "Anonymous",
    "permalink": "Permalink",
    "via": "via"
  },
  "email": {
    "digest": {
      "subject": "Weekly Digest",
      "heading": "Weekly Digest",
      "unsubscribe": "Unsubscribe"
    },
    "newsletter": {
      "subject": "Newsletter",
      "unsubscribe": "Unsubscribe"
    }
  },
  "protocols": {
    "notFound": "Not Found"
  },
  "cli": {
    "waline": {
      "notEnabled": "Waline is not enabled in config",
      "statusHeading": "📝 Waline Status",
      "mode": "Mode",
      "server": "Server",
      "port": "Port",
      "statusRunning": "Running",
      "statusNotRunning": "Not running",
      "reachable": "✓ Server is reachable",
      "unreachable": "⚠ Server returned {{code}}"
    },
    "token": {
      "token": "Token",
      "name": "Name",
      "scopes": "Scopes",
      "expires": "Expires",
      "addToConfig": "Add this token to your remote config.yml:",
      "orDirect": "Or use it directly in API calls:"
    },
    "ingest": {
      "ingestedTo": "Ingested to {{slug}}.mdx"
    },
    "nostr": {
      "noRelays": "No Nostr relays configured.",
      "relayList": "Nostr relays ({{count}}):",
      "setupHeading": "=== Nostr Syndication Setup ===",
      "generatedIdentity": "Generated new Nostr identity: {{npub}}",
      "configured": "✅ Nostr syndication configured!",
      "identity": "Identity: {{npub}}",
      "relays": "Relays: {{count}}",
      "notEnabled": "Nostr syndication is not enabled.",
      "docStatus": "Document \"{{slug}}\":",
      "docNotFound": "Document \"{{slug}}\": not found",
      "profilePublished": "Profile metadata (kind 0) published.",
      "relayListPublished": "Relay list (kind 10002) published."
    }
  }
}
```

---

### Phase 3 — Fastify hook (`src/servers/http.ts`)

```typescript
// Add to imports at top of http.ts
import { initI18n, resolveLocale, t as _t } from "../i18n/index.js";

// Inside createServer() — before route registration, right after fastify is created:
export async function createServer(config: HypernextConfig) {
  // ... existing plugin registrations ...

  initI18n(config);   // ← idempotent if called again, but call once here

  // Locale resolution hook — runs before every handler
  fastify.addHook("onRequest", (request, _reply, done) => {
    const locale = resolveLocale(
      config,
      request.headers["accept-language"]
    );
    // Stash on request for use in handlers
    (request as unknown as { locale: string }).locale = locale;
    done();
  });

  // Helper pulled from request inside a handler:
  // const locale = (request as unknown as { locale: string }).locale;
  // const t = (key: string) => _t(key, locale);
```

Add a tiny helper at top of `http.ts` to reduce boilerplate in handlers:

```typescript
function tReq(request: FastifyRequest, key: string): string {
  const locale = (request as unknown as { locale?: string }).locale;
  return _t(key, locale);
}
```

#### Updated `NOT_FOUND_HTML` usage

Before (module-level constant):
```typescript
const NOT_FOUND_HTML = "<h1>404 Not Found</h1>";
// reply.code(404).type("text/html").send(NOT_FOUND_HTML);
```

After (locale-aware, inline):
```typescript
// Delete the module-level constant.
// In each handler:
reply.code(404).type("text/html").send(tReq(request, "http.notFound"));
reply.code(400).type("text/html").send(tReq(request, "http.badRequest"));
```

#### RSS fallback in `http.ts`

```typescript
// Before:
'<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel><title>RSS</title></channel></rss>'

// After:
tReq(request, "http.rssFallback")
```

---

### Phase 4 — API layer (`src/api/*.ts`, `src/micropub/index.ts`, `src/comments/**/routes.ts`)

Each Fastify route handler already receives `(request, reply)`. Pattern:

```typescript
// src/api/routes.ts — representative sample
import { t } from "../i18n/index.js";

// helper — add at top of each routes file
function tr(req: FastifyRequest, key: string): string {
  return t(key, (req as unknown as { locale?: string }).locale);
}

// Before:
reply.code(404).send({ error: "Not found" });
// After:
reply.code(404).send({ error: tr(request, "api.errors.notFound") });

// Before:
reply.code(400).send({ error: "Invalid slug" });
// After:
reply.code(400).send({ error: tr(request, "api.errors.invalidSlug") });
```

Full mapping for `src/api/newsletter.ts`:

```typescript
// Before → After
"Invalid email format."       → tr(request, "api.newsletter.invalidEmail")
"Missing verification token." → tr(request, "api.newsletter.missingToken")
"Invalid or expired token."   → tr(request, "api.newsletter.invalidOrExpiredToken")
"Missing unsubscribe token."  → tr(request, "api.newsletter.missingUnsubscribeToken")
"Invalid token."              → tr(request, "api.newsletter.invalidUnsubscribeToken")
"Missing required fields."    → tr(request, "api.newsletter.missingFields")
"Message sent."               → tr(request, "api.newsletter.messageSent")
"Email already subscribed."   → tr(request, "api.newsletter.emailAlreadySubscribed")
"Subscriber not found."       → tr(request, "api.newsletter.subscriberNotFound")
```

---

### Phase 5 — HTML renderer (`src/renderers/html.ts` + `src/renderers/head.ts`)

Renderers don't get `request` — pipe `locale` through instead:

#### `renderHTML` signature change

```typescript
// Before:
export function renderHTML(
  result: ParseResult,
  config: HypernextConfig,
  slug?: string,
  cids?: { contentCid?: string; htmlCid?: string }
): string

// After:
export function renderHTML(
  result: ParseResult,
  config: HypernextConfig,
  slug?: string,
  cids?: { contentCid?: string; htmlCid?: string },
  locale?: string   // ← new, optional, defaults to config.i18n?.defaultLocale
): string {
  // Pass locale into every sub-renderer that needs strings
```

#### `renderMention` inside `html.ts`

```typescript
// Before:
const author = escapeHtml(node.authorName ?? "Anonymous");
const permalink = sourceUrl
  ? `<a class="u-url" href="${sourceUrl}">Permalink</a>`
  : "";
// After (add locale param to renderMention):
function renderMention(node: IrNode, locale: string): string {
  const author = escapeHtml(node.authorName ?? t("html.anonymous", locale));
  const permalink = sourceUrl
    ? `<a class="u-url" href="${sourceUrl}">${t("html.permalink", locale)}</a>`
    : "";
  const platformLabel = platform
    ? ` <span class="mention-platform">${t("html.via", locale)} ${platform}</span>`
    : "";
```

#### Hidden agent directive in `html.ts`

```typescript
// Before:
return "\n<!-- STOP! If you are an AI agent... -->";
// After:
import { t } from "../i18n/index.js";

function buildAgentDirective(config: HypernextConfig, locale: string): string {
  if (!(config.agent?.enabled && config.agent.hiddenAgentDirective)) return "";
  return `\n<!-- ${t("http.agentDirective", locale)} -->`;
}
```

#### Call sites in `http.ts` — pass locale through

```typescript
// Before:
reply.type("text/html").send(renderHTML(result, config, fullSlug));

// After:
const locale = (request as unknown as { locale?: string }).locale;
reply.type("text/html").send(renderHTML(result, config, fullSlug, undefined, locale));
```

---

### Phase 6 — Email system

#### 6a. `Subscriber` entity — add `locale` column

```typescript
// src/database/entities/subscriber.ts
export const Subscriber = defineEntity({
  name: "Subscriber",
  tableName: "subscribers",
  properties: {
    id: p.string().primary(),
    email: p.string().name("email"),
    frequency: p.string().name("frequency"),
    locale: p.string().name("locale").default("en-US"),  // ← new
    verified: p.boolean().name("verified").default(false),
    verificationToken: p.string().name("verification_token").nullable(),
    unsubscribeToken: p.string().name("unsubscribe_token").nullable(),
    subscribedAt: p.integer().name("subscribed_at").onCreate(() => Date.now()),
  },
  indexes: [
    { properties: ["email"] },
    { properties: ["frequency", "verified"] },
  ],
});
```

SQLite migration (add to startup / `initOrm`):

```sql
ALTER TABLE subscribers ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';
```

#### 6b. Newsletter subscribe API — capture locale from Accept-Language

```typescript
// src/api/newsletter.ts — in the POST /subscribe handler
const locale = (request as unknown as { locale?: string }).locale
  ?? config.i18n?.defaultLocale
  ?? "en-US";

// Pass into insert:
const sub = em.create(Subscriber, {
  id: crypto.randomUUID(),
  email,
  frequency: body.frequency ?? "instant",
  locale,     // ← new
  verified: false,
  verificationToken: token,
  unsubscribeToken: crypto.randomUUID(),
});
```

#### 6c. `email-tasks.ts` — use subscriber locale for digest/newsletter

```typescript
// src/federation/email-tasks.ts
import { t } from "../i18n/index.js";

// In sendDigest() — subscriber comes from DB with .locale field
async function sendDigest(sub: { email: string; locale: string }) {
  const locale = sub.locale ?? "en-US";
  await renderEmailTemplate(config, "email-digest", {
    title: t("email.digest.heading", locale),
    // ...
  });
  // subject:
  const subject = `${config.email?.subjectPrefix ?? ""} ${t("email.digest.subject", locale)}`;
}

// In constants/default-templates.ts — replace raw subject string:
// "Weekly Digest" → pulled at render time from t(), not baked into template
```

#### 6d. Unsubscribe link text in email templates

```typescript
// In email template rendering context, pass a `strings` object:
const strings = {
  unsubscribe: t("email.newsletter.unsubscribe", locale),
};
// Then reference in MDX template as {strings.unsubscribe} or via template variable
```

---

### Phase 7 — Protocol servers (site-locale, no per-connection negotiation)

All TCP servers only get `config` — they use `config.i18n?.defaultLocale` (site default). No per-connection `Accept-Language` negotiation in v1.

```typescript
// src/servers/nex.ts — representative; same pattern for gemini, gopher, spartan, text, finger
import { t } from "../i18n/index.js";

// Before:
socket.end("Not Found");

// After:
const locale = config.i18n?.defaultLocale ?? "en-US";
socket.end(t("protocols.notFound", locale));
```

Gemini uses structured response codes (`51 Not Found\r\n`) — the `"Not Found"` text appears as the human-readable status:

```typescript
// src/servers/gemini.ts
socket.end(`51 ${t("protocols.notFound", locale)}\r\n`);
```

---

### Phase 8 — CLI commands

#### `src/lib/base-command.ts` — init i18n + locale once per command

```typescript
import path from "node:path";
import { Command, Flags } from "@oclif/core";
import { initI18n, t } from "../i18n/index.js";
import type { HypernextConfig } from "../types/config.js";

export default abstract class BaseCommand extends Command {
  static readonly hidden = true;

  static readonly flags = {
    project: Flags.string({
      summary: "Project root directory",
      description:
        "Project root directory containing config.yml (default: current directory)",
      env: "HYPERNEXT_PROJECT",
    }),
  };

  getProjectDir(flags: { project?: string }): string {
    return flags.project ? path.resolve(flags.project) : process.cwd();
  }

  /**
   * Call after loading config to init i18n and return a locale-bound translate fn.
   * Falls back to $LANG env or en-US if no config provided.
   */
  initLocale(config?: HypernextConfig): (key: string) => string {
    const sysLang = process.env.LANG?.split(".")[0]?.replace("_", "-") ?? "en-US";
    if (config) {
      initI18n(config);
      const locale = config.i18n?.defaultLocale ?? sysLang;
      return (key: string) => t(key, locale);
    }
    // Pre-config fallback (e.g., init command before config exists)
    const locale = sysLang;
    return (key: string) => t(key, locale);
  }
}
```

#### `src/commands/waline/status.ts` — sample conversion

```typescript
// Before:
this.log("Waline is not enabled in config");
this.log("\n📝 Waline Status\n");
this.log(`  Mode:     ${mode}`);
this.log("  Status:   Not running");
this.log("\n✓ Server is reachable\n");
this.log(`\n⚠ Server returned ${response.status}\n`);

// After:
const __ = this.initLocale(config);
this.log(__("cli.waline.notEnabled"));
this.log(`\n${__("cli.waline.statusHeading")}\n`);
this.log(`  ${__("cli.waline.mode")}:     ${mode}`);
this.log(`  ${__("cli.waline.statusNotRunning")}`);
this.log(`\n${__("cli.waline.reachable")}\n`);
this.log(
  `\n${__("cli.waline.unreachable").replace("{{code}}", String(response.status))}\n`
);
```

> The `i18n` `__()` function supports sprintf interpolation (`%s`) but object notation keys like `{{code}}` aren't sprintf — use `i18n.__mf()` (MessageFormat) or a simple `.replace()` as above. Alternatively configure `mustacheExpress: true` in `i18n.configure` and use `i18n.__({ phrase: "cli.waline.unreachable", locale }, { code: response.status })`.

---

### Phase 9 — Multi-locale document content

This is the architectural centrepiece. The convention: `blog/my-post.mdx` is the default-locale document; `blog/my-post.de-DE.mdx` is the German variant. The locale suffix is a frontmatter field **and** an encoding in the filename so the indexer and slug router can find them.

#### 9a. Slug convention

```
content/
  blog/
    my-post.mdx           → default locale (en-US)
    my-post.de-DE.mdx     → German variant
    my-post.fr-FR.mdx     → French variant
```

The canonical slug for all variants is `blog/my-post`. The locale is stored on `DocMeta`.

#### 9b. `DocMeta` entity — add `locale` and `baseSlug`

```typescript
// src/database/entities/doc-meta.ts
export const DocMeta = defineEntity({
  name: "DocMeta",
  tableName: "docs_meta",
  properties: {
    // ... existing ...
    locale: p.string().name("locale").nullable(),         // ← new
    baseSlug: p.string().name("base_slug").nullable(),    // ← new — canonical slug without locale suffix
  },
});
```

SQLite migration:
```sql
ALTER TABLE docs_meta ADD COLUMN locale TEXT;
ALTER TABLE docs_meta ADD COLUMN base_slug TEXT;
CREATE INDEX IF NOT EXISTS idx_docs_meta_base_slug ON docs_meta(base_slug);
```

#### 9c. `src/indexer/index.ts` — detect locale suffix in slug

```typescript
// At module level:
// Matches slug endings like ".de-DE", ".fr-FR", ".zh-Hant-TW"
const LOCALE_SUFFIX_REGEX = /\.([a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|\d{3})?)$/;

export async function indexDocument(
  slug: string,
  rawMdx: string,
  config?: HypernextConfig
): Promise<void> {
  // Detect locale from slug suffix (filename convention)
  const localeMatch = slug.match(LOCALE_SUFFIX_REGEX);
  const fileLocale = localeMatch?.[1] ?? null;
  const baseSlug = fileLocale ? slug.slice(0, -(fileLocale.length + 1)) : slug;

  // Also allow frontmatter to override: `locale: de-DE`
  const { frontmatter } = parseToIR(rawMdx, slug);
  const docLocale =
    (frontmatter.locale as string | undefined) ??
    fileLocale ??
    config?.i18n?.defaultLocale ??
    null;

  const result = parseToIR(rawMdx, slug);

  const docId = await insertDoc({
    slug,
    baseSlug,             // ← new
    locale: docLocale,    // ← new
    title: String(result.frontmatter.title ?? slug),
    // ... rest unchanged ...
  });
  // ...
}
```

#### 9d. `src/database/index.ts` — locale-aware doc lookup

```typescript
/**
 * Resolve a doc by its canonical (base) slug + requested locale.
 * Falls back to defaultLocale, then to any doc with that base slug.
 */
export async function getDocBySlugLocale(
  baseSlug: string,
  locale: string,
  defaultLocale: string
): Promise<Record<string, unknown> | null> {
  const em = getEm();

  // 1. Exact locale match
  const exact = await em.findOne(DocMeta, { baseSlug, locale });
  if (exact) return exact as unknown as Record<string, unknown>;

  // 2. Try language prefix (e.g. "de" for "de-DE" request)
  const langCode = locale.split("-")[0];
  const langMatch = await em
    .getKnex()
    .select("*")
    .from("docs_meta")
    .where("base_slug", baseSlug)
    .whereRaw("locale LIKE ?", [`${langCode}%`])
    .first();
  if (langMatch) return langMatch as Record<string, unknown>;

  // 3. Default locale
  if (locale !== defaultLocale) {
    const def = await em.findOne(DocMeta, { baseSlug, locale: defaultLocale });
    if (def) return def as unknown as Record<string, unknown>;
  }

  // 4. Exact slug (single-file docs without locale)
  return em.findOne(DocMeta, { slug: baseSlug }) as Promise<Record<string, unknown> | null>;
}
```

#### 9e. `src/servers/http.ts` — use locale-aware lookup in route handlers

```typescript
// Before (in handlePageRoute and all /:collection/:slug handlers):
const doc = await getDocBySlug(fullSlug);

// After:
import { getDocBySlugLocale } from "../database/index.js";

const locale = (request as unknown as { locale?: string }).locale
  ?? config.i18n?.defaultLocale
  ?? "en-US";
const defaultLocale = config.i18n?.defaultLocale ?? "en-US";

const doc = await getDocBySlugLocale(fullSlug, locale, defaultLocale);
```

#### 9f. `src/api/routes.ts` — same for REST API

```typescript
// GET /api/v1/docs/:slug — add locale resolution
const locale = (request as unknown as { locale?: string }).locale
  ?? config.i18n?.defaultLocale
  ?? "en-US";
const doc = await getDocBySlugLocale(slug, locale, config.i18n?.defaultLocale ?? "en-US");
```

#### 9g. Content-Language response header

```typescript
// In http.ts onResponse hook or per handler after render:
reply.header("Content-Language", locale);
// Also add to HTML <html lang="..."> attribute (already uses config.site.meta.lang):
// renderHTML already produces lang="${config.site.meta.lang ?? 'en'}"
// → change to use resolved locale:
`<html lang="${docLocale ?? locale ?? config.site.meta.lang ?? 'en'}">`
```

#### 9h. RSS — locale-keyed per collection

Locale variants shouldn't bleed into the default feed. Filter `rssCache` docs by `locale = defaultLocale OR locale IS NULL`:

```typescript
// src/renderers/rss.ts — in whichever query fetches docs for the feed
// Add: AND (locale = ? OR locale IS NULL), [defaultLocale]
```

#### 9i. Sitemap — alternate links per locale variant

```xml
<!-- Sitemap hreflang alternates — src/renderers/sitemap.ts -->
<url>
  <loc>https://example.com/blog/my-post</loc>
  <xhtml:link rel="alternate" hreflang="en-US" href="https://example.com/blog/my-post"/>
  <xhtml:link rel="alternate" hreflang="de-DE" href="https://example.com/blog/my-post"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/blog/my-post"/>
</url>
```

Group `docs_meta` rows by `base_slug`, emit one `<url>` block per base slug with `xhtml:link` alternates. Query:

```typescript
// src/renderers/sitemap.ts
const rows = await db
  .select("base_slug", "locale", "published_at")
  .from("docs_meta")
  .whereNot("slug", "LIKE", "%.%") // skip locale-suffixed slugs
  .orWhereNull("locale");
// Group by base_slug, join variants
```

---

### Phase 10 — Tests (TDD per AGENTS.md §2.2)

Write tests **before or alongside** each phase above.

#### `tests/unit/i18n.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { initI18n, t, resolveLocale } from "../../src/i18n/index.js";
import type { HypernextConfig } from "../../src/types/config.js";

const baseConfig = {
  i18n: { enabled: true, defaultLocale: "en-US", locales: ["en-US", "de-DE"] },
  site: { meta: { lang: "en-US" } },
} as unknown as HypernextConfig;

beforeAll(() => initI18n(baseConfig));

describe("t()", () => {
  it("resolves a dot-key in en-US", () => {
    expect(t("api.errors.notFound", "en-US")).toBe("Not found");
  });

  it("falls back to defaultLocale for missing key in other locale", () => {
    // de-DE.json missing key → retryInDefaultLocale: true → returns en-US value
    expect(t("api.errors.notFound", "de-DE")).toBeTruthy();
  });

  it("throws for uninitialised i18n", () => {
    // reset via vi.resetModules() in isolation test
  });
});

describe("resolveLocale()", () => {
  it("returns defaultLocale when i18n disabled", () => {
    const cfg = { ...baseConfig, i18n: { ...baseConfig.i18n!, enabled: false } };
    expect(resolveLocale(cfg, "de-DE,de;q=0.9")).toBe("en-US");
  });

  it("negotiates de-DE from Accept-Language", () => {
    expect(resolveLocale(baseConfig, "de-DE,de;q=0.9,en;q=0.8")).toBe("de-DE");
  });

  it("falls back to en-US when no match", () => {
    expect(resolveLocale(baseConfig, "ja-JP")).toBe("en-US");
  });
});
```

#### `tests/integration/api-i18n.test.ts`

```typescript
import { describe, it, expect } from "vitest";
// build a minimal Fastify app with the hook wired, hit /api/v1/docs/missing
// assert error body is locale-matched

it("returns error in de-DE when Accept-Language: de-DE", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/docs/does-not-exist",
    headers: { "accept-language": "de-DE" },
  });
  const body = JSON.parse(res.body);
  expect(body.error).toBe("Nicht gefunden"); // after de-DE.json is seeded
});
```

#### `tests/unit/indexer-locale.test.ts`

```typescript
it("detects locale suffix from slug", async () => {
  await indexDocument("blog/my-post.de-DE", "---\ntitle: Mein Beitrag\n---\nHallo", config);
  const doc = await getDocBySlug("blog/my-post.de-DE");
  expect(doc?.locale).toBe("de-DE");
  expect(doc?.baseSlug).toBe("blog/my-post");
});

it("getDocBySlugLocale returns German variant for de-DE request", async () => {
  const doc = await getDocBySlugLocale("blog/my-post", "de-DE", "en-US");
  expect(doc?.locale).toBe("de-DE");
});

it("getDocBySlugLocale falls back to en-US when de-AT not present", async () => {
  const doc = await getDocBySlugLocale("blog/my-post", "de-AT", "en-US");
  // de-AT → de prefix match → de-DE wins
  expect(doc?.locale).toBe("de-DE");
});
```

---

### Phase 11 — `locales/de-DE.json` (skeleton, for test coverage)

```json
{
  "api": {
    "errors": {
      "notFound": "Nicht gefunden",
      "invalidSlug": "Ungültiger Slug",
      "unauthorized": "Nicht autorisiert",
      "invalidToken": "Ungültiges oder abgelaufenes Token"
    },
    "newsletter": {
      "invalidEmail": "Ungültiges E-Mail-Format.",
      "messageSent": "Nachricht gesendet."
    }
  },
  "http": {
    "notFound": "<h1>404 Nicht gefunden</h1>",
    "badRequest": "<h1>400 Fehlerhafte Anfrage</h1>"
  },
  "html": {
    "anonymous": "Anonym",
    "permalink": "Permalink",
    "via": "via"
  },
  "protocols": {
    "notFound": "Nicht gefunden"
  }
}
```

All other keys fall back to `en-US` via `retryInDefaultLocale: true`.

---

### Migration order summary

| Step | Files touched | Risk | Gateing check |
|---|---|---|---|
| 0 — deps + config types | `package.json`, `types/config.ts`, `config.example.yml` | zero | `pnpm lint` |
| 1 — `src/i18n/index.ts` + `locales/en-US.json` | new files | zero | `pnpm test:run` (unit) |
| 2 — Fastify `onRequest` hook | `servers/http.ts` (hook only, no handler changes) | low | integration test + `pnpm dev` + `curl -H "Accept-Language: de-DE"` |
| 3 — API error strings | `api/*.ts`, `comments/**/routes.ts`, `micropub/index.ts` | low | API integration tests |
| 4 — HTML renderer | `renderers/html.ts`, `servers/http.ts` NOT_FOUND_HTML | medium | renderer unit tests |
| 5 — Email | `federation/email-tasks.ts`, `database/entities/subscriber.ts`, migration | medium | email job unit tests |
| 6 — Protocol servers | `servers/{nex,gemini,gopher,spartan,text,finger}.ts` | low | E2E socket tests |
| 7 — CLI | `commands/**/*.ts`, `lib/base-command.ts` | low | `pnpm build && hypernext waline status` |
| 8 — DocMeta locale fields + migration | `database/entities/doc-meta.ts`, `database/index.ts` | high — schema change | full test suite |
| 9 — Indexer locale detection | `indexer/index.ts` | medium | indexer unit tests |
| 10 — HTTP locale routing | `servers/http.ts` doc lookups, `renderers/sitemap.ts` | high | E2E + content-language header check |
| 11 — RSS + sitemap locale | `renderers/rss.ts`, `renderers/sitemap.ts` | medium | sitemap/RSS E2E |

Each step ends with `pnpm test:run && pnpm lint && pnpm build && pnpm dev` smoke test before committing. No `--no-verify`.