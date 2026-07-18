import { describe, expect, it } from "vitest";
import {
  createInitialState,
  parseFrontmatter,
  serializeFrontmatter,
} from "../src/tui/state";

describe("TUI state", () => {
  describe("createInitialState", () => {
    it("creates initial state in local mode", () => {
      const state = createInitialState("local");
      expect(state.mode).toBe("local");
      expect(state.files).toEqual([]);
      expect(state.activeFileIndex).toBe(-1);
      expect(state.explorerVisible).toBe(true);
      expect(state.previewVisible).toBe(true);
      expect(state.previewMode).toBe("preview");
      expect(state.dashboardVisible).toBe(false);
      expect(state.moderationVisible).toBe(false);
      expect(state.commandPalette.open).toBe(false);
      expect(state.commandPalette.filter).toBe("");
    });

    it("creates initial state in remote mode", () => {
      const state = createInitialState("remote");
      expect(state.mode).toBe("remote");
    });
  });

  describe("parseFrontmatter", () => {
    it("parses basic frontmatter", () => {
      const { frontmatter, body } = parseFrontmatter(
        "---\ntitle: Hello\ntype: post\n---\n\n# Body"
      );
      expect(frontmatter.title).toBe("Hello");
      expect(frontmatter.type).toBe("post");
      expect(body).toBe("\n# Body");
    });

    it("returns empty frontmatter for content without frontmatter", () => {
      const { frontmatter, body } = parseFrontmatter("# Just content");
      expect(frontmatter).toEqual({});
      expect(body).toBe("# Just content");
    });

    it("parses boolean values", () => {
      const { frontmatter } = parseFrontmatter(
        "---\nenabled: true\nvisible: false\n---\n\nContent"
      );
      expect(frontmatter.enabled).toBe(true);
      expect(frontmatter.visible).toBe(false);
    });

    it("parses quoted strings", () => {
      const { frontmatter } = parseFrontmatter(
        '---\ntitle: "Hello World"\n---\n\nContent'
      );
      expect(frontmatter.title).toBe("Hello World");
    });
  });

  describe("serializeFrontmatter", () => {
    it("serializes frontmatter and body", () => {
      const result = serializeFrontmatter(
        { title: "Test", type: "post" },
        "# Body"
      );
      expect(result).toContain("---");
      expect(result).toContain('title: "Test"');
      expect(result).toContain('type: "post"');
      expect(result).toContain("# Body");
    });

    it("serializes boolean values", () => {
      const result = serializeFrontmatter(
        { enabled: true, visible: false },
        ""
      );
      expect(result).toContain("enabled: true");
      expect(result).toContain("visible: false");
    });

    it("serializes numeric values", () => {
      const result = serializeFrontmatter({ order: 5 }, "");
      expect(result).toContain("order: 5");
    });
  });
});
