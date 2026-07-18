import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Spartan protocol E2E", () => {
  it("returns gemtext for a valid request", async () => {
    const response = await tcpRequest(
      e2e.spartanPort,
      "localhost /blog/welcome 0\r\n"
    );
    expect(response).toContain("Welcome to Hypernext");
  });

  it("returns 510 Not Found for missing doc", async () => {
    const response = await tcpRequest(
      e2e.spartanPort,
      "localhost /blog/nonexistent 0\r\n"
    );
    expect(response).toContain("510 Not Found");
  });

  it("returns home page for root request", async () => {
    const response = await tcpRequest(e2e.spartanPort, "localhost / 0\r\n");
    expect(response).toContain("E2E Test");
  });
});
