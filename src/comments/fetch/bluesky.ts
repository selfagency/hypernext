/**
 * Bluesky comment fetcher using AT Protocol.
 * Fetches replies to a post via getPostThread API.
 */

const URL_MATCH_REGEX = /post\/([a-zA-Z0-9]+)/;
const AT_MATCH_REGEX = /app\.bsky\.feed\.post\/([a-zA-Z0-9]+)/;

export interface BlueskyComment {
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  cid: string;
  content: string;
  createdAt: string;
  id: string;
  likeCount?: number;
  parentUri?: string;
  replyCount?: number;
  rootUri?: string;
  uri: string;
}

export interface BlueskyCommentThread {
  post: BlueskyComment;
  replies?: BlueskyComment[];
}

/**
 * Fetch comments (replies) for a Bluesky post URI.
 * @param uri - AT URI like "at://did:plc:xxx/app.bsky.feed.post/xxx"
 * @param depth - Maximum reply depth (default 3)
 */
export async function fetchBlueskyComments(
  uri: string,
  depth = 3
): Promise<BlueskyComment[]> {
  const BSKY_API =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread";

  const url = new URL(BSKY_API);
  url.searchParams.set("uri", uri);
  url.searchParams.set("depth", String(depth));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Bluesky API error: ${response.status}`);
  }

  const data = (await response.json()) as { thread?: Record<string, unknown> };
  return parseBlueskyThread(data.thread ?? {});
}

/**
 * Parse Bluesky thread response into flat comment list.
 */
function parseBlueskyThread(thread: Record<string, unknown>): BlueskyComment[] {
  const comments: BlueskyComment[] = [];

  if (!thread || typeof thread !== "object") {
    return comments;
  }

  const rootPost = thread.post as Record<string, unknown> | undefined;
  if (!rootPost) {
    return comments;
  }

  const rootAuthor = rootPost.author as Record<string, unknown> | undefined;
  const rootRecord = rootPost.record as Record<string, unknown> | undefined;

  const root: BlueskyComment = {
    id: (rootPost.uri as string)?.split("/").pop() ?? "",
    author: {
      did: (rootAuthor?.did as string) ?? "",
      handle: (rootAuthor?.handle as string) ?? "",
      displayName: rootAuthor?.displayName as string | undefined,
      avatar: rootAuthor?.avatar as string | undefined,
    },
    content: (rootRecord?.text as string) ?? "",
    createdAt: (rootRecord?.createdAt as string) ?? "",
    uri: (rootPost.uri as string) ?? "",
    cid: (rootPost.cid as string) ?? "",
    likeCount: rootPost.likeCount as number | undefined,
    replyCount: rootPost.replyCount as number | undefined,
    parentUri: undefined,
    rootUri: undefined,
  };

  // Add root post as first "comment" (the syndicated post itself)
  comments.push(root);

  // Parse replies
  const replies = thread.replies as Record<string, unknown>[] | undefined;
  if (replies && Array.isArray(replies)) {
    for (const reply of replies) {
      extractComments(reply, root.uri, root.uri, comments);
    }
  }

  return comments;
}

/**
 * Recursively extract comments from thread structure.
 */
function extractComments(
  node: Record<string, unknown>,
  rootUri: string,
  parentUri: string,
  comments: BlueskyComment[]
): void {
  const post = node.post as Record<string, unknown> | undefined;
  if (!post) {
    return;
  }

  const author = post.author as Record<string, unknown> | undefined;
  const record = post.record as Record<string, unknown> | undefined;

  const comment: BlueskyComment = {
    id: (post.uri as string)?.split("/").pop() ?? "",
    author: {
      did: (author?.did as string) ?? "",
      handle: (author?.handle as string) ?? "",
      displayName: author?.displayName as string | undefined,
      avatar: author?.avatar as string | undefined,
    },
    content: (record?.text as string) ?? "",
    createdAt: (record?.createdAt as string) ?? "",
    uri: (post.uri as string) ?? "",
    cid: (post.cid as string) ?? "",
    likeCount: post.likeCount as number | undefined,
    replyCount: post.replyCount as number | undefined,
    parentUri,
    rootUri,
  };

  comments.push(comment);

  // Recursively process nested replies
  const replies = node.replies as Record<string, unknown>[] | undefined;
  if (replies && Array.isArray(replies)) {
    for (const reply of replies) {
      extractComments(reply, rootUri, comment.uri, comments);
    }
  }
}

/**
 * Check if a URI is a valid Bluesky AT URI.
 */
export function isBlueskyUri(uri: string): boolean {
  return uri.startsWith("at://") || uri.includes("/app.bsky.feed.post/");
}

/**
 * Extract post ID from Bluesky URI or URL.
 */
export function extractBlueskyPostId(uriOrUrl: string): string | null {
  // Handle full URL: https://bsky.app/profile/handle/post/xyz
  const urlMatch = uriOrUrl.match(URL_MATCH_REGEX);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Handle AT URI: at://did/collection/id
  const atMatch = uriOrUrl.match(AT_MATCH_REGEX);
  if (atMatch?.[1]) {
    return atMatch[1];
  }

  return null;
}
