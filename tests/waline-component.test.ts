import { describe, expect, it } from "vitest";

describe("WalineComments component", () => {
  it("should export resolveWalineComments function", async () => {
    const mod = await import("../src/comments/waline/component");
    expect(typeof mod.resolveWalineComments).toBe("function");
  });
});

describe("FederatedComments component", () => {
  it("should export resolveFederatedComments function", async () => {
    const mod = await import("../src/comments/federated/component");
    expect(typeof mod.resolveFederatedComments).toBe("function");
  });
});
