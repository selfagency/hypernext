import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiHeaders, apiUrl, waitForWorkmatic } from "./helpers.js";
import { setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("POSSE reply aggregation E2E", () => {
  it("renders Comments component on page", async () => {
    const res = await fetch(apiUrl("/blog/with-comments"));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The Comments component should be present in the rendered HTML
    // (it may be empty if no mentions exist yet)
    expect(html).toContain("Replies");
  });

  it("GET /api/v1/mentions returns data", async () => {
    await waitForWorkmatic();
    const res = await fetch(apiUrl("/api/v1/mentions"), {
      headers: apiHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});
