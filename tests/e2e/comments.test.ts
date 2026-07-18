import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiHeaders, apiUrl } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

function sendWebmention(source: string, target: string): Promise<Response> {
  return fetch(apiUrl("/webmention"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, target }),
  });
}

async function getMentions(status?: string, slug?: string): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (slug) {
    params.set("slug", slug);
  }
  const response = await fetch(
    apiUrl(`/api/v1/mentions?${params.toString()}`),
    {
      headers: apiHeaders(),
    }
  );
  const body = (await response.json()) as { data: unknown[] };
  return body.data;
}

describe("Comments E2E", () => {
  it("accepts a ham webmention and stores it", async () => {
    const target = `${e2e.config.site.canonicalBase}/blog/with-comments`;
    const source = `http://localhost:${e2e.mockSourcePort}/ham?target=${encodeURIComponent(target)}`;

    const response = await sendWebmention(source, target);
    expect(response.status).toBe(202);

    // Poll moderation API until mention appears
    let mentions: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      mentions = await getMentions("ham", "blog/with-comments");
      if (mentions.length > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(mentions.length).toBeGreaterThan(0);
    const mention = mentions[0] as { spamStatus: string; content: string };
    expect(mention.spamStatus).toBe("ham");
    expect(mention.content).toContain("Great post");
  });

  it("flags spam webmentions via Akismet", async () => {
    const target = `${e2e.config.site.canonicalBase}/blog/with-comments`;
    const source = `http://localhost:${e2e.mockSourcePort}/spam?target=${encodeURIComponent(target)}`;

    const response = await sendWebmention(source, target);
    expect(response.status).toBe(202);

    let mentions: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      mentions = await getMentions("spam", "blog/with-comments");
      if (mentions.length > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(mentions.length).toBeGreaterThan(0);
    const mention = mentions[0] as { spamStatus: string; content: string };
    expect(mention.spamStatus).toBe("spam");
  });

  it("rejects webmentions when frontmatter disables them", async () => {
    const target = `${e2e.config.site.canonicalBase}/blog/no-webmentions`;
    const source = `http://localhost:${e2e.mockSourcePort}/ham?target=${encodeURIComponent(target)}`;

    const response = await sendWebmention(source, target);
    expect(response.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const mentions = await getMentions(undefined, "blog/no-webmentions");
    expect(mentions.length).toBe(0);
  });
});
