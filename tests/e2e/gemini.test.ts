import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tlsRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Gemini protocol E2E", () => {
  it("returns gemtext for a valid request", async () => {
    const response = await tlsRequest(
      e2e.geminiPort,
      `gemini://localhost:${e2e.geminiPort}/blog/welcome\r\n`
    );
    expect(response).toContain("Welcome to Hypernext");
  });

  it("returns 51 Not Found for missing doc", async () => {
    const response = await tlsRequest(
      e2e.geminiPort,
      `gemini://localhost:${e2e.geminiPort}/blog/nonexistent\r\n`
    );
    expect(response).toContain("51 Not Found");
  });

  it("returns home page for root request", async () => {
    const response = await tlsRequest(
      e2e.geminiPort,
      `gemini://localhost:${e2e.geminiPort}/\r\n`
    );
    expect(response).toContain("E2E Test");
  });
});
