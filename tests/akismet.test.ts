import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAkismet } from "../src/federation/akismet";

const validPayload = {
  apiKey: "test-key",
  blog: "https://example.com",
  userIp: "1.2.3.4",
  userAgent: "Mozilla/5.0",
  referrer: "https://referrer.com",
  permalink: "https://example.com/post",
  commentType: "webmention",
  commentAuthor: "Alice",
  commentAuthorUrl: "https://alice.example.com",
  commentContent: "Great post!",
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

describe("Akismet spam check", () => {
  it("returns ham when Akismet says false", async () => {
    server.use(
      http.post("https://test-key.rest.akismet.com/1.1/comment-check", () =>
        HttpResponse.text("false")
      )
    );
    const result = await checkAkismet(validPayload);
    expect(result).toBe("ham");
  });

  it("returns spam when Akismet says true", async () => {
    server.use(
      http.post("https://test-key.rest.akismet.com/1.1/comment-check", () =>
        HttpResponse.text("true")
      )
    );
    const result = await checkAkismet(validPayload);
    expect(result).toBe("spam");
  });

  it("returns pending when no API key", async () => {
    const result = await checkAkismet({ ...validPayload, apiKey: "" });
    expect(result).toBe("pending");
  });

  it("returns pending on network error", async () => {
    server.use(
      http.post("https://test-key.rest.akismet.com/1.1/comment-check", () =>
        HttpResponse.error()
      )
    );
    const result = await checkAkismet(validPayload);
    expect(result).toBe("pending");
  });

  it("returns pending on unexpected response", async () => {
    server.use(
      http.post("https://test-key.rest.akismet.com/1.1/comment-check", () =>
        HttpResponse.text("invalid")
      )
    );
    const result = await checkAkismet(validPayload);
    expect(result).toBe("pending");
  });

  it("sends correct endpoint URL", async () => {
    let capturedUrl = "";
    server.use(
      http.post(
        "https://test-key.rest.akismet.com/1.1/comment-check",
        (req) => {
          capturedUrl = req.request.url;
          return HttpResponse.text("false");
        }
      )
    );
    await checkAkismet(validPayload);
    expect(capturedUrl).toBe(
      "https://test-key.rest.akismet.com/1.1/comment-check"
    );
  });

  it("sends form-encoded body with expected fields", async () => {
    let capturedBody = "";
    server.use(
      http.post(
        "https://test-key.rest.akismet.com/1.1/comment-check",
        async (req) => {
          capturedBody = await req.request.text();
          return HttpResponse.text("false");
        }
      )
    );
    await checkAkismet(validPayload);
    expect(capturedBody).toContain("blog=https%3A%2F%2Fexample.com");
    expect(capturedBody).toContain("user_ip=1.2.3.4");
    expect(capturedBody).toContain("comment_type=webmention");
  });
});
