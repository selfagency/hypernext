# Hypernext — Supplemental Plan: Nostr Syndication + Waline Comments

**Branch target:** `feature/layout-templating-engine` (companion to the main `REMEDIATION-PLAN.md`)
**Scope:** Two new user-optional, per-post features for blog posts:
1. **Nostr syndication** — opt-in publishing of blog posts as Nostr `kind 30023` long-form articles (NIP-23) to user-configured relays.
2. **Waline comments** — opt-in embedding of a self-hosted Waline comment thread on individual blog posts, replacing or augmenting hypernext's native `Comments` component.

**Status:** Supplemental to the main remediation plan. All work items below assume the main plan's fixes land first (especially **P0-12** `agent.enabled` master toggle, **P1-1** SQLite+piscina job pool, **P0-5** public-read default auth model, **P0-7** passkey-first-launch auth, **P1-7** writable `templates/` directory).

**Research basis:** Waline docs (`waline.js.org`, repo `walinejs/waline`, `@waline/vercel` 1.41.3 / `@waline/client` 3.15.2), Nostr specs (NIP-01, NIP-07, NIP-19, NIP-23, NIP-33, NIP-46, NIP-65), and the three Nostr repos linked in the brief (`cameri/nostream`, `nostr-core-org/nostr-core`, `franzos/nostr-ts`). Three factual corrections to the original brief are flagged inline (NIP-68 ≠ relay reviews, `kind 30315` ≠ media, `nostr-core` is a low-adoption but feature-rich toolkit rather than the de-facto standard library).

---

## Resolved design decisions

These decisions are derived from (a) the maintainer's requirement that both features be **user-optional and per-post**, (b) the already-answered architectural decisions from the main remediation plan, and (c) concrete technical constraints discovered during research. They are not subject to further debate unless explicitly reopened in "Open questions" at the end.

