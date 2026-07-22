import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  convertContent,
  slugify,
} from "../src/micropub/utils.js";

describe("micropub utils", () => {
  describe("slugify", () => {
    it("converts text to lowercase slug", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    it("removes special characters", () => {
      expect(slugify("Hello! @World #2024")).toBe("hello-world-2024");
    });

    it("collapses multiple hyphens", () => {
      expect(slugify("hello---world")).toBe("hello-world");
    });

    it("trims whitespace", () => {
      expect(slugify("  hello world  ")).toBe("-hello-world-");
    });
  });

  describe("buildFrontmatter", () => {
    it("builds frontmatter with title and date", () => {
      const fm = buildFrontmatter({ name: ["Test Post"] });
      expect(fm).toContain('title: "Test Post"');
      expect(fm).toContain("type: post");
      expect(fm).toContain("date:");
    });

    it("includes tags when provided", () => {
      const fm = buildFrontmatter({
        name: ["Test"],
        category: ["tag1", "tag2"],
      });
      expect(fm).toContain("tag1");
      expect(fm).toContain("tag2");
    });

    it("uses Untitled when no name", () => {
      const fm = buildFrontmatter({});
      expect(fm).toContain("Untitled");
    });
  });

  describe("convertContent", () => {
    it("returns content string", () => {
      expect(convertContent({ content: ["Hello"] })).toBe("Hello");
    });

    it("returns empty string when no content", () => {
      expect(convertContent({})).toBe("");
    });
  });
});
