import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tcpRequest } from "./helpers.js";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Privacy enforcement E2E", () => {
  it("excludes private docs from Gopher root menu", async () => {
    const response = await tcpRequest(e2e.gopherPort, "/\r\n");
    expect(response).toContain("blog/welcome");
    expect(response).not.toContain("blog/private");
  });

  it("returns Not Found for private doc via Gopher", async () => {
    const response = await tcpRequest(e2e.gopherPort, "/blog/private\r\n");
    expect(response).toContain("Not Found");
    expect(response).not.toContain("This is a private post");
  });

  it("returns Not Found for private doc via Text protocol", async () => {
    const response = await tcpRequest(e2e.textPort, "/blog/private\n");
    expect(response).toContain("40 Not Found");
    expect(response).not.toContain("This is a private post");
  });

  it("returns Not Found for private doc via NEX", async () => {
    const response = await tcpRequest(e2e.nexPort, "/blog/private\n");
    expect(response).toContain("Not Found");
    expect(response).not.toContain("This is a private post");
  });

  it("returns Not Found for private doc via Spartan", async () => {
    const response = await tcpRequest(
      e2e.spartanPort,
      "localhost /blog/private 0\r\n"
    );
    expect(response).toContain("510 Not Found");
    expect(response).not.toContain("This is a private post");
  });
});
