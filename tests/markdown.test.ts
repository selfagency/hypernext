import { describe, expect, it } from "vitest";
import type { IrNode } from "../src/parser/ir.js";
import { renderMarkdown } from "../src/renderers/markdown.js";

function n(type: string, overrides: Partial<IrNode> = {}): IrNode {
  return { type: type as IrNode["type"], ...overrides } as IrNode;
}

describe("renderMarkdown", () => {
  it("renders root with children", () => {
    expect(
      renderMarkdown(n("root", { children: [n("text", { value: "Hi" })] }))
    ).toBe("Hi");
  });

  it("renders headings", () => {
    expect(
      renderMarkdown(
        n("heading", { depth: 2, children: [n("text", { value: "Sub" })] })
      )
    ).toBe("## Sub");
  });

  it("renders paragraphs", () => {
    expect(
      renderMarkdown(n("paragraph", { children: [n("text", { value: "P" })] }))
    ).toBe("P");
  });

  it("renders links", () => {
    expect(
      renderMarkdown(
        n("link", {
          url: "https://x.com",
          children: [n("text", { value: "X" })],
        })
      )
    ).toBe("[X](https://x.com)");
  });

  it("renders images", () => {
    expect(renderMarkdown(n("image", { url: "pic.jpg", alt: "Pic" }))).toBe(
      "![Pic](pic.jpg)"
    );
  });

  it("renders list items", () => {
    expect(
      renderMarkdown(
        n("listItem", { children: [n("text", { value: "Item" })] })
      )
    ).toBe("- Item");
  });

  it("renders code blocks", () => {
    expect(
      renderMarkdown(n("code", { lang: "ts", value: "const x = 1" }))
    ).toBe("```ts\nconst x = 1\n```");
  });

  it("renders blockquotes", () => {
    expect(
      renderMarkdown(n("blockquote", { children: [n("text", { value: "Q" })] }))
    ).toBe("> Q");
  });

  it("renders section and structural types as children", () => {
    expect(
      renderMarkdown(n("section", { children: [n("text", { value: "C" })] }))
    ).toBe("C");
  });

  it("renders header/main/aside/footer/nav as children", () => {
    for (const type of ["header", "main", "aside", "footer", "nav"] as const) {
      expect(
        renderMarkdown(n(type, { children: [n("text", { value: "X" })] }))
      ).toBe("X");
    }
  });

  it("renders time nodes", () => {
    expect(renderMarkdown(n("time", { value: "2026-07-20" }))).toBe(
      "2026-07-20"
    );
  });

  it("renders thematic break", () => {
    expect(renderMarkdown(n("thematicBreak"))).toBe("---");
  });

  it("renders inline code", () => {
    expect(renderMarkdown(n("inlineCode", { value: "code" }))).toBe("`code`");
  });

  it("renders strong", () => {
    expect(
      renderMarkdown(n("strong", { children: [n("text", { value: "b" })] }))
    ).toBe("**b**");
  });

  it("renders emphasis", () => {
    expect(
      renderMarkdown(n("emphasis", { children: [n("text", { value: "i" })] }))
    ).toBe("*i*");
  });

  it("renders delete", () => {
    expect(
      renderMarkdown(n("delete", { children: [n("text", { value: "s" })] }))
    ).toBe("~~s~~");
  });

  it("renders math", () => {
    expect(renderMarkdown(n("math", { value: "E=mc^2" }))).toBe(
      "$$\nE=mc^2\n$$"
    );
  });

  it("renders inline math", () => {
    expect(renderMarkdown(n("inlineMath", { value: "x" }))).toBe("$x$");
  });

  it("renders mentions", () => {
    const result = renderMarkdown(
      n("mention", {
        authorName: "A",
        content: "C",
        sourceUrl: "https://x.com",
      })
    );
    expect(result).toContain("> **A**");
    expect(result).toContain("> C");
    expect(result).toContain("[Permalink](https://x.com)");
  });

  it("returns empty for unknown types", () => {
    expect(renderMarkdown(n("component" as any))).toBe("");
  });
});
