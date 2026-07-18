import { describe, expect, it } from "vitest";
import {
  getCachedParse,
  getCachedRender,
  invalidateAll,
  setCachedParse,
  setCachedRender,
} from "../src/cache";
import type { ParseResult } from "../src/parser/ir";

describe("cache", () => {
  it("stores and retrieves parse results", () => {
    const result: ParseResult = {
      ir: { type: "root", children: [] },
      frontmatter: {},
      metadata: {},
      errors: [],
    };
    setCachedParse("test", result);
    expect(getCachedParse("test")).toBe(result);
  });

  it("stores and retrieves rendered content", () => {
    setCachedRender("test:html", "<p>hello</p>");
    expect(getCachedRender("test:html")).toBe("<p>hello</p>");
  });

  it("invalidates both caches", () => {
    setCachedParse("slug", {
      ir: { type: "root" },
      frontmatter: {},
      metadata: {},
      errors: [],
    });
    setCachedRender("slug:html", "content");
    invalidateAll("slug");
    expect(getCachedParse("slug")).toBeUndefined();
    expect(getCachedRender("slug:html")).toBeUndefined();
  });
});
