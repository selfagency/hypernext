/**
 * Unified federated comments aggregation.
 * Fetches comments from all syndicated platforms and normalizes them.
 */

import { getDocBySlug, getSyndicationForDoc } from "../../database/index.js";
import { extractFrontmatter } from "../../parser/frontmatter.js";
import { fetchBlueskyComments } from "./bluesky.js";
import { fetchMastodonComments } from "./mastodon.js";

/** Normalized comment format across all platforms */
export interface FederatedComment {
  author: {
    name: string;
    handle: string;
    url?: string;
    avatar?: string;
  };
  content: string;
  createdAt: string;
  id: string;
  isRootPost?: boolean;
  metadata?: {
    likeCount?: number;
    replyCount?: number;
  };
  parentId?: string;
  platform: "bluesky" | "nostr" | "mastodon";
  rootId?: string;
  url: string;
}

/** Options for fetching comments */
export interface FetchCommentsOptions {
  /** Maximum comment depth for threading */
  depth?: number;
  /** Include comments from these platforms (default: all) */
  platforms?: Array<"bluesky" | "nostr" | "mastodon">;
  /** Maximum time to wait for each platform (ms) */
  timeoutMs?: number;
}

/**
 * Get federated comments for a document.
 * Queries the Syndication table to find platform URLs,
 * then fetches comments from each platform.
 */
export async function getFederatedComments(
  slug: string,
  options: FetchCommentsOptions = {}
): Promise<FederatedComment[]> {
  const { timeoutMs: _timeoutMs = 5000, platforms, depth = 3 } = options;

  // Get doc ID from slug
  const doc = await getDocBySlug(slug);
  if (!doc) {
    return [];
  }

  // Get syndication URLs for this document
  const docId = (doc as { id: number }).id;
  const syndications = await getSyndicationForDoc(docId);

  if (syndications.length === 0) {
    // Fallback: check frontmatter for Nostr naddr
    const rawMdx = doc.rawMdx as string | undefined;
    const frontmatterNostr = rawMdx ? extractFrontmatter(rawMdx) : null;
    const nostrNaddr = frontmatterNostr?.attributes?.nostrNaddr as
      | string
      | undefined;

    if (nostrNaddr) {
      // Fetch Nostr comments using naddr from frontmatter
      // Note: This requires the syndication.nostr.relays config to be set
      // For now, return empty - the main path uses Syndication table
      return [];
    }

    return [];
  }

  // Build list of fetch promises
  const fetchPromises: Promise<FederatedComment[]>[] = [];

  for (const synd of syndications) {
    const platform = synd.platform as string;
    const url = synd.url as string;

    // Skip if platform not requested
    type Platform = "bluesky" | "nostr" | "mastodon";
    if (platforms && !platforms.includes(platform as Platform)) {
      continue;
    }

    // Create fetch promise based on platform
    if (platform === "bluesky" && url) {
      fetchPromises.push(
        fetchBlueskyComments(url, depth)
          .then((comments) => normalizeBlueskyComments(comments, url))
          .catch((err) => {
            console.error("Bluesky comments fetch error:", err);
            return [];
          })
      );
    } else if (platform === "nostr" && url) {
      // Nostr comments require relays config - skip for now
      // TODO: wire up config access properly
    } else if (platform === "mastodon" && url) {
      fetchPromises.push(
        fetchMastodonComments(url)
          .then((comments) => normalizeMastodonComments(comments))
          .catch((err) => {
            console.error("Mastodon comments fetch error:", err);
            return [];
          })
      );
    }
  }

  // Fetch from all platforms in parallel
  const results = await Promise.all(fetchPromises);

  // Flatten and sort by date
  const allComments = results.flat();

  // Sort by createdAt (oldest first for chronological)
  allComments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return allComments;
}

/**
 * Check if a document has any federated comments enabled.
 */
export async function hasFederatedComments(slug: string): Promise<boolean> {
  const doc = await getDocBySlug(slug);
  if (!doc) {
    return false;
  }

  const docIdNum = (doc as { id: number }).id;
  const syndications = await getSyndicationForDoc(docIdNum);
  return syndications.length > 0;
}

// ─── Normalizers ───

function normalizeBlueskyComments(
  comments: import("./bluesky.js").BlueskyComment[],
  rootUri: string
): FederatedComment[] {
  return comments.map((comment) => ({
    id: comment.uri,
    platform: "bluesky" as const,
    author: {
      name: comment.author.displayName ?? comment.author.handle,
      handle: comment.author.handle,
      url: `https://bsky.app/profile/${comment.author.handle}`,
      avatar: comment.author.avatar,
    },
    content: comment.content,
    createdAt: comment.createdAt,
    url: comment.uri,
    parentId: comment.parentUri,
    rootId: comment.rootUri ?? rootUri,
    metadata: {
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
    },
  }));
}

function _normalizeNostrComments(
  comments: import("./nostr.js").NostrComment[]
): FederatedComment[] {
  return comments.map((comment) => ({
    id: comment.id,
    platform: "nostr" as const,
    author: {
      name: comment.authorNpub?.slice(0, 20) ?? comment.pubkey.slice(0, 16),
      handle: comment.authorNpub ?? comment.pubkey.slice(0, 16),
      url: comment.authorNip05
        ? `https://njump.me/${comment.authorNpub}`
        : undefined,
    },
    content: comment.content,
    createdAt: new Date(comment.createdAt * 1000).toISOString(),
    url: `https://njump.me/${comment.id}`,
    parentId: comment.parentE ?? comment.parentA ?? undefined,
    rootId: comment.rootE ?? comment.rootA ?? undefined,
  }));
}

function normalizeMastodonComments(
  comments: import("./mastodon.js").MastodonComment[]
): FederatedComment[] {
  return comments.map((comment) => ({
    id: comment.id,
    platform: "mastodon" as const,
    author: {
      name: comment.account.displayName ?? comment.account.username,
      handle: comment.account.acct,
      url: comment.account.url,
      avatar: comment.account.avatar,
    },
    content: stripHtml(comment.content),
    createdAt: comment.createdAt,
    url: comment.url,
    parentId: comment.inReplyToId,
  }));
}

/**
 * Strip HTML tags from content.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
