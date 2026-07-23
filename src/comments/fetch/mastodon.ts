/**
 * Mastodon comment fetcher using the Mastodon API.
 * Fetches replies (descendants) for a status.
 */

const NUMBER_REGEX = /\d+$/;

export interface MastodonComment {
  account: {
    id: string;
    username: string;
    acct: string;
    displayName?: string;
    avatar?: string;
    url?: string;
  };
  content: string;
  createdAt: string;
  id: string;
  inReplyToAccountId?: string;
  inReplyToId?: string;
  mediaAttachments?: Array<{
    type: string;
    url: string;
    previewUrl?: string;
  }>;
  reblog?: MastodonComment;
  sensitive?: boolean;
  spoilerText?: string;
  url: string;
}

/**
 * Fetch comments (replies) for a Mastodon status.
 * @param statusUrl - Full URL to the status, e.g. https://mastodon.social/@user/12345678
 * @param instance - Mastodon instance to use for API (auto-extracted from URL if not provided)
 */
export async function fetchMastodonComments(
  statusUrl: string,
  instance?: string
): Promise<MastodonComment[]> {
  // Extract instance and status ID from URL
  const parsed = parseMastodonUrl(statusUrl, instance);
  if (!parsed) {
    throw new Error("Invalid Mastodon status URL");
  }

  const { instance: inst, statusId } = parsed;

  // Use the context endpoint to get all descendants
  const url = new URL(`https://${inst}/api/v1/statuses/${statusId}/context`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Mastodon API error: ${response.status}`);
  }

  const data = (await response.json()) as { descendants?: MastodonComment[] };

  // The 'descendants' array contains all replies to the thread
  const descendants = data.descendants;

  if (!(descendants && Array.isArray(descendants))) {
    return [];
  }

  // Filter to only direct replies (not boosts/reblogs)
  const comments = descendants
    .filter((comment) => !comment.reblog && comment.inReplyToId)
    .map((comment) => parseMastodonComment(comment));

  // Sort by creation time (oldest first)
  comments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return comments;
}

/**
 * Parse a Mastodon status into a cleaner comment format.
 */
function parseMastodonComment(status: MastodonComment): MastodonComment {
  return {
    id: status.id,
    content: status.content,
    createdAt: status.createdAt,
    url: status.url,
    inReplyToId: status.inReplyToId,
    inReplyToAccountId: status.inReplyToAccountId,
    account: {
      id: status.account.id,
      username: status.account.username,
      acct: status.account.acct,
      displayName: status.account.displayName,
      avatar: status.account.avatar,
      url: status.account.url,
    },
    mediaAttachments: status.mediaAttachments,
    sensitive: status.sensitive,
    spoilerText: status.spoilerText,
  };
}

/**
 * Parse a Mastodon status URL to extract instance and status ID.
 */
export function parseMastodonUrl(
  url: string,
  fallbackInstance?: string
): { instance: string; statusId: string } | null {
  try {
    // Handle full URL: https://mastodon.social/@user/12345678
    const urlObj = new URL(url);
    const instance = urlObj.host;

    // Extract status ID from path: /@username/12345678
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2 && pathParts[1]) {
      const statusId = pathParts[1];

      return { instance, statusId };
    }

    return null;
  } catch {
    // If URL parsing fails, try fallback instance
    if (fallbackInstance) {
      // Assume the URL is just a status ID
      return { instance: fallbackInstance, statusId: url };
    }
    return null;
  }
}

/**
 * Check if a URL is a Mastodon status URL.
 */
export function isMastodonUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Mastodon instances typically have paths like /@user/12345678
    return urlObj.pathname.includes("/@") && NUMBER_REGEX.test(urlObj.pathname);
  } catch {
    return false;
  }
}

/**
 * Extract status ID from a Mastodon URL.
 */
export function extractMastodonStatusId(urlOrId: string): string | null {
  // If it's already just a number, return it
  if (NUMBER_REGEX.test(urlOrId)) {
    return urlOrId;
  }

  const parsed = parseMastodonUrl(urlOrId);
  return parsed?.statusId ?? null;
}
