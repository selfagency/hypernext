import { describe, expect, it } from "vitest";
import type { IrNode } from "../src/parser/ir.js";
import { renderMarkdown } from "../src/renderers/markdown.js";

function n(type: string, overrides: Partial<IrNode> = {}): IrNode {
  return { type: type as IrNode["type"], ...overrides } as IrNode;
}

function root(children: IrNode[]): IrNode {
  return n("root", { children });
}

describe("renderMarkdown", () => {
  it("renders mention with author name and platform", () => {
    const result = renderMarkdown(
      root([
        n("mention", {
          authorName: "Alice",
          platform: "webmention",
          content: "Great post!",
          sourceUrl: "https://example.com/comment",
        }),
      ])
    );
    expect(result).toContain("**Alice**");
    expect(result).toContain("via webmention");
    expect(result).toContain("Great post!");
    expect(result).toContain("Permalink");
  });

  it("renders mention without optional fields", () => {
    const result = renderMarkdown(root([n("mention", { authorName: "Bob" })]));
    expect(result).toContain("**Bob**");
  });

  it("renders table with rows and cells", () => {
    const result = renderMarkdown(
      root([
        n("table", {
          children: [
            n("tableRow", {
              children: [
                n("tableCell", { children: [n("text", { value: "A" })] }),
              ],
            }),
          ],
        }),
      ])
    );
    expect(result).toContain("| A |");
  });

  it("renders component as empty string", () => {
    const result = renderMarkdown(
      root([n("component", { componentName: "Test" })])
    );
    expect(result).toBe("");
  });

  it("renders time node", () => {
    const result = renderMarkdown(root([n("time", { value: "2026-07-20" })]));
    expect(result).toBe("2026-07-20");
  });

  it("renders thematic break", () => {
    const result = renderMarkdown(root([n("thematicBreak")]));
    expect(result).toBe("---");
  });

  it("renders inline code", () => {
    const result = renderMarkdown(
      root([n("inlineCode", { value: "const x = 1" })])
    );
    expect(result).toBe("`const x = 1`");
  });

  it("renders strong", () => {
    const result = renderMarkdown(
      root([n("strong", { children: [n("text", { value: "bold" })] })])
    );
    expect(result).toBe("**bold**");
  });

  it("renders emphasis", () => {
    const result = renderMarkdown(
      root([n("emphasis", { children: [n("text", { value: "italic" })] })])
    );
    expect(result).toBe("*italic*");
  });

  it("renders delete", () => {
    const result = renderMarkdown(
      root([n("delete", { children: [n("text", { value: "strikethrough" })] })])
    );
    expect(result).toBe("~~strikethrough~~");
  });

  it("renders math blocks", () => {
    const result = renderMarkdown(root([n("math", { value: "E = mc^2" })]));
    expect(result).toContain("$$");
    expect(result).toContain("E = mc^2");
  });

  it("renders inline math", () => {
    const result = renderMarkdown(
      root([n("inlineMath", { value: "a^2 + b^2" })])
    );
    expect(result).toBe("$a^2 + b^2$");
  });

  it("renders structural types as children", () => {
    const result = renderMarkdown(
      root([
        n("section", {
          children: [n("text", { value: "section content" })],
        }),
      ])
    );
    expect(result).toContain("section content");
  });

  it("renders header/main/aside/footer/nav as children", () => {
    for (const type of ["header", "main", "aside", "footer"]) {
      const result = renderMarkdown(
        root([
          n(type, {
            children: [n("text", { value: `${type} content` })],
          }),
        ])
      );
      expect(result).toContain(`${type} content`);
    }
  });

  it("renders nav with children", () => {
    const result = renderMarkdown(
      root([
        n("nav", {
          children: [
            n("link", { url: "/", children: [n("text", { value: "Home" })] }),
          ],
        }),
      ])
    );
    expect(result).toContain("[Home](/)");
  });
});
