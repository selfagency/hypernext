import { describe, expect, it } from "vitest";
import { parseToIR } from "../src/parser/pipeline";

describe("parseToIR", () => {
  it("parses a simple heading and paragraph", () => {
    const result = parseToIR("# Hello\n\nWorld.");
    expect(result.ir.type).toBe("root");
    expect(result.ir.children).toHaveLength(2);
    expect(result.ir.children?.[0]?.type).toBe("heading");
    expect(result.ir.children?.[0]?.depth).toBe(1);
    expect(result.ir.children?.[1]?.type).toBe("paragraph");
  });

  it("extracts frontmatter", () => {
    const result = parseToIR("---\ntitle: Test\n---\n\n# Hello");
    expect(result.frontmatter.title).toBe("Test");
  });

  it("rejects unknown JSX components with Security Error", () => {
    expect(() => parseToIR("<Unknown />")).toThrow(
      "Security Error: Unknown component <Unknown>"
    );
  });

  it("rejects <script> as unknown component", () => {
    expect(() => parseToIR("<script>alert(1)</script>")).toThrow(
      "Security Error: Unknown component <script>"
    );
  });

  it("allows known components", () => {
    const result = parseToIR("<NavMenu />");
    expect(result.ir.children).toHaveLength(1);
    expect(result.ir.children?.[0]?.type).toBe("component");
    expect(result.ir.children?.[0]?.componentName).toBe("NavMenu");
  });

  it("parses ordered and unordered lists", () => {
    const result = parseToIR("- a\n- b\n\n1. one\n2. two");
    expect(result.ir.children).toHaveLength(2);
    expect(result.ir.children?.[0]?.type).toBe("list");
    expect(result.ir.children?.[0]?.ordered).toBe(false);
    expect(result.ir.children?.[1]?.type).toBe("list");
    expect(result.ir.children?.[1]?.ordered).toBe(true);
  });

  it("parses code blocks", () => {
    const result = parseToIR("```ts\nconst x = 1\n```");
    const code = result.ir.children?.[0];
    expect(code?.type).toBe("code");
    expect(code?.lang).toBe("ts");
    expect(code?.value).toBe("const x = 1");
  });

  it("parses links and images", () => {
    const result = parseToIR("[a](https://x.com)![alt](img.png)");
    const children = result.ir.children?.[0]?.children;
    expect(children).toHaveLength(2);
    expect(children?.[0]?.type).toBe("link");
    expect(children?.[0]?.url).toBe("https://x.com");
    expect(children?.[1]?.type).toBe("image");
    expect(children?.[1]?.url).toBe("img.png");
  });

  it("parses inline formatting", () => {
    const result = parseToIR("**bold** *italic* `code` ~~del~~");
    const children = result.ir.children?.[0]?.children;
    expect(children).toHaveLength(7);
    expect(children?.[0]?.type).toBe("strong");
    expect(children?.[2]?.type).toBe("emphasis");
    expect(children?.[4]?.type).toBe("inlineCode");
    expect(children?.[6]?.type).toBe("delete");
  });

  it("parses blockquotes and thematic breaks", () => {
    const result = parseToIR("> quote\n\n---");
    expect(result.ir.children?.[0]?.type).toBe("blockquote");
    expect(result.ir.children?.[1]?.type).toBe("thematicBreak");
  });

  it("parses math blocks", () => {
    const result = parseToIR("$$\n\\sum_{i=1}^n i\n$$");
    const math = result.ir.children?.[0];
    expect(math?.type).toBe("math");
    expect(math?.value).toContain("sum");
  });

  it("parses tables", () => {
    const result = parseToIR("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(result.ir.children?.[0]?.type).toBe("table");
  });

  it("returns empty errors array on success", () => {
    const result = parseToIR("# Hello");
    expect(result.errors).toEqual([]);
  });
});
