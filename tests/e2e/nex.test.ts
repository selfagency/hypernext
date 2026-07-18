import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("NEX protocol E2E", () => {
  it("returns gemtext for a valid request", async () => {
    const response = await tcpRequest(e2e.nexPort, "/blog/welcome");
    expect(response).toContain("Welcome to Hypernext");
  });

  it("returns Not Found for missing doc", async () => {
    const response = await tcpRequest(e2e.nexPort, "/blog/nonexistent");
    expect(response).toContain("Not Found");
  });

  it("returns home page for root request", async () => {
    const response = await tcpRequest(e2e.nexPort, "/");
    expect(response).toContain("E2E Test");
  });
});
