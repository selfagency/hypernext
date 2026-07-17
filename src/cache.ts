import { LRUCache } from "lru-cache";
import type { ParseResult } from "./parser/ir.js";

const renderCache = new LRUCache<string, string>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

const parseCache = new LRUCache<string, ParseResult>({
  max: 500,
  ttl: 1000 * 60 * 5,
});

export function getCachedRender(key: string): string | undefined {
  return renderCache.get(key);
}

export function setCachedRender(key: string, value: string): void {
  renderCache.set(key, value);
}

export function getCachedParse(slug: string): ParseResult | undefined {
  return parseCache.get(slug);
}

export function setCachedParse(slug: string, result: ParseResult): void {
  parseCache.set(slug, result);
}

export function getOrCompute(
  slug: string,
  renderer: (result: ParseResult) => string,
  parser: (slug: string) => ParseResult
): string {
  const cacheKey = `${slug}:html`;
  const cached = getCachedRender(cacheKey);
  if (cached) {
    return cached;
  }

  const parsed = getCachedParse(slug) ?? parser(slug);
  setCachedParse(slug, parsed);

  const rendered = renderer(parsed);
  setCachedRender(cacheKey, rendered);
  return rendered;
}

export function invalidateAll(slug: string): void {
  renderCache.delete(`${slug}:html`);
  parseCache.delete(slug);
}
