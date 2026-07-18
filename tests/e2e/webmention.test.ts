import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiHeaders, apiUrl, waitForWorkmatic } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Webmention E2E", () => {
  it("POST /webmention returns 202 Accepted", async () => {
    const res = await fetch(apiUrl("/webmention"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "https://example.com/e2e-test",
        target: `http://localhost:${e2e.httpPort}/blog/welcome`,
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("POST /webmention returns 400 on missing fields", async () => {
    const res = await fetch(apiUrl("/webmention"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /pingback returns XML-RPC response", async () => {
    const res = await fetch(apiUrl("/pingback"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        methodName: "pingback.ping",
        params: [
          { value: { string: "https://example.com/pingback-test" } },
          {
            value: { string: `http://localhost:${e2e.httpPort}/blog/welcome` },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("methodResponse");
  });

  it("GET /api/v1/mentions lists mentions", async () => {
    await waitForWorkmatic();
    const res = await fetch(apiUrl("/api/v1/mentions"), {
      headers: apiHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});
