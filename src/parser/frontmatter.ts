import yaml from "yaml";

// Allow empty frontmatter (---\n---) and whitespace-only frontmatter
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WHITESPACE_RE = /^\s*$/;

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function extractFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { attributes: {}, body: content };
  }

  const raw = match[1] ?? "";
  // Empty or whitespace-only frontmatter: return empty attributes
  if (WHITESPACE_RE.test(raw)) {
    return { attributes: {}, body: content.slice(match[0].length) };
  }

  let attributes: Record<string, unknown>;
  try {
    attributes = yaml.parse(raw) as Record<string, unknown>;
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
  // scheduledAt is the dedicated "hide until date" field
  const scheduledAt = frontmatter.scheduledAt as string | undefined;
  const date = frontmatter.date as string | undefined;
  const target = scheduledAt ?? date;
  if (!target) {
    return false;
  }
  return new Date(target).getTime() > Date.now();
}
