import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Gopher protocol E2E", () => {
  it("returns menu for root selector", async () => {
    const response = await tcpRequest(e2e.gopherPort, "/\r\n");
    expect(response).toContain("blog/welcome");
    expect(response).toContain(".\r\n");
  });

  it("returns document content for valid selector", async () => {
    const response = await tcpRequest(e2e.gopherPort, "/blog/welcome\r\n");
    expect(response).toContain("Welcome to Hypernext");
  });

  it("returns error for missing selector", async () => {
    const response = await tcpRequest(e2e.gopherPort, "/blog/nonexistent\r\n");
    expect(response).toContain("Not Found");
  });
});
