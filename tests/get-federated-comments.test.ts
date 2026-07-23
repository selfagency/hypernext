import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFederatedComments } from "../src/comments/fetch/index";

describe("getFederatedComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when slug not found", async () => {
    vi.mock("../src/database/index.js", () => ({
      getDocBySlug: vi.fn().mockResolvedValue(null),
      getSyndicationForDoc: vi.fn().mockResolvedValue([]),
    }));

    const result = await getFederatedComments("nonexistent");
    expect(result).toHaveLength(0);
  });
});
