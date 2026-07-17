export type SpamStatus = "pending" | "ham" | "spam";

export interface AkismetPayload {
  apiKey: string;
  blog: string;
  commentAuthor: string;
  commentAuthorUrl: string;
  commentContent: string;
  commentType: string;
  endpoint?: string;
  permalink: string;
  referrer: string;
  userAgent: string;
  userIp: string;
}

export async function checkAkismet(
  payload: AkismetPayload
): Promise<SpamStatus> {
  if (!payload.apiKey) {
    return "pending";
  }

  const endpoint =
    payload.endpoint ??
    `https://${payload.apiKey}.rest.akismet.com/1.1/comment-check`;
  const body = new URLSearchParams({
    blog: payload.blog,
    user_ip: payload.userIp,
    user_agent: payload.userAgent,
    referrer: payload.referrer,
    permalink: payload.permalink,
    comment_type: payload.commentType,
    comment_author: payload.commentAuthor,
    comment_author_url: payload.commentAuthorUrl,
    comment_content: payload.commentContent,
  }).toString();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await response.text();
    if (text === "true") {
      return "spam";
    }
    if (text === "false") {
      return "ham";
    }

    console.warn("Akismet API error:", text);
    return "pending";
  } catch (error) {
    console.error("Akismet fetch failed:", error);
    return "pending";
  }
}
