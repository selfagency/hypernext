import { describe, expect, it } from "vitest";
import {
  isDocPrivate,
  isDocPrivateFrontmatter,
  isFutureDated,
  isFutureDatedFrontmatter,
} from "../src/parser/frontmatter";

describe("frontmatter", () => {
  describe("isDocPrivate", () => {
    it("returns true for private visibility", () => {
      expect(isDocPrivate("---\nvisibility: private\n---\n\nContent")).toBe(
        true
      );
    });

    it("returns false for public visibility", () => {
      expect(isDocPrivate("---\nvisibility: public\n---\n\nContent")).toBe(
        false
      );
    });

    it("returns false when no visibility", () => {
      expect(isDocPrivate("# Just content")).toBe(false);
    });
  });

  describe("isDocPrivateFrontmatter", () => {
    it("returns true for private", () => {
      expect(isDocPrivateFrontmatter({ visibility: "private" })).toBe(true);
    });

    it("returns false for public", () => {
      expect(isDocPrivateFrontmatter({ visibility: "public" })).toBe(false);
    });

    it("returns false when key missing", () => {
      expect(isDocPrivateFrontmatter({})).toBe(false);
    });
  });

  describe("isFutureDated", () => {
    it("returns true for future date", () => {
      const future = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(isFutureDated(`---\ndate: ${future}\n---\n\nFuture`)).toBe(true);
    });

    it("returns false for past date", () => {
      expect(isFutureDated("---\ndate: 2020-01-01\n---\n\nPast")).toBe(false);
    });

    it("returns false when no date", () => {
      expect(isFutureDated("# No date")).toBe(false);
    });

    it("checks publishAt before date", () => {
      const future = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(
        isFutureDated(
          `---\ndate: 2020-01-01\nscheduledAt: ${future}\n---\n\nScheduled`
        )
      ).toBe(true);
    });
  });

  describe("isFutureDatedFrontmatter", () => {
    it("returns true for future scheduledAt", () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(isFutureDatedFrontmatter({ scheduledAt: future })).toBe(true);
    });

    it("returns false for past date", () => {
      expect(isFutureDatedFrontmatter({ date: "2020-01-01" })).toBe(false);
    });

    it("returns false when no date", () => {
      expect(isFutureDatedFrontmatter({})).toBe(false);
    });
  });
});
