import yaml from "yaml";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function extractFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { attributes: {}, body: content };
  }

  let attributes: Record<string, unknown>;
  try {
    attributes = yaml.parse(match[1] ?? "") as Record<string, unknown>;
  } catch {
    attributes = {};
  }

  return {
    attributes,
    body: content.slice(match[0].length),
  };
}

export function isDocPrivate(content: string): boolean {
  const { attributes } = extractFrontmatter(content);
  return isDocPrivateFrontmatter(attributes);
}

export function isDocPrivateFrontmatter(
  frontmatter: Record<string, unknown>
): boolean {
  return frontmatter.visibility === "private";
}

export function isFutureDated(content: string): boolean {
  const { attributes } = extractFrontmatter(content);
  return isFutureDatedFrontmatter(attributes);
}

export function isFutureDatedFrontmatter(
  frontmatter: Record<string, unknown>
): boolean {
  const publishAt = frontmatter.publishAt as string | undefined;
  const date = frontmatter.date as string | undefined;
  const target = publishAt ?? date;
  if (!target) {
    return false;
  }
  return new Date(target).getTime() > Date.now();
}
