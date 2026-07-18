import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Finger protocol E2E", () => {
  it("returns author info", async () => {
    const response = await tcpRequest(e2e.fingerPort, "e2e\r\n");
    expect(response).toContain("E2E Author");
    expect(response).toContain("Testing");
  });
});
