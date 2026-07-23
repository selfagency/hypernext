import { describe, expect, it } from "vitest";
import { resolveFederatedComments } from "../src/comments/federated/component";

describe("resolveFederatedComments", () => {
  it("should export function", () => {
    expect(typeof resolveFederatedComments).toBe("function");
  });
});