| # | Decision | Rationale |
|---|---|---|
| D1 | Both features are **off by default** and gated by `syndication.nostr.enabled` and `comments.waline.enabled` respectively. Even when the global toggle is on, each blog post must opt in via frontmatter (`nostr: true` / `waline: true`) or per-post UI. | User-optional, per-post. No surprise syndication, no surprise comment threads. |
| D2 | Nostr syndication does **not** require `agent.enabled`. Nostr is a publishing/syndication feature, not an AI/agent feature — it has no LLM calls, no vector DB, no MCP wiring of its own (its MCP tools are exposed via the MCP server only because that's how hypernext exposes *any* tool, not because they are AI tools). Nostr is gated only by `syndication.nostr.enabled`. | The `agent.enabled` master toggle (per **P0-12**) is scoped to AI-class surfaces: LLM calls, vector DB, MCP server lifecycle, llms.txt, AI-generated sitemaps. Syndication to an external network is conceptually closer to RSS/Pingback than to AI generation. Forcing users to enable AI in order to syndicate blog posts to Nostr would contradict P0-12's "off by default" posture for AI specifically. Per-post opt-in (`nostr: true` frontmatter) plus the explicit `syndication.nostr.enabled` flag already provides the "no surprise syndication" guarantee without dragging the AI toggle into it. |
| D3 | Waline comments do **not** require `agent.enabled`. Comments are a reader-facing feature, not an agent feature. Waline is gated only by `comments.waline.enabled`. | Waline is self-hosted infrastructure; treating it as agent-class would force users who want comments but not AI to flip the master toggle, contradicting P0-12's intent. |
| D4 | **Nostr key management: server-held `nsec`, encrypted at rest, with optional NIP-46 bunker mode for users who refuse to put an nsec on the server.** NIP-07 browser-extension signing is offered as a *client-initiated manual publish* path (button in the post editor) but cannot be used for automated/scheduled syndication. | The maintainer's existing first-launch passkey flow (P0-7) gives us a precedent for "interactive secret setup at boot"; the same UX applies to nsec provisioning. NIP-46 bunker mode is the recommended escape hatch for security-conscious users. |
| D5 | **Nostr event type: `kind 30023` (NIP-23 long-form article).** Markdown body in `content`; tags `d` (slug), `title`, `summary`, `image`, `published_at`, `t[]` (hashtags). | NIP-23 is the canonical, spec-verified article format. Three independent sources (NIP-23 spec, write.nostr.com, nostr-core README) corroborate. |
| D6 | **Nostr permalink: `naddr1…`** (NIP-19) encoding `kind:30023 + author_pubkey + d-slug + relay-hints`. Stored in the post's frontmatter after first publish so edits re-publish with the same identity. | NIP-33 parameterized-replaceable semantics: stable across edits, unlike `nevent1`/`note1` which change each republish. |
| D7 | **Editing model: re-publish a new 30023 with the same `d` tag**, bump `created_at`, keep `published_at` constant. Relays implementing NIP-33 keep only the latest. | NIP-23 explicitly specifies this. |
| D8 | **Default Nostr library: `nostr-tools` (nbd-organization).** Not `nostr-core` (7★, no published releases — too immature), not `nostr-ts` (author calls it a learning project, no NIP-46). `nostr-tools` is the de-facto standard, MIT, audited noble-crypto stack. | Library maturity is decisive for a key-handling subsystem. Crypto primitives via `@noble/curves` + `@noble/hashtags` (already pulled in transitively by `nostr-tools`). |
| D9 | **Waline is run as a child process managed by hypernext**, not as a separately-deployed service. hypernext starts `@waline/vercel`'s `vanilla.js` on an internal port (default 8360) with env vars derived from `comments.waline.*` config. A reverse proxy on the main hypernext HTTP server exposes `/comments-api/*` → `127.0.0.1:8360/api/*` and `/comments-admin/*` → `127.0.0.1:8360/ui/*`. | User-optional means it must be a `hypernext setup` checkbox, not a Docker-compose prerequisite. Self-managed child process matches the existing single-binary deployability story. Users who already operate a standalone Waline deployment can instead point `comments.waline.serverURL` at it and skip child-process management. |
| D10 | **Waline storage adapter: SQLite** (file in the same `db/` directory as the hypernext database), via Waline's `SQLITE_PATH` env. Configurable to PostgreSQL/MySQL by setting `comments.waline.storage.type`. | Single-binary, single-file deployability. The Waline SQLite schema (`assets/waline.sqlite`) is imported automatically on first start. No new external services required for the default case. |
| D11 | **Waline client widget: official React wrapper from the Waline docs**, mounted via `next/dynamic({ ssr: false })` inside a hypernext `<WalineComments />` MDX component. Only rendered on posts with `waline: true` in frontmatter (or per-collection default). | Matches the documented Next.js integration path. SSR must be disabled because `@waline/client`'s `init()` touches `window`. |
| D12 | **Waline auth defaults: anonymous commenting enabled; first-registrant-becomes-admin disabled by overriding `LOGIN=disable` initially.** Admin registration is performed interactively during `hypernext setup` (per P2-28 wizard) — the wizard generates a random admin token, calls `POST /ui/register`, captures the JWT, stores it encrypted, then reconfigures Waline with `LOGIN=enable` (or `force` if the user chose forced-login mode). | Anonymous-by-default matches the public-read philosophy of P0-5. Forced admin registration at setup time prevents the well-known Waline "anyone who hits `/ui/register` first becomes admin" footgun. |
| D13 | **Waline OAuth: optional, self-hosted `OAUTH_URL` gateway disabled by default.** GitHub social login is available if the user configures `comments.waline.oauth.*` (client ID/secret + gateway URL or self-hosted gateway). | Avoids a hard dependency on `https://oauth.lithub.cc`. Users who want GitHub login flip the config; users who don't never see it. |
| D14 | **Nostr relay defaults: empty array.** The user must explicitly configure at least one write relay (`syndication.nostr.relays: ["wss://..."]`) before syndication can be enabled. The CLI rejects `nostr.enabled: true` with an empty `relays` list and prints a hint pointing at the `nostr setup` wizard subcommand. | Per the nostr.org example, public relays have heterogeneous write policies (some paid, some restricted). Auto-publishing to a hardcoded list would silently fail for many users. Empty-default forces a conscious choice. |
| D15 | **Nostr syndication jobs go through the same piscina pool** created by **P1-1**. Three new processors: `nostr-publish` (kind 30023 create/replace), `nostr-delete` (NIP-09 deletion event), `nostr-profile` (kind 0 metadata refresh). | Heavy I/O (WebSocket fan-out to N relays, signature computation) must not block the main event loop — same rationale as PDF/EPUB/AI work moving to piscina. |
| D16 | **Waline `path` field uses the canonical hypernext post URL** (`/blog/<slug>`), not `window.location.pathname`. Configured via the `path` prop on the `init()` call. | Waline keys comments by `path`; using the request path would split comments across trailing-slash variants, query-string variants, and protocol variants. |
| D17 | **License review required before bundling `@waline/client`.** Repo `LICENSE` says GPL-2.0; `packages/server/package.json` says MIT. This is a discrepancy that must be reconciled (or independently verified against the actual published npm tarball) before `@waline/client` is added to hypernext's runtime dependencies. If GPL-2.0 is authoritative, hypernext (currently MIT-licensed) cannot bundle Waline — it must be loaded from a CDN at runtime, or the integration must be restructured to be a "separate and independent work." | GPL-2.0 is contagious; MIT is not. This is a hard blocker that must be resolved before the Waline work lands. See open question Q1. |

---

## How this plan integrates with the existing remediation plan

This plan adds **two new subsystems** and **no new bug-fix priorities**. Each work item below cross-references the main plan items it depends on or must remain consistent with:

- **Independent of P0-12** (`agent.enabled` master toggle): Neither Nostr syndication nor Waline comments are gated by `agent.enabled`. Both are publishing/reader features, not AI features. Each is gated by its own flag (`syndication.nostr.enabled` / `comments.waline.enabled`) plus per-post frontmatter opt-in.
- **Depends on P1-1** (SQLite+piscina job pool): Nostr syndication jobs run in piscina processors.
- **Depends on P0-5** (public-read default auth): Waline's `path`-keyed comments inherit the same public-read posture. Waline admin operations (`/ui/*`) are authed.
- **Depends on P0-7** (passkey first-launch): The same first-launch interactive setup flow gains an additional step for Nostr nsec provisioning (if the user opts in to Nostr during setup).
- **Depends on P1-7** (writable `templates/` directory): Default blog post templates get an optional `<WalineComments />` slot in their footer.
- **Depends on P2-28** (`hypernext setup` wizard): The wizard gains two new checklist items — "Set up Nostr syndication" and "Set up Waline comments".
- **Depends on P2-2** (`scheduledAt` field): A scheduled post (one with `scheduledAt` in the future) must **not** syndicate to Nostr until the post becomes visible. Syndication is part of the publish cascade, not the schedule cascade.

No changes to existing P0/P1/P2/P3 work items. The two subsystems below are purely additive.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         hypernext server                            │
│                                                                     │
│  ┌────────────┐   ┌────────────┐   ┌─────────────────────────────┐  │
│  │  HTTP/SSR  │   │  piscina   │   │   child processes           │  │
│  │  render    │   │  pool      │   │  ┌────────────────────────┐ │  │
│  │            │   │            │   │  │ Waline server          │ │  │
│  │ <Waline    │   │ nostr-     │   │  │ (@waline/vercel)       │ │  │
│  │  Comments  │   │ publish    │   │  │ port 8360 (internal)   │ │  │
│  │  />        │   │ nostr-     │   │  │ SQLite: db/waline.db   │ │  │
│  │ (client)   │   │ delete     │   │  └────────────────────────┘ │  │
│  │            │   │ nostr-     │   └─────────────────────────────┘  │
│  │ /comments- │   │ profile    │                                    │
│  │  api/*     │   │            │   ┌─────────────────────────────┐  │
│  │  proxy ────┼───┼────────────┼───│ Nostr relays (wss://…)      │  │
│  │            │   │            │   │ - external, user-configured │  │
│  │ /comments- │   │            │   │ - published to via WS       │  │
│  │  admin/*   │   │            │   └─────────────────────────────┘  │
│  │  proxy ────┼───┼────────────┼───────────────────────────────────│  │
│  └────────────┘   └────────────┘                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Config                                                        │   │
│  │  agent:                                                       │   │
│  │    enabled: false   # master toggle (P0-12)                   │   │
│  │  syndication:                                                 │   │
│  │    bluesky?: …                                                │   │
│  │    mastodon?: …                                               │   │
│  │    nostr?:                                                    │   │
│  │      enabled: false                                           │   │
│  │      relays: []                                               │   │
│  │      signer: { type: 'nsec' | 'nip46', … }                   │   │
│  │      profile: { name, about, picture }                        │   │
│  │      defaultHashtags: []                                      │   │
│  │  comments:                                                    │   │
│  │    aggregation: …        # existing native comments           │   │
│  │    waline?:                                                   │   │
│  │      enabled: false                                           │   │
│  │      mode: 'embedded' | 'external'                            │   │
│  │      serverURL?: string  # only for external mode             │   │
│  │      storage: { type: 'sqlite' | 'postgres' | 'mysql', … }   │   │
│  │      auth: { anonymous: true, registration: 'closed', … }    │   │
│  │      oauth?: { gateway, github: { clientId, clientSecret } } │   │
│  │      notifications: { email: false, webhook: false, … }      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Two new subsystem directories under `src/`:

- `src/federation/nostr/` — relay client, signer abstraction, event builders, piscina processors (sibling to existing `src/federation/activitypub.ts`, `src/federation/posse-replies.ts`)
- `src/comments/waline/` — child-process manager, config-to-env mapping, HTTP proxy routes, React widget wrapper (sibling to existing `src/parser/resolver.ts` Comments resolver and `src/federation/akismet.ts`)

---

## N — Nostr syndication work items

### N1 — Config schema and validation

**Files:** `src/types/config.ts` (extend `SyndicationConfig`), `src/config.ts` (validation), `config.example.yml`, `DEFAULT_CONFIG_YAML`.

**What it does:** Adds the `nostr?` slot to `SyndicationConfig`, mirroring the existing `bluesky?`/`mastodon?` pattern. Adds validation rules.

**Schema:**

```typescript
// src/types/config.ts — extend SyndicationConfig
export interface SyndicationConfig {
  bluesky?: BlueskySyndicationConfig;
  mastodon?: MastodonSyndicationConfig;
  nostr?: NostrSyndicationConfig;            // NEW
}

export interface NostrSyndicationConfig {
  enabled: boolean;                          // master toggle for this subsystem
  relays: string[];                          // wss:// URLs to publish to
  signer:
    | { type: 'nsec'; encryptedNsec: string }    // AES-GCM-encrypted nsec, key derived from jwtSecret
    | { type: 'nip46'; bunkerUri: string };      // nostrconnect:// or bunker:// URI
  profile?: {                                 // published as kind 0 metadata on first syndication
    name?: string;
    about?: string;
    picture?: string;
    nip05?: string;                          // optional NIP-05 DNS verification
  };
  defaultHashtags?: string[];                // appended to every syndicated post's t-tags
  publishProfileOnStart?: boolean;           // refresh kind 0 on boot if stale (>30d)
  defaultRelayHints?: string[];              // relay URLs embedded in naddr permlinks
  autoSyndicateOnPublish?: boolean;          // if false, requires explicit "syndicate" action
}

// Convenience accessor:
//   getNostrAuthorPubkey(config) → string | undefined
//   decryptNsec(config) → Uint8Array (only inside piscina workers)
```

**Validation rules** (added to `validateConfig()` per **P1-9** ordering — validation runs after `mergeCliOverrides`):

1. If `syndication.nostr.enabled: true`, then `relays` MUST contain at least one `wss://` URL (per D14). Otherwise reject with `"nostr.enabled: true requires at least one relay in syndication.nostr.relays"`.
2. If `signer.type: 'nsec'`, then `encryptedNsec` MUST be a non-empty string and `jwtSecret` MUST be set (the nsec is decrypted with a key derived from `jwtSecret`). Otherwise reject.
3. If `signer.type: 'nip46'`, then `bunkerUri` MUST match `/^(nostrconnect|bunker):\/\/.+/`. Otherwise reject.
4. Relay URLs MUST match `/^wss:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i`. Reject mixed-case `ws://` (Plaintext `ws://` is forbidden; Nostr relays must use TLS).
5. `defaultHashtags` items MUST match `/^[a-z0-9_]+$/i` (no spaces — Nostr `t` tags are single tokens).

**Note:** There is deliberately **no** validation rule that ties `syndication.nostr.enabled` to `agent.enabled` — see D2. Nostr syndication is independent of the AI master toggle.

**Fix:** Implement the type extensions, validation rules, and a `getNostrAuthorPubkey(config)` accessor that derives the pubkey from the decrypted nsec (or the NIP-46 bunker's advertised pubkey after first connection). The accessor is server-only; the nsec itself never leaves the piscina worker boundary (see N2).

**Verification:**

- Unit test: each validation rule fires for the corresponding bad config.
- Unit test: valid config with `nsec` signer → `getNostrAuthorPubkey` returns a hex pubkey matching `npub1…` decoded via NIP-19.
- Boot smoke test: `syndication.nostr.enabled: true, relays: []` → server rejects startup with the validation error.
- Boot smoke test: `syndication.nostr.enabled: true, agent.enabled: false` → server **starts normally** (Nostr is not gated by `agent.enabled`, per D2) and syndication jobs run when posts with `nostr: true` frontmatter are published.

---

### N2 — Signer abstraction and key management

**Files:** `src/federation/nostr/signer.ts` (new), `src/federation/nostr/crypto.ts` (new).

**What it does:** Provides a unified `NostrSigner` interface backed by either an nsec (server-held, encrypted at rest) or a NIP-46 bunker (remote signing). The nsec is **never** decrypted in the main process — decryption happens only inside a piscina worker.

**Interface:**

```typescript
// src/federation/nostr/signer.ts
export interface NostrSigner {
  getPublicKey(): Promise<string>;           // hex pubkey
  signEvent(eventTemplate: UnsignedEvent): Promise<VerifiedEvent>;
  kind: 'nsec' | 'nip46';
}

export async function createSigner(
  config: NostrSyndicationConfig,
  ctx: { jwtSecret: string }
): Promise<NostrSigner>;

// Crypto helpers (only used inside piscina workers):
export function decryptNsec(encryptedNsec: string, jwtSecret: string): Uint8Array;
export function encryptNsec(nsec: Uint8Array, jwtSecret: string): string;
//   - AES-256-GCM, key = HKDF-SHA256(jwtSecret, salt='hypernext-nostr-nsec', info='aes-key', length=32)
//   - Output format: base64(iv ‖ ciphertext ‖ tag)
```

**nsec provisioning flow** (interactive, run during `hypernext setup` per P2-28):

1. Wizard prompts: "Generate a new Nostr identity (recommended) or import an existing nsec?"
2. If generate: call `generateSecretKey()` from `nostr-tools`, display the `npub1…` to the user, warn that losing the encrypted nsec + `jwtSecret` together is unrecoverable, write the encrypted form to config.
3. If import: prompt for `nsec1…`, validate by decoding with `nip19.decode()`, re-encrypt, write to config.
4. Display the `npub1…` and instruct the user to back it up to a password manager / hardware wallet. The server does not retain the plaintext nsec anywhere.

**NIP-46 bunker mode:**

1. Wizard prompts for a `bunker://…` or `nostrconnect://…` URI (typically obtained from Alby or nsec.app).
2. The URI is stored as-is in `signer.bunkerUri` (no encryption needed — the URI contains a connection secret but not the nsec itself).
3. At sign time, the worker opens a WebSocket to the bunker's relay, sends a NIP-04-encrypted `sign_event` request, waits for the signed event response.

**Why the worker-only decryption:** The main HTTP process handles untrusted requests. If a request-handling bug (or a future SSRF) ever exposed in-memory nsec material, an attacker could drain Lightning wallets associated with the same key. Confining decryption to piscina workers means the main process's heap never contains the raw nsec. Workers are short-lived (one job per worker lifecycle in piscina's default mode) and have no HTTP surface.

**Fix:**

1. Implement `src/federation/nostr/signer.ts` with both backends.
2. Implement `src/federation/nostr/crypto.ts` with the AES-GCM encrypt/decrypt + HKDF key derivation.
3. Add a `hypernext nostr setup` CLI subcommand that runs the provisioning wizard standalone (also invoked by the main `hypernext setup` checklist per P2-28).
4. Add a `hypernext nostr inspect` CLI subcommand that prints the configured npub, relay list, and profile — without ever printing the nsec.

**Verification:**

- Unit test: `encryptNsec` → `decryptNsec` round-trips.
- Unit test: `decryptNsec` with wrong `jwtSecret` throws (GCM auth tag mismatch).
- Unit test: nsec signer's `getPublicKey()` matches the npub encoded from the same key.
- Integration test: NIP-46 signer against a mock bunker (a small in-process WebSocket server that responds to `sign_event` requests) successfully signs a kind:1 event.
- Memory test (best-effort): after a `nostr-publish` job completes, `process.memoryUsage().heapUsed` of the main process does not contain the nsec byte sequence (grep the heap dump).

---

### N3 — Relay client

**Files:** `src/federation/nostr/relay.ts` (new), `src/federation/nostr/pool.ts` (new).

**What it does:** WebSocket client that publishes events to all configured relays and (optionally) subscribes to replies/mentions. Built on `nostr-tools`' `SimplePool` for the common case; a thin wrapper exposing the publish-and-collect-OKs flow.

**Publish flow:**

1. Open `SimplePool` with the configured relay list.
2. For each event: call `pool.publish(relays, event)` — returns a `Promise<void>` per relay that resolves on `["OK", eventId, true]` and rejects on `["OK", eventId, false, reason]` or timeout (default 10s).
3. Collect per-relay outcomes. If **zero** relays accepted the event, mark the job as failed with the per-relay error messages. If **at least one** relay accepted, mark the job as succeeded but log the failures.
4. Close the pool's WebSocket connections after a short drain window (1s) to avoid holding sockets open between jobs.

**Reply/mention subscription** (optional, off by default):

- If `syndication.nostr.subscribeReplies: true`, the main process maintains a long-lived `SimplePool` subscription for `kind: 1` and `kind: 1111` events with `#a` tags matching the author's `30023:pubkey:slug` coordinates.
- Inbound replies are surfaced in the hypernext admin UI as Nostr-native comments (separate from the existing POSSE reply aggregation per **P1-2** — Nostr replies are first-class, not POSSE).
- This subscription is **disabled by default** because it holds open WebSockets indefinitely, which is incompatible with the $5-VPS resource budget.

**Why `nostr-tools` and not `nostr-core` or `nostr-ts`:**

- `nostr-tools` (nbd-organization): de-facto standard, MIT, audited noble-crypto stack, used by Damus, Iris, Snort, and most production Nostr clients. Active maintenance. **Chosen.**
- `nostr-core` (nostr-core-org): 7★, 1 fork, **no published npm releases** as of research date. Has an attractive unified `Signer` interface and an RSS→NIP-23 importer, but the adoption signal is too weak to bet a key-handling subsystem on. Revisit in 6–12 months.
- `nostr-ts` (franzos): author self-describes as a learning project. No NIP-46 support. Last commit Apr 2026. Suitable for experimentation, not production.

**Fix:**

1. Add `nostr-tools` and `ws` (already a transitive dep) to `package.json`.
2. Implement `src/federation/nostr/relay.ts` with the publish-and-collect-OKs flow.
3. Implement `src/federation/nostr/pool.ts` with the optional long-lived subscription pool, gated behind `subscribeReplies: true`.
4. Add a 30-second timeout on the entire publish flow (prevent stuck workers if all relays hang).

**Verification:**

- Integration test against a local mock relay (small WS server that accepts `EVENT` and replies `OK true`).
- Integration test: one relay accepts, one rejects → job marked succeeded, rejection logged.
- Integration test: all relays reject → job marked failed with aggregated error.
- Integration test: all relays timeout → job marked failed after 30s.

---

### N4 — Event builders (kind 30023, kind 0, NIP-09 deletion)

**Files:** `src/federation/nostr/events.ts` (new).

**What it does:** Pure functions that build unsigned event templates from hypernext domain objects. No I/O. Easily unit-testable.

**Event builders:**

```typescript
// src/federation/nostr/events.ts
import type { Event } from 'nostr-tools';

export function buildLongFormArticleEvent(opts: {
  slug: string;                    // → d tag
  title: string;                   // → title tag
  summary?: string;                // → summary tag
  contentMarkdown: string;         // → content
  imageUrl?: string;               // → image tag (cover)
  hashtags: string[];              // → t tags
  publishedAt: number;             // unix seconds of first publication → published_at tag
  createdAt?: number;              // defaults to now
}): Omit<Event, 'pubkey' | 'id' | 'sig'>;

export function buildProfileMetadataEvent(opts: {
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
}): Omit<Event, 'pubkey' | 'id' | 'sig'>;

export function buildDeletionEvent(opts: {
  targetEventId: string;           // the 30023 id being deleted
  reason?: string;
}): Omit<Event, 'pubkey' | 'id' | 'sig'>;

export function buildRelayListEvent(opts: {
  relays: Array<{ url: string; read: boolean; write: boolean }>;
}): Omit<Event, 'pubkey' | 'id' | 'sig'>;  // kind 10002 (NIP-65)
```

**Markdown handling:**

- The hypernext post body is **already Markdown** (it's the source format the indexer ingests). The `content` of the 30023 event is the raw Markdown, unmodified.
- Image references inside the Markdown body are left as-is. The `image` tag (cover) is populated from the post's `featuredImage` frontmatter if present.
- Hashtags come from the post's `tags` frontmatter, filtered to NIP-23's single-token format (lowercase, no spaces). The configured `defaultHashtags` are appended.
- Internal hypernext links (`[foo](/blog/bar)`) are rewritten to absolute URLs using `config.site.url` so Nostr clients can resolve them.

**Why no `published_at` bumping on edit:** NIP-23 specifies that `published_at` is the **first** publication timestamp and MUST stay constant across edits. The `created_at` field is the **last update** timestamp. `buildLongFormArticleEvent` enforces this contract: it accepts an explicit `publishedAt` (read from frontmatter after first syndication) and an optional `createdAt` (defaults to `now`).

**Fix:**

1. Implement the four builders.
2. Add a `kind 30023` validation step that asserts the built event matches NIP-23's tag set (warning, not error, on missing `title`).
3. Add a `rewriteInternalLinks(markdown, siteUrl)` helper.

**Verification:**

- Unit test: built 30023 event has the expected tags, content, kind.
- Unit test: `rewriteInternalLinks` correctly absolutizes relative URLs.
- Unit test: `publishedAt` is preserved across two builds with the same slug.
- Property test: `finalizeEvent(buildLongFormArticleEvent(random))` produces a valid signature verifiable by `verifyEvent`.

---

### N5 — Publish flow and piscina processor

**Files:** `src/jobs/processors/nostr-publish.ts` (new), `src/jobs/processors/nostr-delete.ts` (new), `src/jobs/processors/nostr-profile.ts` (new), `src/federation/nostr/schedule.ts` (new), `src/indexer/index.ts` (modify the post-index cascade per **P1-1**).

**What it does:** Three new piscina processors that perform the actual syndication. Scheduled from the post-index cascade and from explicit API/CLI/MCP triggers.

**`nostr-publish` processor:**

1. Receive job payload: `{ slug, action: 'create' | 'update' }`.
2. Load the post from the ORM.
3. If `action: 'create'` and the post already has `nostrNaddr` in frontmatter: abort (treat as update instead — see N6).
4. If `action: 'update'` and the post has no `nostrNaddr`: abort (nothing to update — log warning).
5. Check the post's `nostr: true` frontmatter. If absent or false: abort with `skipped` status.
6. Check `publishedAt` / `scheduledAt` (per **P2-2**). If `scheduledAt` is in the future: abort with `skipped` status. (Syndication is part of the publish cascade, not the schedule cascade.)
7. Decrypt the nsec inside the worker (N2). Create the signer.
8. Build the 30023 event (N4). If this is an update, reuse the existing `d` tag (the slug) and the existing `publishedAt`.
9. Sign and publish to all relays (N3).
10. On first successful publish:
    - Compute the `naddr1…` permalink from `(kind=30023, pubkey, d=slug, relayHints)`.
    - Write `nostrNaddr` and `nostrPublishedAt` to the post's frontmatter and persist.
    - Optionally publish a kind 1 announcement note linking to the article (configurable via `syndication.nostr.announceOnFirstPublish: boolean`, default false).
11. On subsequent publishes: bump `created_at`, preserve `publishedAt`, re-sign, publish.
12. Return `{ naddr, relayResults: Array<{ url, ok, reason? }> }`.

**`nostr-delete` processor:**

1. Receive job payload: `{ slug }`.
2. Load the post. If it has no `nostrNaddr`: abort.
3. Look up the most-recent 30023 event id (either stored in frontmatter after step 10 of publish, or fetched from relays via `{"kinds":[30023], "authors":[pubkey], "#d":[slug]}`).
4. Build and sign a kind 5 deletion event referencing that id.
5. Publish to all relays.
6. Clear `nostrNaddr` and `nostrPublishedAt` from frontmatter.
7. Return `{ deletedEventId, relayResults }`.

**`nostr-profile` processor:**

1. Receive job payload: `{}` (uses config).
2. Build and sign a kind 0 metadata event from `syndication.nostr.profile`.
3. Publish to all relays.
4. Also publish a kind 10002 relay list event (NIP-65) advertising the configured relays — this is the outbox model so other clients can find the author.
5. Return `{ metadataEventId, relayListEventId, relayResults }`.

**Schedule helpers** (in `src/federation/nostr/schedule.ts`):

```typescript
export function scheduleNostrPublish(slug: string, action: 'create' | 'update'): string {
  return schedule('nostr-publish', { slug, action }, { idempotencyKey: `nostr-publish:${slug}:${action}` });
}
export function scheduleNostrDelete(slug: string): string {
  return schedule('nostr-delete', { slug }, { idempotencyKey: `nostr-delete:${slug}` });
}
export function scheduleNostrProfile(): string {
  return schedule('nostr-profile', {}, { idempotencyKey: 'nostr-profile' });
}
```

**Wiring into the post-index cascade** (per P1-1):

- After `scheduleIndexing(slug)` completes successfully, the indexer checks if `syndication.nostr.enabled: true` and the post has `nostr: true` in frontmatter.
- If both: calls `scheduleNostrPublish(slug, post.nostrNaddr ? 'update' : 'create')`.
- This wiring is conditional on the post being **visible** (not scheduled in the future, not hidden).

**Fix:**

1. Implement the three processors.
2. Add them to the piscina worker's processor registry.
3. Add the schedule helpers.
4. Wire the post-index cascade.
5. Add a `hypernext nostr publish <slug>` CLI subcommand that calls `scheduleNostrPublish(slug, …)` and polls the job to completion (or 30s timeout) for interactive use.

**Verification:**

- E2E test: create a post with `nostr: true`, boot server with mock relays, assert `nostr-publish` job runs, `nostrNaddr` appears in frontmatter, mock relay received a 30023 event with correct tags.
- E2E test: edit the post, re-index, assert `nostr-publish` job runs with `action: 'update'`, mock relay received a new 30023 with same `d` tag and newer `created_at`.
- E2E test: delete the post (or set `nostr: false`), assert `nostr-delete` job runs, mock relay received a kind 5 event.
- E2E test: post with `scheduledAt: 2099-01-01` and `nostr: true` — assert no `nostr-publish` job is scheduled.
- E2E test: post with `nostr: true` but `syndication.nostr.enabled: false` — assert no `nostr-publish` job is scheduled.

---

### N6 — Frontmatter contract and per-post opt-in

**Files:** `src/types/frontmatter.ts` (extend), `src/indexer/frontmatter.ts` (parse new fields), `docs/content-authoring.md` (new section).

**What it does:** Defines the per-post frontmatter contract for Nostr syndication. Per-post opt-in is via `nostr: true`.

**Frontmatter fields:**

```yaml
---
title: My Article
slug: my-article
publishedAt: 2026-07-22T10:00:00Z
scheduledAt: 2026-07-25T10:00:00Z   # P2-2 — visibility gate
nostr: true                          # opt this post into Nostr syndication
nostrNaddr: nostr1…                  # written by hypernext after first publish; do not edit
nostrPublishedAt: 1737500000         # unix seconds, written by hypernext; preserved across edits
nostrHashtags:                       # optional per-post hashtags (merged with config defaults)
  - hypernext
  - indieweb
nostrAnnounce: true                  # optional: publish a kind 1 announcement note on first publish
---
```

**Rules:**

1. `nostr: true` is required for syndication. Absent or `false` means "never syndicate this post even if `syndication.nostr.enabled: true`."
2. `nostrNaddr` and `nostrPublishedAt` are **hypernext-managed**. The CLI rejects manual edits with a warning. They are written by the `nostr-publish` processor after the first successful publish.
3. If `nostrNaddr` is present and the post is edited: the next syndication treats it as an update (re-uses the same `d` tag = slug).
4. If `nostr: true` is removed from a post that has `nostrNaddr`: the `nostr-delete` processor is scheduled to publish a kind 5 deletion event. (The post itself is not deleted from hypernext — only its Nostr presence.)
5. `nostrHashtags` is merged with `syndication.nostr.defaultHashtags`. Deduplication is case-insensitive.
6. `nostrAnnounce: true` triggers an additional kind 1 short note with `content = "New post: <title>\n\nnaddr1…"` after the first successful publish.

**Per-post vs per-collection default:** A collection can specify `nostrDefault: true` in its config, which sets `nostr: true` on all posts in that collection unless the post explicitly sets `nostr: false`. This is useful for a "blog" collection where every post should syndicate.

**Fix:**

1. Extend the frontmatter parser to accept the new fields with strict validation (reject malformed `nostrNaddr`).
2. Add a "field is managed by hypernext" warning to the linter if a user manually edits `nostrNaddr` / `nostrPublishedAt`.
3. Document the contract in `docs/content-authoring.md` with examples.

**Verification:**

- Unit test: parse all six new fields with valid values.
- Unit test: reject malformed `nostrNaddr` with a clear error.
- E2E test: remove `nostr: true` from a post that has `nostrNaddr` → `nostr-delete` job scheduled.
- E2E test: collection with `nostrDefault: true` → new post without explicit `nostr` field is syndicated.

---

### N7 — MCP tool exposure

**Files:** `src/mcp/tools.ts` (extend), `src/federation/nostr/mcp-tools.ts` (new).

**What it does:** Exposes three MCP tools for Nostr syndication. **Not gated by `agent.enabled`** (per D2 — Nostr is a syndication feature, not an AI feature). The tools are gated only by `syndication.nostr.enabled` and the standard P0-5 auth model.

**Tools:**

| Tool name | Input | Output | Auth |
|---|---|---|---|
| `nostr_publish` | `{ slug: string }` | `{ naddr, relayResults }` | admin (per P0-5 auth model — mutating operation) |
| `nostr_delete` | `{ slug: string }` | `{ deletedEventId, relayResults }` | admin |
| `nostr_inspect` | `{ slug?: string }` | `{ npub, relays, profile, post? }` | public (read-only, no PII beyond what's already public on Nostr) |

**Gating logic:**

1. If `config.syndication.nostr?.enabled` is false: tools are **not registered**.
2. `nostr_publish` and `nostr_delete` require admin auth (per the resolved P2-22 PII policy — mutating operations are admin-only).
3. `nostr_inspect` is public-read (the npub and relays are already public on Nostr by definition).

**Note:** Per D2, there is **no** `agent.enabled` check here. If the MCP server itself is disabled by `agent.enabled: false` (per P0-12), then *no* MCP tools are registered — including these — because the MCP server isn't running. But that is a property of the MCP server's lifecycle, not a property of the Nostr subsystem. If `agent.enabled: true` (MCP server running) and `syndication.nostr.enabled: true`, the Nostr tools are registered regardless of whether the user actually uses AI features.

**Why `nostr_inspect` is public:** The npub is derived from the configured nsec and is published in every event's `pubkey` field — it's not secret. The relay list is published as a kind 10002 event — also not secret. Exposing this read-only info via MCP lets external agents (e.g. a research agent) discover "what's the Nostr identity of this hypernext instance?" without admin auth.

**Fix:**

1. Add the three tool definitions to `src/federation/nostr/mcp-tools.ts`.
2. Register them in `src/mcp/tools.ts` with the single-level `syndication.nostr.enabled` gate (no `agent.enabled` check — see D2).
3. Ensure `nostr_publish` and `nostr_delete` schedule jobs (don't run inline) so the MCP call returns immediately with a job ID.

**Verification:**

- E2E test: `agent.enabled: false, syndication.nostr.enabled: true` → MCP server itself is down (per P0-12), so `tools/list` returns no tools at all. This is **not** a Nostr-specific gate — it's the MCP server being off.
- E2E test: `agent.enabled: true, syndication.nostr.enabled: false` → Nostr tools not in `tools/list` response (other MCP tools still present).
- E2E test: both enabled → `nostr_inspect` callable without auth; `nostr_publish` and `nostr_delete` return 401 without auth, succeed with auth.

---

### N8 — CLI commands

**Files:** `src/cli/nostr.ts` (new), `src/cli/index.ts` (register subcommands).

**Subcommands:**

| Command | Action |
|---|---|
| `hypernext nostr setup` | Interactive nsec provisioning wizard (also part of `hypernext setup` per P2-28). |
| `hypernext nostr inspect` | Print configured npub, relays, profile. Never prints the nsec. |
| `hypernext nostr publish <slug>` | Schedule a `nostr-publish` job and poll to completion (30s timeout). Prints the `naddr` on success. |
| `hypernext nostr delete <slug>` | Schedule a `nostr-delete` job and poll. |
| `hypernext nostr profile` | Schedule a `nostr-profile` job and poll. Refreshes kind 0 + kind 10002. |
| `hypernext nostr relays list` | Print configured relays. |
| `hypernext nostr relays add <url>` | Add a relay to config (with validation). |
| `hypernext nostr relays remove <url>` | Remove a relay from config. |

**Fix:** Implement the subcommands using the existing `oclif` CLI framework (per **P1-10** — the project moved from `cac` to `oclif`).

**Verification:**

- E2E test: each subcommand produces the expected output against a running server with mock relays.
- E2E test: `nostr inspect` output does not contain the nsec string (grep assertion).

---

## W — Waline comments work items

### W1 — Config schema and validation

**Files:** `src/types/config.ts` (extend `CommentConfig`), `src/config.ts` (validation), `config.example.yml`, `DEFAULT_CONFIG_YAML`.

**What it does:** Adds the `waline?` slot to `CommentConfig`.

**Schema:**

```typescript
// src/types/config.ts — extend CommentConfig
export interface CommentConfig {
  aggregation: CommentAggregationConfig;
  akismet: CommentAkismetConfig;
  allowPrivateSources?: boolean;
  blocklist?: CommentBlocklistConfig;
  enabled: boolean;
  inbound: CommentInboundConfig;
  waline?: WalineCommentConfig;               // NEW
}

export interface WalineCommentConfig {
  enabled: boolean;                            // master toggle
  mode: 'embedded' | 'external';               // embedded = hypernext manages the Waline server; external = point at user's existing deployment
  serverURL?: string;                          // required for external mode; computed for embedded mode
  storage:
    | { type: 'sqlite'; path: string }         // default; path relative to project root
    | { type: 'postgres'; host: string; port?: number; db: string; user: string; password: string; ssl?: boolean }
    | { type: 'mysql'; host: string; port?: number; db: string; user: string; password: string; ssl?: boolean };
  auth: {
    anonymous: boolean;                        // allow anonymous commenting (default true)
    registration: 'closed' | 'open' | 'admin-only';  // who can register Waline accounts (default 'closed' — admin created during setup)
    login: 'enable' | 'disable' | 'force';     // Waline LOGIN env var
  };
  oauth?: {
    gateway: 'self-hosted' | string;           // URL of OAuth gateway; 'self-hosted' = run gateway as part of hypernext
    github?: { clientId: string; clientSecret: string };
  };
  notifications: {
    email?: { smtp: SmtpConfig; senderName?: string; senderEmail: string };
    webhook?: string;                          // generic WEBHOOK
    discord?: string;                          // webhook URL
    telegram?: { botToken: string; chatId: string };
  };
  antiSpam: {
    akismet: boolean;                          // default true; uses Waline's bundled key unless overridden
    ipqps: number;                             // seconds between comments per IP (default 60)
    audit: boolean;                            // COMMENT_AUDIT — admin must approve every comment (default false)
    secureDomains: string[];                   // SECURE_DOMAINS — allowed origins
  };
  markdown: {
    highlight: boolean;
    emoji: boolean;
    tex: 'mathjax' | 'katex' | false;
  };
  pageview: {
    enabled: boolean;                          // use Waline's pageview counter
    replaceNative: boolean;                    // replace hypernext's native pageview counter
  };
  port?: number;                               // internal port for embedded Waline server (default 8360)
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}
```

**Validation rules:**

1. If `comments.waline.enabled: true` and `mode: 'external'`: `serverURL` MUST be a valid `https://` URL.
2. If `mode: 'embedded'` and `storage.type: 'sqlite'`: `path` MUST be a relative path under the project root (reject absolute paths and `..` traversal — same protection as **P2-1**).
3. If `auth.registration: 'open'`: warn the user that anyone can register and the first registrant becomes admin (Waline's hardcoded behavior). Recommend `'admin-only'` instead.
4. If `auth.login: 'force'`: `auth.registration` MUST NOT be `'closed'` (no way for users to log in). Reject.
5. If `notifications.email` is set: all SMTP fields MUST be present.
6. If `oauth.github` is set: `clientId` and `clientSecret` MUST both be non-empty.
7. `antiSpam.secureDomains` MUST include at least `config.site.url`'s origin (warn if missing).

**Fix:** Implement the type extensions and validation rules.

**Verification:**

- Unit test: each validation rule fires for the corresponding bad config.
- Boot smoke test: `comments.waline.enabled: true, mode: 'embedded', storage.type: 'sqlite'` → server boots, Waline child process starts, `/comments-api/` proxy responds.

---

### W2 — Child process manager (embedded mode)

**Files:** `src/comments/waline/process.ts` (new), `src/app.ts` (modify startup), `src/comments/waline/env.ts` (new).

**What it does:** Starts and supervises the Waline server (`@waline/vercel`'s `vanilla.js`) as a child process during hypernext server startup. Translates `WalineCommentConfig` into the env vars Waline expects.

**Process lifecycle:**

1. **Start:** during `startAllServers()` in `src/app.ts`, after ORM init and `createStorage()` (per P0-13), if `comments.waline.enabled: true` and `mode: 'embedded'`:
   - Spawn `node node_modules/@waline/vercel/vanilla.js` with env vars derived from config (see W2 env mapping below).
   - Wait for the Waline server to bind to the internal port (poll `GET http://127.0.0.1:<port>/api/comment?type=count&url=__health` until 200 or 30s timeout).
   - If Waline fails to start: log the error and either (a) crash the server (strict mode, default) or (b) degrade gracefully (continue without comments, log warning). Mode is configurable via `comments.waline.strictStartup: boolean` (default true).
2. **Health:** every 60s, poll the health endpoint. If unreachable for 3 consecutive checks, restart the child process (max 3 restarts in 10 minutes — back off if exceeded).
3. **Shutdown:** on `SIGTERM`/`SIGINT` to hypernext, send `SIGTERM` to the Waline child, wait 5s, escalate to `SIGKILL` if still alive.

**Env var mapping** (`src/comments/waline/env.ts`):

| Config field | Waline env var |
|---|---|
| `site.url` + `site.name` | `SITE_URL`, `SITE_NAME` |
| `storage.type: 'sqlite'` → `{path}` | `SQLITE_PATH=<path>`, `JWT_TOKEN=<derived from jwtSecret>` |
| `storage.type: 'postgres'` → `{host,port,db,user,password,ssl}` | `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, `PG_PASSWORD`, `PG_SSL` |
| `storage.type: 'mysql'` → `{…}` | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DB`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_SSL` |
| `auth.login` | `LOGIN=<enable|disable|force>` |
| `auth.anonymous` | (controlled via client `login`/`requiredMeta` props — no server env) |
| `notifications.email.smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SENDER_EMAIL`, `SENDER_NAME` |
| `notifications.webhook` | `WEBHOOK` |
| `notifications.discord` | `DISCORD_WEBHOOK` |
| `notifications.telegram` | `TG_BOT_TOKEN`, `TG_CHAT_ID` |
| `antiSpam.akismet` | `AKISMET_KEY=<default if true, 'false' if false>` |
| `antiSpam.ipqps` | `IPQPS` |
| `antiSpam.audit` | `COMMENT_AUDIT=true|false` |
| `antiSpam.secureDomains` | `SECURE_DOMAINS=<comma-separated>` |
| `markdown.highlight` | `MARKDOWN_HIGHLIGHT` |
| `markdown.emoji` | `MARKDOWN_EMOJI` |
| `markdown.tex` | `MARKDOWN_TEX=mathjax|katex|false` |
| `oauth.gateway` + `oauth.github` | `OAUTH_URL` (default `https://oauth.lithub.cc` unless `'self-hosted'`) |

**Schema bootstrap:** on first start with SQLite storage, the Waline server requires the `assets/waline.sqlite` schema to be imported. The process manager detects an empty/nonexistent `SQLITE_PATH` file and imports the schema (shipped as a hypernext asset) before spawning the child.

**Why a child process and not an in-process ThinkJS app:** Waline's server is a ThinkJS 4 app with its own middleware stack, ORM, and routing. Running it in-process would require deep integration with hypernext's Fastify instance (rewriting all routes, sharing the ORM, etc.) — far more work than the value justifies, and brittle to Waline upgrades. The child-process approach gives us a clean upgrade path (bump `@waline/vercel` version without touching hypernext code) and clear process isolation.

**Fix:**

1. Implement `src/comments/waline/env.ts` (config → env vars).
2. Implement `src/comments/waline/process.ts` (spawn, health, restart, shutdown).
3. Wire into `startAllServers()` and the shutdown handler in `src/app.ts`.
4. Ship `assets/waline.sqlite` (copied from `@waline/vercel/assets/` at install time) for first-start schema import.

**Verification:**

- E2E test: boot hypernext with `comments.waline.enabled: true, mode: 'embedded', storage.type: 'sqlite'`. Assert Waline child is running, health endpoint responds 200, `GET /comments-api/comment?type=count&url=/blog/test` returns a count (initially 0).
- E2E test: kill the Waline child process mid-flight. Assert hypernext detects the failure within 60s and restarts the child. Assert comment API recovers.
- E2E test: `SIGTERM` hypernext. Assert Waline child receives `SIGTERM` and exits before hypernext exits.
- E2E test: `strictStartup: false` + Waline fails to start. Assert hypernext continues serving pages without comments (the `<WalineComments />` component renders an error message instead of the widget).

---

### W3 — HTTP proxy routes

**Files:** `src/comments/waline/proxy.ts` (new), `src/api/routes.ts` (register proxy routes).

**What it does:** Proxies requests from the main hypernext HTTP server to the internal Waline server, so external clients only see hypernext's domain. This avoids CORS issues (Waline's `SECURE_DOMAINS` config would otherwise need to list every client origin) and keeps the Waline server unexposed.

**Routes:**

| Hypernext route | Proxied to | Auth |
|---|---|---|
| `GET /comments-api/comment` | `GET http://127.0.0.1:<port>/api/comment` | public (read-only, matches P0-5) |
| `POST /comments-api/comment` | `POST http://127.0.0.1:<port>/api/comment` | public (anonymous commenting is the default) |
| `GET /comments-api/article` | `GET http://127.0.0.1:<port>/api/article` | public |
| `POST /comments-api/article` | `POST http://127.0.0.1:<port>/api/article` | public |
| `GET /comments-admin/*` | `GET http://127.0.0.1:<port>/ui/*` | admin (per P0-5) |
| `POST /comments-admin/*` | `POST http://127.0.0.1:<port>/ui/*` | admin |

**Proxy implementation:**

- Use Fastify's `@fastify/http-proxy` plugin (or a manual `fetch`-based proxy).
- Forward `X-Forwarded-For`, `X-Forwarded-Proto`, `User-Agent` headers so Waline's IP rate limiting and Akismet checks work correctly.
- Strip cookies from the proxied response (Waline sets its own cookies on `127.0.0.1:<port>`; we re-set them on the hypernext domain).
- For `/comments-admin/*`: require admin auth (per the P0-5 model — all CRUD/admin is authed).

**Why proxy instead of exposing the Waline port directly:**

1. **Single port deployability.** Hypernext's value proposition is "one binary, one port, one config." Forcing users to expose a second port for Waline breaks this.
2. **TLS termination.** Waline doesn't terminate TLS; hypernext does (or is reverse-proxied by a TLS-terminating Nginx). Routing Waline through hypernext's HTTP server means TLS is handled once.
3. **Auth consistency.** The `/comments-admin/*` route gets the same admin auth as the rest of hypernext's admin API. Users don't have to log in twice.
4. **CORS avoidance.** The Waline client widget calls `serverURL` directly from the browser. If `serverURL` were `http://127.0.0.1:8360`, the browser couldn't reach it (and even if it could, mixed-content/CORS would bite). By exposing Waline via `/comments-api/*` on the hypernext domain, the widget's calls are same-origin.

**Client `serverURL` configuration:** the `<WalineComments />` widget is initialized with `serverURL: '/comments-api'` (relative URL). This works because the proxy is mounted on the same domain.

**Fix:**

1. Implement `src/comments/waline/proxy.ts` with the six proxy routes.
2. Register the routes in `src/api/routes.ts`.
3. Add an `onRequest` hook on `/comments-admin/*` that requires admin auth.
4. Add per-route rate limiting (reuse the rate-limiter from P2-16 for `POST /comments-api/comment`).

**Verification:**

- E2E test: `GET /comments-api/comment?type=count&url=/blog/test` returns the count from Waline.
- E2E test: `POST /comments-api/comment` with a valid comment body returns 200, the comment appears in `GET /comments-api/comment?path=/blog/test`.
- E2E test: `GET /comments-admin/` without admin auth returns 401; with admin auth returns the Waline admin UI HTML.
- E2E test: header forwarding — submit a comment with `X-Forwarded-For: 1.2.3.4`. Verify Waline's IP-based rate limiting counts against `1.2.3.4` (submit a second comment within `ipqps` seconds → rejected).

---

### W4 — React widget component

**Files:** `src/comments/waline/widget.tsx` (new), `src/parser/resolver.ts` (register `<WalineComments />` component), `src/renderers/html.ts` (render the widget slot), `templates/default-blog-post.mdx` (add the widget slot — per P1-7 writable templates).

**What it does:** Provides an MDX component `<WalineComments />` that renders the official Waline React wrapper, mounted client-side only.

**Component:**

```tsx
// src/comments/waline/widget.tsx
'use client';
import dynamic from 'next/dynamic';
import type { WalineOptions } from '@waline/client';

const Waline = dynamic(() => import('./waline-client'), { ssr: false });

export interface WalineCommentsProps {
  path: string;        // the post's canonical URL path, e.g. /blog/my-article
  lang?: string;       // ISO 639-1, default from config.site.lang
  reaction?: boolean;  // article reactions
}

export function WalineComments(props: WalineCommentsProps) {
  if (!props.path) {
    return <p className="waline-error">WalineComments requires a path prop.</p>;
  }
  return <Waline {...props} serverURL="/comments-api" />;
}
```

```tsx
// src/comments/waline/waline-client.tsx
'use client';
import { useEffect, useRef } from 'react';
import { init, type WalineInstance } from '@waline/client';
import '@waline/client/style';

export default function Waline(props: { serverURL: string; path: string; lang?: string; reaction?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<WalineInstance | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    instanceRef.current = init({ ...props, el: ref.current });
    return () => instanceRef.current?.destroy();
  }, []);
  useEffect(() => {
    instanceRef.current?.update(props);
  }, [props.path, props.lang, props.reaction]);
  return <div ref={ref} className="waline-container" />;
}
```

**Per-post opt-in:** the `<WalineComments />` component is **only rendered** if the post's frontmatter has `waline: true`. The blog post template checks this:

```mdx
# {title}

{body}

{frontmatter.waline && <WalineComments path={`/blog/${slug}`} />}
```

**Per-collection default:** like Nostr, a collection can specify `walineDefault: true` to enable comments on all posts in that collection unless explicitly disabled with `waline: false`.

**`path` keying:** the `path` prop is always `/blog/<slug>` (per D16), never `window.location.pathname`. This ensures comments survive trailing-slash normalization, query-string parameters, and protocol changes.

**Interaction with native `Comments` component:** hypernext already has a native `<Comments />` component (per the existing `src/parser/resolver.ts` and **P1-2** POSSE reply aggregation). The two can coexist:

- `Comments` renders native + POSSE-aggregated replies (Mastodon, Bluesky, ActivityPub).
- `WalineComments` renders Waline comments.

A post can have either, both, or neither. Default templates render `Comments` if `frontmatter.comments !== false` and `WalineComments` if `frontmatter.waline === true`. Users can override this in their writable template copy (per P1-7).

**Fix:**

1. Implement `widget.tsx` and `waline-client.tsx`.
2. Register `<WalineComments />` in the parser resolver.
3. Add a render case in `html.ts` that emits the widget's mounting div.
4. Update `templates/default-blog-post.mdx` (the writable default per P1-7) to conditionally render `<WalineComments />`.

**Verification:**

- E2E test: post with `waline: true` → rendered HTML contains the Waline container div + the dynamic-import script tag.
- E2E test: post with `waline: false` (or absent) → rendered HTML does not contain the Waline container.
- E2E test: browser-side render — load a post with `waline: true`, submit a comment via the widget, assert the comment appears in `GET /comments-api/comment?path=/blog/<slug>`.
- E2E test: `path` keying — visit `/blog/foo`, `/blog/foo/`, `/blog/foo?utm_source=x` — all three should display the same comment thread (assert by checking the `GET /comments-api/comment?path=/blog/foo` call is identical across the three).

---

### W5 — Admin setup flow and auth integration

**Files:** `src/cli/setup/waline.ts` (new), `src/comments/waline/admin.ts` (new).

**What it does:** Implements the Waline-specific steps of the `hypernext setup` wizard (per **P2-28**). Handles admin account creation and OAuth gateway setup.

**Wizard steps:**

1. **"Set up Waline comments?"** (y/N). If yes:
   - Set `comments.waline.enabled: true`, `mode: 'embedded'`, `storage.type: 'sqlite'`, `storage.path: 'db/waline.db'`.
   - Write to config.
2. **"Allow anonymous commenting?"** (Y/n). Sets `auth.anonymous`.
3. **"Comment moderation policy?"** → choices: `[open] comments appear immediately`, `[moderated] admin approves every comment`, `[closed] comments disabled`. Sets `auth.login` and `antiSpam.audit`.
4. **"Create admin account?"** (Y/n). If yes:
   - Start the Waline child process with `LOGIN=force` temporarily.
   - Generate a random username + password, display them, instruct user to save.
   - Call `POST http://127.0.0.1:<port>/ui/register` with the credentials. The first registrant becomes admin.
   - Capture the JWT.
   - Encrypt the JWT with `jwtSecret` (same scheme as the nsec encryption in N2).
   - Store the encrypted JWT in config as `comments.waline.adminToken`.
   - Reconfigure Waline with the user's chosen `LOGIN` mode (from step 3).
   - Restart the child process.
5. **"Enable GitHub social login?"** (y/N). If yes:
   - Prompt for GitHub OAuth app client ID and secret.
   - Ask whether to use the public OAuth gateway (`https://oauth.lithub.cc`) or self-host.
   - If self-host: install the `@waline/oauth-gateway` package (or equivalent) and start it as a second child process.
   - Write to config.
6. **"Configure notifications?"** (y/N). If yes: prompt for each channel (email/Telegram/Discord/webhook) and write to config.
7. **"Run smoke test?"** (Y/n). If yes:
   - Verify the Waline child is running.
   - Submit a test comment via `POST /comments-api/comment`, verify it appears.
   - Delete the test comment via the admin API (using the encrypted JWT).
   - Print success.

**Admin token storage and use:**

- The encrypted JWT is stored in config at `comments.waline.adminToken`.
- It's decrypted only inside piscina workers (or in the main process when proxying admin routes — see W3) when calling Waline admin endpoints.
- The hypernext admin UI uses the **hypernext admin auth** (per P0-5), not the Waline JWT directly. When an admin user hits `/comments-admin/*` via hypernext, the proxy attaches the encrypted Waline JWT to the upstream request as a `Cookie` header. This means admins log in once (to hypernext) and can manage both hypernext content and Waline comments.

**Why not let users register Waline accounts directly:**

1. Waline's first-registrant-is-admin behavior is a footgun. We sidestep it by registering the admin during setup and then closing registration.
2. Per the maintainer's auth model (P0-5), all admin operations go through hypernext's auth. Adding a second login for Waline would violate the "one login" UX.
3. Anonymous commenting (the default) doesn't need an account at all.

**Fix:**

1. Implement `src/cli/setup/waline.ts` as a wizard step (also called from `hypernext setup` per P2-28).
2. Implement `src/comments/waline/admin.ts` with the register-test-comment-delete flow.
3. Wire the admin JWT proxy logic into `src/comments/waline/proxy.ts` (W3).

**Verification:**

- E2E test: run `hypernext setup` with Waline enabled, follow the wizard. Assert: admin account created, encrypted JWT in config, test comment submitted and deleted, Waline running.
- E2E test: with `auth.registration: 'closed'` post-setup, attempt to `POST /ui/register` directly to the Waline port → rejected (Waline's `LOGIN=force` blocks it).
- E2E test: admin user hits `/comments-admin/` via hypernext → Waline admin UI loads (JWT attached by proxy).

---

### W6 — Notification integration

**Files:** `src/comments/waline/notifications.ts` (new), `src/email/` (existing email subsystem — per P1-6 wiring fix).

**What it does:** Wires Waline's notification channels to hypernext config. Reuses hypernext's SMTP config (from `email.smtp`) if `comments.waline.notifications.email` is not explicitly set.

**Email:**

- If `comments.waline.notifications.email` is set: use its SMTP config.
- Else if `email.smtp` is set (hypernext's existing email subsystem): reuse it. Derive `SENDER_EMAIL` from `email.from`.
- Else: Waline email notifications are disabled.

**Why reuse hypernext's SMTP:** Waline's notification emails and hypernext's digest/notification emails (per **P1-6**) come from the same sender in the user's eyes. Routing them through one SMTP config avoids "why does my blog send email from two different addresses?" confusion.

**Webhook:**

- If `comments.waline.notifications.webhook` is set: Waline fires `WEBHOOK` on every new comment. hypernext could intercept this webhook (route it to `/api/v1/internal/waline-webhook`) to trigger additional actions — e.g. sending an ActivityPub `Create` for federated comment notifications, or invoking an AI moderation pass via piscina (`ai-moderation` processor per **P1-8**).

**Telegram/Discord:** passed through directly to Waline env vars. No hypernext-side integration.

**Fix:**

1. Implement `src/comments/waline/notifications.ts` to derive the email/webhook/TG/Discord env vars from config.
2. Optionally add a `/api/v1/internal/waline-webhook` route that triggers `ai-moderation` jobs (if `agent.enabled: true` per **P0-12**).

**Verification:**

- E2E test: `email.smtp` set, `comments.waline.notifications.email` not set → Waline child env has `SMTP_HOST` etc. derived from `email.smtp`.
- E2E test: submit a comment → email notification arrives at the post author's address (if configured).
- E2E test: webhook set to `/api/v1/internal/waline-webhook` + `agent.enabled: true` → comment submission triggers an `ai-moderation` job (verify by spying on `schedule()`).

---

### W7 — Anti-spam defaults and security review

**Files:** `src/comments/waline/security.ts` (new), `docs/security.md` (update).

**What it does:** Hardens Waline's default configuration to avoid common pitfalls. Documents the security model.

**Defaults:**

1. **`SECURE_DOMAINS`** is automatically populated with `[config.site.url]` (and the hypernext server's bound address). Users can add additional origins via `comments.waline.antiSpam.secureDomains`.
2. **`AKISMET_KEY`** uses Waline's bundled key by default (per Waline docs). Users can override with their own key or set `comments.waline.antiSpam.akismet: false` to disable.
3. **`IPQPS`** defaults to 60 (Waline's default). Configurable.
4. **`COMMENT_AUDIT`** defaults to `false` (open commenting). Users can set `comments.waline.antiSpam.audit: true` for moderation mode.
5. **`MARKDOWN_CONFIG`** is left at Waline's defaults (which include DOMPurify XSS sanitization — no `<iframe>`, `<script>`, `<form>`, `<input>`, `<style>` tags).
6. **Link hardening** (Waline adds `rel="noreferrer noopener" target="_blank"` to all links) is on by default and not configurable.

**Security review checklist** (added to `docs/security.md`):

- [x] Waline server not directly exposed (only via `/comments-api/*` and `/comments-admin/*` proxy).
- [x] Admin routes protected by hypernext auth (per P0-5).
- [x] Anonymous commenting is the default but can be disabled (`auth.anonymous: false`).
- [x] First-registrant-is-admin footgun mitigated by closed registration post-setup (W5).
- [x] XSS sanitization via DOMPurify (Waline built-in).
- [x] IP rate limiting via `IPQPS`.
- [x] Spam filtering via Akismet.
- [x] Optional CAPTCHA (reCAPTCHA v3 or Cloudflare Turnstile) — exposed as `comments.waline.antiSpam.recaptcha` / `turnstile` config slots.
- [x] Secure domains enforced (CORS-like origin check).
- [x] No mixed content (Waline served via hypernext's HTTPS).
- [x] No PII leakage in client widget (no email addresses displayed publicly; Waline shows nicknames only).

**Open security consideration — `OAUTH_URL`:** the default Waline OAuth gateway (`https://oauth.lithub.cc`) is a third-party service. If a user enables GitHub login without self-hosting the gateway, GitHub OAuth codes flow through `oauth.lithub.cc`. This is documented as a privacy consideration in `docs/security.md`, and the wizard (W5 step 5) warns the user and offers the self-host option.

**Fix:**

1. Implement `src/comments/waline/security.ts` to populate `SECURE_DOMAINS` from `config.site.url`.
2. Add the security checklist to `docs/security.md`.
3. Add optional CAPTCHA config slots (`recaptcha` / `turnstile`).

**Verification:**

- E2E test: `config.site.url: 'https://example.com'` → Waline child env has `SECURE_DOMAINS=example.com`.
- E2E test: submit a comment with `<script>alert(1)</script>` → script stripped by DOMPurify, comment stored without the script tag.
- E2E test: submit a comment with `<iframe src="evil.com"></iframe>` → iframe stripped.
- E2E test: 5 rapid-fire comments from the same IP within 60s → 4 rejected with rate limit.
- E2E test: CAPTCHA configured → comment POST without CAPTCHA token rejected.

---

### W8 — Pageview counter reuse

**Files:** `src/comments/waline/pageview.ts` (new), `src/renderers/html.ts` (modify pageview rendering).

**What it does:** Optionally uses Waline's pageview counter (the `<1 KB` `@waline/client/pageview` submodule) instead of hypernext's native `recordPageview` (per **P2-25**).

**Behavior:**

- If `comments.waline.pageview.enabled: true` and `comments.waline.pageview.replaceNative: true`:
  - Hypernext's native `recordPageview` is disabled (per-route hook removed).
  - The blog post template includes a `<WalinePageview />` component that calls `POST /comments-api/article` with `path=/blog/<slug>` on mount.
  - The pageview count is fetched from `GET /comments-api/article?path=/blog/<slug>` and rendered inline.
- If `comments.waline.pageview.enabled: true` and `comments.waline.pageview.replaceNative: false`:
  - Both counters run in parallel. Useful for migration (compare counts during a transition window).
- If `comments.waline.pageview.enabled: false` (default):
  - Hypernext's native counter is used. Waline's counter is not loaded.

**Why this matters:** Waline's pageview counter and hypernext's native counter would otherwise double-count every visit. The `replaceNative` flag gives users a clean migration path: enable Waline comments first (counts diverge), verify, then flip `replaceNative: true` to consolidate.

**Fix:**

1. Implement `src/comments/waline/pageview.ts` with the `<WalinePageview />` component.
2. Modify the `onResponse` pageview hook (per P2-25) to be conditional on `comments.waline.pageview.replaceNative`.
3. Update the blog post template to render `<WalinePageview />` if enabled.

**Verification:**

- E2E test: `pageview.enabled: true, replaceNative: true` → single visit increments Waline's counter by 1, hypernext's native counter is unchanged.
- E2E test: `pageview.enabled: true, replaceNative: false` → single visit increments both counters.
- E2E test: `pageview.enabled: false` → only native counter increments.

---

### W9 — MCP tool exposure

**Files:** `src/mcp/tools.ts` (extend), `src/comments/waline/mcp-tools.ts` (new).

**What it does:** Exposes three MCP tools for Waline comments. **Not gated by `agent.enabled`** (per D3 — comments are not an agent feature).

**Tools:**

| Tool name | Input | Output | Auth |
|---|---|---|---|
| `waline_list_comments` | `{ path: string, page?: number }` | `{ comments, totalCount }` | public (matches P0-5 read-default-public) |
| `waline_delete_comment` | `{ commentId: string }` | `{ ok }` | admin |
| `waline_inspect` | `{}` | `{ serverURL, mode, storage, authConfig, … }` | admin (config details are admin-only) |

**Why `waline_list_comments` is public:** the comments themselves are public (visible on the post page). Listing them via MCP doesn't leak anything not already visible. Useful for external agents that want to summarize comment threads.

**Why `waline_inspect` is admin:** it exposes storage config (DB credentials would be visible if not redacted), auth config, etc. Admin-only.

**Fix:**

1. Add the three tool definitions to `src/comments/waline/mcp-tools.ts`.
2. Register in `src/mcp/tools.ts` with the auth gating (note: these tools are **not** gated by `agent.enabled` — only by their own `comments.waline.enabled`).
3. `waline_inspect` must redact all secrets (SMTP passwords, OAuth secrets, DB passwords) before returning.

**Verification:**

- E2E test: `comments.waline.enabled: false` → tools not registered.
- E2E test: `comments.waline.enabled: true` → `waline_list_comments` callable without auth; `waline_delete_comment` and `waline_inspect` return 401 without auth, succeed with auth.
- E2E test: `waline_inspect` response does not contain any SMTP password / DB password string (grep assertion).

---

### W10 — CLI commands

**Files:** `src/cli/waline.ts` (new), `src/cli/index.ts` (register subcommands).

**Subcommands:**

| Command | Action |
|---|---|
| `hypernext waline setup` | Run the Waline-specific setup wizard (also part of `hypernext setup` per P2-28). |
| `hypernext waline status` | Print Waline child process status (running/stopped, port, health endpoint, uptime). |
| `hypernext waline start` | Manually start the Waline child process (if stopped). |
| `hypernext waline stop` | Manually stop the Waline child process. |
| `hypernext waline restart` | Restart the Waline child process (useful after config changes). |
| `hypernext waline admin` | Print the URL to the Waline admin UI (proxied through hypernext). |
| `hypernext waline export` | Export all comments as JSON (uses Waline admin API). |
| `hypernext waline import <file>` | Import comments from JSON (uses Waline admin API — useful for migration from another comment system). |

**Fix:** Implement the subcommands using oclif (per P1-10).

**Verification:**

- E2E test: each subcommand produces the expected output.
- E2E test: `waline export` then `waline import` round-trips comments to a fresh Waline instance.

---

## Cross-cutting work items

### X1 — License review for `@waline/client` and `@waline/vercel`

**Files:** `package.json` (block dependency until resolved), `docs/legal/waline-license-review.md` (new).

**What it does:** Resolves the GPL-2.0 vs MIT license discrepancy before either package is added to hypernext's runtime dependencies.

**The discrepancy:**

- The `walinejs/waline` repo `LICENSE` file says **GPL-2.0**.
- The `packages/server/package.json` (`@waline/vercel`) declares `"license": "MIT"`.
- The `@waline/client` package's `package.json` should be checked separately (not yet verified).

**Implications if GPL-2.0 is authoritative:**

- hypernext (currently MIT-licensed) **cannot bundle** `@waline/client` as a runtime dependency.
- The integration must be restructured:
  - **Option A:** Load `@waline/client` from a CDN at runtime (`<script src="https://unpkg.com/@waline/client@v3/dist/waline.js">`). This is the "separate and independent work" exception under GPL-2.0 section 2.
  - **Option B:** Run Waline as a fully separate process (the current W2 design already does this for the server). The client widget is loaded from the Waline server's own static assets, not bundled with hypernext.
  - **Option C:** Contact the Waline maintainer (lizheming) and request explicit MIT licensing for the client package.

**Implications if MIT is authoritative:**

- No bundling restriction. `@waline/client` can be a runtime dependency.

**Fix:**

1. File an issue upstream (`walinejs/waline`) asking for clarification.
2. Until resolved, use **Option B** (load client from the Waline server's own assets, not bundled). This is the safer default and aligns with the existing child-process architecture (W2) — the Waline server already serves the admin UI from its own static assets.
3. Document the decision in `docs/legal/waline-license-review.md`.

**Verification:**

- Grep assertion: `@waline/client` is not in hypernext's `package.json` `dependencies` (only in `devDependencies` for type definitions, or not at all if Option B is used).
- E2E test: the `<WalineComments />` widget loads `@waline/client` from the Waline server's served URL (`/comments-static/waline.js` proxied from the child process), not from hypernext's bundled assets.

---

### X2 — Documentation

**Files:** `docs/nostr-syndication.md` (new), `docs/waline-comments.md` (new), `docs/content-authoring.md` (extend with frontmatter docs), `README.md` (extend feature list).

**Content:**

- `docs/nostr-syndication.md`: explains what Nostr is (one paragraph), how to enable syndication (config + setup wizard), the frontmatter contract, how to edit/delete syndicated posts, how to view the naddr permalink, troubleshooting (relay errors, nsec recovery).
- `docs/waline-comments.md`: explains what Waline is, how to enable comments (config + setup wizard), the admin UI, moderation, notifications, anti-spam, migration from another comment system.
- `docs/content-authoring.md`: extend with the new `nostr:`, `nostrHashtags:`, `nostrAnnounce:`, `waline:` frontmatter fields and examples.

**Fix:** Write the three docs. Add a "Nostr syndication" and "Waline comments" entry to `README.md`'s feature list with "user-optional, off by default" labels.

**Verification:**

- Doc review: a new user can follow `docs/nostr-syndication.md` end-to-end and successfully syndicate a post.
- Doc review: a new user can follow `docs/waline-comments.md` end-to-end and successfully enable comments on a post.

---

### X3 — Test fixtures and CI

**Files:** `tests/fixtures/nostr-mock-relay.ts` (new), `tests/fixtures/waline-mock-server.ts` (new), `tests/e2e/nostr-syndication.test.ts` (new), `tests/e2e/waline-comments.test.ts` (new), `.github/workflows/ci.yml` (extend).

**What it does:** Adds the test infrastructure needed to exercise both subsystems in CI without depending on external Nostr relays or external Waline deployments.

**Mock Nostr relay:**

- A small WebSocket server that implements the minimum NIP-01 protocol: accepts `EVENT` messages, replies `["OK", eventId, true, ""]` (or `false` with a configurable reason), accepts `REQ` subscriptions and streams stored events.
- Configurable per-test: "accept all", "reject all", "reject first N then accept", "timeout".
- Used by all Nostr E2E tests.

**Mock Waline server:**

- A small Fastify server that implements the four documented REST endpoints (`GET/POST /api/comment`, `GET/POST /api/article`).
- In-memory storage, reset between tests.
- Used by E2E tests that exercise the proxy (W3) and widget (W4) without spawning the real Waline child process (which is slow — ~3s startup).

**CI:**

- Run the Nostr E2E tests against the mock relay.
- Run the Waline E2E tests against both the mock server (fast) and the real Waline child process (slow, gated behind a `--full` flag).
- Run `tsc --noEmit` including the new test files (per **P3-5**).
- Run `biome check` on the new files.

**Fix:**

1. Implement the two mock fixtures.
2. Write E2E tests for the workflows listed under N1-N8 and W1-W10.
3. Extend CI to run the new tests.

**Verification:**

- CI green on a PR that touches only Nostr/Waline code.
- Coverage: every work item's "Verification" section maps to at least one test in the E2E files.

---

## Phasing

Estimated total effort: **8–10 days** for a single developer working sequentially, assuming the main remediation plan's Phase 1 (P0 fixes) and P1-1 (piscina job pool) have already landed.

### Phase A — Nostr syndication (4–5 days)

1. **N1** config schema and validation (0.5d).
2. **N2** signer abstraction and key management (1d).
3. **N4** event builders (0.5d).
4. **N3** relay client (0.5d).
5. **N5** publish flow and piscina processor (1d).
6. **N6** frontmatter contract (0.5d).
7. **N7** MCP tools (0.25d).
8. **N8** CLI commands (0.25d).
9. **X3** mock relay + Nostr E2E tests (0.5d, parallelizable with N3-N5).

### Phase B — Waline comments (4–5 days)

1. **X1** license review (0.5d, blocking — must resolve before any Waline code lands).
2. **W1** config schema and validation (0.5d).
3. **W2** child process manager (1d).
4. **W3** HTTP proxy routes (0.5d).
5. **W4** React widget component (0.5d).
6. **W5** admin setup flow (1d).
7. **W6** notification integration (0.25d).
8. **W7** anti-spam defaults (0.25d).
9. **W8** pageview counter reuse (0.25d).
10. **W9** MCP tools (0.25d).
11. **W10** CLI commands (0.25d).
12. **X3** mock Waline + E2E tests (0.5d, parallelizable with W2-W5).

### Phase C — Documentation and polish (0.5–1d)

1. **X2** documentation.
2. Final integration test: full `hypernext setup` with both Nostr and Waline enabled, end-to-end.

Phases A and B can be parallelized across two developers (the two subsystems share no code paths). Phase C is sequential after both A and B land.

---

## Test strategy

For each work item, an **E2E test that boots a real hypernext server against a real temp project directory** and asserts the actual end-to-end behavior (not a mock). This matches the test strategy of the main remediation plan.

**Specifically:**

1. **Boot-smoke tests.** Boot hypernext with each of these configs and assert the server stays up:
   - `syndication.nostr.enabled: true` (with valid nsec + relays).
   - `syndication.nostr.enabled: true` with `signer.type: 'nip46'`.
   - `comments.waline.enabled: true, mode: 'embedded'`.
   - `comments.waline.enabled: true, mode: 'external'`.
   - Both enabled simultaneously.

2. **Syndication round-trip test.** Create a post with `nostr: true`. Assert:
   - `nostr-publish` job runs.
   - Mock relay receives a kind 30023 event with correct tags.
   - `nostrNaddr` appears in frontmatter.
   - Edit the post → mock relay receives a new 30023 with same `d` tag.
   - Delete the post → mock relay receives a kind 5 event.
   - `nostrNaddr` is cleared from frontmatter.

3. **Comment round-trip test.** Enable Waline on a post. Assert:
   - Widget loads in browser.
   - Anonymous comment submission succeeds.
   - Comment appears in list.
   - Admin can delete the comment.
   - Anti-spam: XSS-stripped, rate-limited.

4. **Per-post opt-in test.** With `syndication.nostr.enabled: true` globally:
   - Post A has `nostr: true` → syndicated.
   - Post B has `nostr: false` → not syndicated.
   - Post C has no `nostr` field → not syndicated.
   - Collection with `nostrDefault: true` and Post D has no `nostr` field → syndicated.

5. **Key management test.** Decrypt the encrypted nsec with the wrong `jwtSecret` → throws. Decrypt with the right `jwtSecret` → produces the original key. Assert the main process heap does not contain the nsec bytes after a publish job completes.

6. **License-compliance test.** Grep `package.json`: `@waline/client` is not in `dependencies`. Grep the built bundle: no Waline client code is bundled into hypernext's server-side assets.

7. **Auth-gating tests.** For each MCP tool, assert the tool is not registered when its parent feature is disabled, and assert the auth-required tools return 401 without credentials.

8. **Per-post URL keying test.** Visit `/blog/foo`, `/blog/foo/`, `/blog/foo?utm_source=x` — assert the same Waline comment thread loads on all three (the `path` prop is `/blog/foo` in all cases).

---

## Security considerations

### Nostr

1. **nsec is a Lightning wallet key.** If the user reuses an existing nsec that controls a Lightning wallet (e.g. an Alby key) for hypernext syndication, compromise of the encrypted nsec + `jwtSecret` compromises the wallet. The setup wizard MUST warn: "Generate a new nsec dedicated to this hypernext instance. Do not reuse a Lightning-wallet key."

2. **NIP-46 bunker dependency.** In bunker mode, if the bunker (Alby/nsec.app) is unreachable, syndication fails. The job marks as failed with a clear error. The user can switch back to nsec mode by re-running `hypernext nostr setup`.

3. **Relay trust model.** Anything published to a relay is public and permanent (relays may keep events indefinitely; deletion events are advisory). The setup wizard warns: "Syndicating to Nostr is irreversible. Even if you publish a deletion event, relays may retain the original."

4. **No PII in events.** The 30023 event content is the post body (which is already public on hypernext). The `pubkey` is the author's Nostr identity. No email, IP, or hypernext-internal metadata is included. The `published_at` tag is the post's `publishedAt` (already public).

5. **No `agent.enabled` gating (per D2).** Nostr syndication is **not** gated by `agent.enabled` — it is a publishing feature, not an AI feature. The "no surprise syndication" guarantee is provided by the combination of: `syndication.nostr.enabled: true` (explicit global opt-in), `nostr: true` frontmatter (per-post opt-in), and admin-auth on the mutating MCP tools (N7). A user who has explicitly disabled AI features can still syndicate blog posts to Nostr.

### Waline

1. **Commenter PII.** Anonymous commenters provide nick/email/link. Email is hashed for Gravatar and not displayed. Waline stores emails in the DB (for reply notifications). The `docs/security.md` document discloses this.

2. **First-registrant-is-admin footgun.** Mitigated by W5: admin is created during setup, registration is closed post-setup.

3. **XSS.** Waline sanitizes all comments with DOMPurify server-side. No `<script>`, `<iframe>`, `<form>`, `<input>`, `<style>` tags survive. Verified by W7 E2E tests.

4. **Rate limiting.** `IPQPS` per-IP limit on comment submission. Reuse hypernext's rate-limiter (per P2-16) on the proxy route for defense in depth.

5. **CORS / secure domains.** `SECURE_DOMAINS` is auto-populated with `config.site.url`. Direct access to the Waline port (`127.0.0.1:8360`) from external networks is blocked by binding to localhost only (W2 child process spawns with `HOST=127.0.0.1`).

6. **OAuth gateway privacy.** If GitHub login is enabled without self-hosting the gateway, OAuth codes flow through `oauth.lithub.cc`. Documented as a privacy consideration. Self-host option offered in the wizard.

7. **Admin JWT storage.** Encrypted at rest with the same AES-GCM scheme as the nsec (N2). Decrypted only when proxying admin routes. Never sent to the browser.

8. **License compliance.** See X1. Until the GPL-2.0 vs MIT discrepancy is resolved, the Waline client is loaded from the Waline server's own static assets, not bundled with hypernext.

---

## Open questions

These are items the maintainer should resolve before implementation begins. None are blocking for the design — they're clarifications that affect details.

**Q1 (blocking): License review for `@waline/client` and `@waline/vercel`.**
The repo `LICENSE` says GPL-2.0; the server sub-package manifest says MIT. Which is authoritative? If GPL-2.0, hypernext (MIT) cannot bundle the client — we default to loading it from the Waline server's own assets (X1 Option B). The maintainer should either (a) confirm Option B is acceptable, or (b) pursue upstream clarification / explicit MIT permission.

**Q2: Should Nostr syndication be available for non-blog collections (e.g. docs)?**
NIP-23 is designed for long-form articles. Docs are also long-form but typically not "published" in the same sense. Default: blog only. The maintainer can confirm or expand.

**Q3: Should Nostr syndication publish a kind 1 announcement note by default?**
Currently defaulted off (`syndication.nostr.announceOnFirstPublish: false`) with a per-post `nostrAnnounce: true` opt-in. Some users may want every post to auto-announce. The maintainer can confirm the default.

**Q4: NIP-46 bunker auto-reconnect behavior.**
If the bunker goes offline mid-publish, should the job retry, fail, or queue for later? Currently: fail with a clear error, user re-runs `hypernext nostr publish <slug>`. The maintainer can confirm or request automatic retry with exponential backoff.

**Q5: Waline pageview counter migration tool.**
If a user has been running hypernext's native pageview counter and switches to Waline's, should we migrate the existing counts? Currently: no — counts start fresh. The maintainer can confirm or request a one-time migration script.

**Q6: Nostr reply ingestion.**
Currently defaulted off (`syndication.nostr.subscribeReplies: false`). If enabled, Nostr replies appear in the admin UI as native comments (not POSSE). Should they also appear on the public post page alongside the existing `<Comments />` component? Currently: no — they're admin-only. The maintainer can confirm or request public rendering.

---

## Dependencies added

| Package | Version | Purpose | License | Bundled? |
|---|---|---|---|---|
| `nostr-tools` | `^2.x` (latest stable) | Nostr event signing, relay client, NIP-19 | MIT | yes |
| `ws` | (transitive — already a dep) | WebSocket transport for Nostr relays | MIT | n/a |
| `@waline/vercel` | `^1.41.3` | Waline server (child process) | MIT (per manifest) / GPL-2.0 (per repo LICENSE) — see X1 | no (spawned as child process) |
| `@waline/client` | `^3.15.2` | Waline widget (browser-only) | see X1 | **no** — loaded from Waline server's own assets until license clarified |
| `@waline/admin` | (served by Waline server) | Waline admin UI | see X1 | no (served by child process) |
| `@noble/curves` | (transitive via `nostr-tools`) | secp256k1 Schnorr | MIT | yes (transitive) |
| `@noble/hashes` | (transitive via `nostr-tools`) | SHA-256, HKDF | MIT | yes (transitive) |

No new transitive dependencies that would conflict with the existing stack. `nostr-tools` is pure JS/TS with no native modules — safe for the $5-VPS target.

---

## Summary

This supplemental plan adds two user-optional, per-post features to hypernext:

1. **Nostr syndication** — opt-in publishing of blog posts as `kind 30023` long-form articles (NIP-23) to user-configured relays, with encrypted-nsec or NIP-46-bunker signing, edits as NIP-33 replaceable republishes, deletions as NIP-09 events, and stable `naddr1…` permalinks. **Not gated by `agent.enabled`** (it's a syndication feature, not an AI feature — see D2); gated only by `syndication.nostr.enabled` + per-post frontmatter. Jobs run in the piscina pool (per P1-1). ~4–5 days.

2. **Waline comments** — opt-in self-hosted comment threads on individual blog posts, with hypernext-managed child process, HTTP proxy for single-port deployment, SQLite storage default, anonymous-by-default commenting, admin created during setup, anti-spam defaults hardened. Not gated by `agent.enabled` (it's a reader feature, not an agent feature). ~4–5 days, blocked by license review (X1).

Both features are off by default, per-post opt-in via frontmatter, integrated with the existing `hypernext setup` wizard (P2-28), exposed via MCP tools with the P0-5 auth model, and covered by E2E tests against mock infrastructure.

The three highest-leverage decisions in this plan are:

- **D8 (`nostr-tools` over `nostr-core`/`nostr-ts`)** — the Nostr library choice is decisive for a key-handling subsystem; `nostr-core` has attractive features but 7★ and no published releases, `nostr-ts` is a self-described learning project without NIP-46. `nostr-tools` is the de-facto standard with audited crypto.
- **D9 (Waline as child process, not in-process)** — preserves single-binary deployability, clean upgrade path, and process isolation at the cost of a ~3s startup and an internal port. The alternative (in-process ThinkJS) would require deep rewriting of Waline's server and brittle coupling to ThinkJS upgrades.
- **D2 (No `agent.enabled` gating for Nostr)** — Nostr is a publishing/syndication feature, conceptually closer to RSS than to AI. Tying it to `agent.enabled` would force users who want Nostr syndication but not AI to flip the AI master toggle, contradicting P0-12's "AI off by default" posture. Nostr and Waline are now treated consistently: both are reader/publishing features, both gated only by their own flags plus per-post frontmatter opt-in.

Implementation can begin immediately after the main remediation plan's Phase 1 (P0 fixes) and P1-1 (piscina pool) land. The two subsystems are independent and can be developed in parallel.
