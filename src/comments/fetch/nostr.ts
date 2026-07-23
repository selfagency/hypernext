/**
 * Nostr comment fetcher using NIP-22 (kind:1111 comments).
 * Subscribes to relays to find comments on articles.
 */

import { SimplePool } from "nostr-tools";

const NADDR_REGEX = /^naddr1([a-zA-Z0-9]+):([a-zA-Z0-9]{60,70}):(.+)$/;

export interface NostrComment {
  authorNip05?: string;
  // Parsed metadata
  authorNpub?: string;
  content: string;
  createdAt: number;
  id: string;
  kind: number;
  parentA?: string;
  parentE?: string;
  parentI?: string;
  parentK?: number;
  pubkey: string;
  // NIP-22 specific
  rootA?: string; // Addressable root (kind:pubkey:d)
  rootE?: string; // Event ID root
  rootI?: string; // External identifier root (URL)
  rootK?: number; // Root kind
  tags: string[][];
}

/**
 * Fetch comments for a Nostr article (naddr).
 * @param naddr - The article's naddr1... identifier
 * @param relays - List of relays to query
 * @param timeoutMs - Timeout in milliseconds
 */
export async function fetchNostrComments(
  naddr: string,
  relays: string[],
  timeoutMs = 5000
): Promise<NostrComment[]> {
  // Decode naddr to get the article's kind, pubkey, and d tag
  const decoded = decodeNaddr(naddr);
  if (!decoded) {
    throw new Error("Invalid naddr format");
  }

  const pool = new SimplePool();

  try {
    // Subscribe to comments matching the article
    const comments = await new Promise<NostrComment[]>((resolve) => {
      const results: NostrComment[] = [];
      let done = false;

      const cleanup = () => {
        if (done) {
          return;
        }
        done = true;
        setTimeout(() => {
          sub.close();
          pool.close(relays);
          resolve(results);
        }, timeoutMs);
      };

      // Set up timeout
      setTimeout(cleanup, timeoutMs);

      // Subscribe to kind:1111 events that reference this article
      // Using typed interface for nostr-tools SimplePool
      interface NostrPool {
        close(relays: string[]): void;
        sub(
          relays: string[],
          filters: object[]
        ): {
          close(): void;
          off(event: string, cb: (ev: unknown) => void): void;
          on(event: string, cb: (ev: unknown) => void): void;
        };
      }
      const sub = (pool as unknown as NostrPool).sub(relays, [
        {
          kinds: [1111],
          "#a": [naddr], // Addressable event reference
        },
        {
          kinds: [1111],
          "#a": [`${decoded.kind}:${decoded.pubkey}:${decoded.d}`],
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sub.on("event", (event) => {
        const typedEvent = event as unknown as {
          tags: string[][];
          content: string;
          created_at: number;
          pubkey: string;
          id: string;
          kind: number;
        };
        const comment = parseNostrComment(typedEvent);
        if (comment) {
          results.push(comment);
        }
      });

      sub.on("eose", () => {
        // Got all historical events, wait a bit for new ones then finish
        setTimeout(cleanup, 1000);
      });
    });

    // Sort by creation time (oldest first)
    comments.sort((a, b) => a.createdAt - b.createdAt);

    return comments;
  } finally {
    pool.close(relays);
  }
}

/**
 * Parse a Nostr event into a NostrComment.
 */
function parseNostrComment(event: {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  kind: number;
  tags: string[][];
}): NostrComment | null {
  const comment: NostrComment = {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    kind: event.kind,
    tags: event.tags,
  };

  // Extract NIP-22 tags
  for (const tag of event.tags) {
    if (tag.length < 2) {
      continue;
    }

    switch (tag[0]) {
      case "A":
        comment.rootA = tag[1];
        break;
      case "a":
        comment.parentA = tag[1];
        break;
      case "E":
        comment.rootE = tag[1];
        break;
      case "e":
        comment.parentE = tag[1];
        break;
      case "I":
        comment.rootI = tag[1];
        break;
      case "i":
        comment.parentI = tag[1];
        break;
      case "K":
        comment.rootK = tag[1] ? Number.parseInt(tag[1], 10) : undefined;
        break;
      case "k":
        comment.parentK = tag[1] ? Number.parseInt(tag[1], 10) : undefined;
        break;
      case "p":
        // Author pubkey (we already have event.pubkey)
        break;
      case "nip05":
        comment.authorNip05 = tag[1];
        break;
      default:
        // Ignore unknown tags
        break;
    }
  }

  // Encode pubkey as npub (synchronous using require)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nip19 } = require("nostr-tools");
    comment.authorNpub = nip19.npubEncode(event.pubkey);
  } catch {
    // nostr-tools not available, skip npub encoding
  }

  return comment;
}

/**
 * Decode an naddr1... identifier.
 */
function decodeNaddr(
  naddr: string
): { kind: number; pubkey: string; d: string } | null {
  try {
    const { nip19 } = require("nostr-tools");
    const decoded = nip19.naddrDecode(naddr);
    return decoded as { kind: number; pubkey: string; d: string };
  } catch {
    // Fallback: try to parse manually
    // Format: naddr1[kind]:[pubkey]:[d]
    const match = naddr.match(NADDR_REGEX);
    if (match) {
      // This is a simplified decode - in reality should use nostr-tools
      // For now, return null and let caller handle
      return null;
    }
    return null;
  }
}

/**
 * Check if a string is a valid naddr.
 */
export function isNaddr(str: string): boolean {
  return str.startsWith("naddr1");
}

/**
 * Convert URL to NIP-22 I-tag format.
 * For web URLs, comments are anchored to the URL via I tag.
 */
export function urlToITag(url: string): string {
  return url;
}
