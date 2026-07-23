const MARKDOWN_INTERNAL_LINK_RE = /\[([^\]]+)\]\(\/([^)]+)\)/g;
const TRAILING_SLASH_RE = /\/+$/;

/**
 * Rewrite internal hypernext links (`[foo](/blog/bar)`) to absolute
 * URLs using the site's canonical base.
 */
export function rewriteInternalLinks(
  markdown: string,
  siteUrl: string
): string {
  const base = siteUrl.replace(TRAILING_SLASH_RE, "");
  return markdown.replace(
    MARKDOWN_INTERNAL_LINK_RE,
    (_match, text, path) => `[${text}](${base}/${path})`
  );
}

/**
 * Build a kind 30023 long-form article event (NIP-23).
 *
 * - `d` tag is the slug (NIP-33 parameterized-replaceable identifier)
 * - `published_at` is the FIRST publication timestamp (constant across edits)
 * - `created_at` is the last-update timestamp (defaults to now)
 * - `t` tags from hashtags + config defaults
 * - `image` tag from optional cover image
 */
export function buildLongFormArticleEvent(opts: {
  slug: string;
  title: string;
  summary?: string;
  contentMarkdown: string;
  imageUrl?: string;
  hashtags: string[];
  publishedAt: number;
  createdAt?: number;
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["d", opts.slug],
    ["title", opts.title],
    ["published_at", String(opts.publishedAt)],
  ];

  if (opts.summary) {
    tags.push(["summary", opts.summary]);
  }

  if (opts.imageUrl) {
    tags.push(["image", opts.imageUrl]);
  }

  // Deduplicate hashtags (case-insensitive)
  const seen = new Set<string>();
  for (const tag of opts.hashtags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      tags.push(["t", tag]);
    }
  }

  return {
    kind: 30_023,
    content: opts.contentMarkdown,
    created_at: opts.createdAt ?? now,
    tags,
  };
}

/**
 * Build a kind 0 profile metadata event.
 */
export function buildProfileMetadataEvent(opts: {
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
}): Record<string, unknown> {
  const content: Record<string, string> = {};
  if (opts.name) {
    content.name = opts.name;
  }
  if (opts.about) {
    content.about = opts.about;
  }
  if (opts.picture) {
    content.picture = opts.picture;
  }
  if (opts.nip05) {
    content.nip05 = opts.nip05;
  }

  return {
    kind: 0,
    content: JSON.stringify(content),
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
  };
}

/**
 * Build a kind 5 deletion event (NIP-09) referencing a specific event.
 */
export function buildDeletionEvent(opts: {
  targetEventId: string;
  reason?: string;
}): Record<string, unknown> {
  const tags: string[][] = [["e", opts.targetEventId]];

  if (opts.reason) {
    tags[0]?.push(opts.reason);
  }

  return {
    kind: 5,
    content: opts.reason ?? "",
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
}

/**
 * Build a kind 10002 relay list event (NIP-65 outbox model).
 */
export function buildRelayListEvent(opts: {
  relays: Array<{ url: string; read: boolean; write: boolean }>;
}): Record<string, unknown> {
  const tags: string[][] = opts.relays.map((r) => {
    const tag = ["r", r.url];
    if (r.read && !r.write) {
      tag.push("read");
    } else if (!r.read && r.write) {
      tag.push("write");
    }
    return tag;
  });

  return {
    kind: 10_002,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
}
