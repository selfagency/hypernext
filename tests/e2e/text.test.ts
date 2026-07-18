import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Text protocol E2E", () => {
  it("returns 20 OK for a valid request", async () => {
    const response = await tcpRequest(e2e.textPort, "/blog/welcome\n");
    expect(response).toContain("20 OK");
    expect(response).toContain("Welcome to Hypernext");
  });

  it("returns 40 Not Found for missing doc", async () => {
    const response = await tcpRequest(e2e.textPort, "/blog/nonexistent\n");
    expect(response).toContain("40 Not Found");
  });

  it("returns home page for root request", async () => {
    const response = await tcpRequest(e2e.textPort, "/\n");
    expect(response).toContain("20");
    expect(response).toContain("E2E Test");
  });
});
