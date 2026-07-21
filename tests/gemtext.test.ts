import { describe, expect, it } from "vitest";
import type { IrNode } from "../src/parser/ir.js";
import { renderGemtext } from "../src/renderers/gemtext.js";

function n(type: string, overrides: Partial<IrNode> = {}): IrNode {
  return { type: type as IrNode["type"], ...overrides } as IrNode;
}

describe("renderGemtext", () => {
  it("renders root with children", () => {
    const result = renderGemtext(
      n("root", { children: [n("text", { value: "Hello" })] })
    );
    expect(result).toBe("Hello");
  });

  it("renders headings", () => {
    expect(
      renderGemtext(
        n("heading", { depth: 1, children: [n("text", { value: "Title" })] })
      )
    ).toBe("# Title");
    expect(
      renderGemtext(
        n("heading", { depth: 3, children: [n("text", { value: "Sub" })] })
      )
    ).toBe("### Sub");
  });

  it("renders paragraphs", () => {
    expect(
      renderGemtext(
        n("paragraph", { children: [n("text", { value: "Text" })] })
      )
    ).toBe("Text");
  });

  it("renders links", () => {
    expect(
      renderGemtext(
        n("link", {
          url: "https://x.com",
          children: [n("text", { value: "X" })],
        })
      )
    ).toBe("=> https://x.com X");
  });

  it("renders images", () => {
    expect(renderGemtext(n("image", { url: "pic.jpg", alt: "Pic" }))).toBe(
      "=> pic.jpg Pic"
    );
  });

  it("renders lists", () => {
    const result = renderGemtext(
      n("list", {
        children: [n("listItem", { children: [n("text", { value: "A" })] })],
      })
    );
    expect(result).toContain("* A");
  });

  it("renders code blocks", () => {
    expect(renderGemtext(n("code", { lang: "ts", value: "const x = 1" }))).toBe(
      "```ts\nconst x = 1\n```"
    );
  });

  it("renders blockquotes", () => {
    expect(
      renderGemtext(
        n("blockquote", { children: [n("text", { value: "Quote" })] })
      )
    ).toBe("> Quote");
  });

  it("renders structural elements as their children", () => {
    const result = renderGemtext(
      n("section", { children: [n("text", { value: "Content" })] })
    );
    expect(result).toBe("Content");
  });

  it("renders header/main/aside/footer/nav as children", () => {
    for (const type of ["header", "main", "aside", "footer", "nav"] as const) {
      expect(
        renderGemtext(n(type, { children: [n("text", { value: "X" })] }))
      ).toBe("X");
    }
  });

  it("renders time nodes", () => {
    expect(renderGemtext(n("time", { value: "2026-07-20" }))).toBe(
      "2026-07-20"
    );
  });

  it("renders thematic break", () => {
    expect(renderGemtext(n("thematicBreak"))).toBe("---");
  });

  it("renders inline code", () => {
    expect(renderGemtext(n("inlineCode", { value: "x" }))).toBe("`x`");
  });

  it("renders strong", () => {
    expect(
      renderGemtext(n("strong", { children: [n("text", { value: "bold" })] }))
    ).toBe("**bold**");
  });

  it("renders emphasis", () => {
    expect(
      renderGemtext(
        n("emphasis", { children: [n("text", { value: "italic" })] })
      )
    ).toBe("*italic*");
  });

  it("renders math blocks", () => {
    expect(renderGemtext(n("math", { value: "E=mc^2" }))).toBe(
      "```math\nE=mc^2\n```"
    );
  });

  it("renders inline math", () => {
    expect(renderGemtext(n("inlineMath", { value: "E=mc^2" }))).toBe(
      "$E=mc^2$"
    );
  });

  it("renders mentions", () => {
    const result = renderGemtext(
      n("mention", {
        authorName: "Alice",
        content: "Hi",
        sourceUrl: "https://a.com/post",
      })
    );
    expect(result).toContain("> Alice");
    expect(result).toContain("> Hi");
    expect(result).toContain("> https://a.com/post");
  });

  it("returns empty for unknown types", () => {
    expect(renderGemtext(n("component" as any))).toBe("");
  });
});
