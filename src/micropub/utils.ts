import { createStorage } from "../storage/index.js";
import type { HypernextConfig } from "../types/config.js";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function buildFrontmatter(
  properties: Record<string, unknown[]>
): string {
  const lines: string[] = ["---"];
  const title = (properties.name?.[0] as string) ?? "Untitled";
  const date = new Date().toISOString().split("T")[0];
  const tags = (properties.category as string[]) ?? [];

  lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
  lines.push(`date: ${date}`);
  lines.push("type: post");

  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
  }

  lines.push("---");
  return lines.join("\n");
}

export function convertContent(properties: Record<string, unknown[]>): string {
  const content = properties.content?.[0] as string | undefined;
  if (!content) {
    return "";
  }
  return content;
}

export async function writePost(
  config: HypernextConfig,
  properties: Record<string, unknown[]>
): Promise<string> {
  const title = (properties.name?.[0] as string) ?? "untitled";
  const slug = slugify(title);
  const frontmatter = buildFrontmatter(properties);
  const body = convertContent(properties);
  const mdx = `${frontmatter}\n\n${body}`;

  const storage = createStorage(config);
  const fullSlug = `blog/${slug}`;
  await storage.write(fullSlug, mdx);

  return fullSlug;
}
