import fs from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./types.js";

const LEADING_SLASH_REGEX = /^\/+/;
const BACKSLASH_REGEX = /\\/g;
const MDX_EXTENSION_REGEX = /\.mdx$/;

function resolveSafeSlug(basePath: string, slug: string): string {
  const normalized = path.normalize(slug).replace(LEADING_SLASH_REGEX, "");
  if (normalized.includes("..")) {
    throw new Error(`Path traversal blocked: ${slug}`);
  }
  const resolved = path.resolve(basePath, normalized);
  if (!resolved.startsWith(path.resolve(basePath))) {
    throw new Error(`Path traversal blocked: ${slug}`);
  }
  return resolved;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  read(slug: string): Promise<string> {
    const filePath = resolveSafeSlug(this.basePath, `${slug}.mdx`);
    return fs.readFile(filePath, "utf-8");
  }

  async write(slug: string, content: string): Promise<void> {
    const filePath = resolveSafeSlug(this.basePath, `${slug}.mdx`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async delete(slug: string): Promise<void> {
    const filePath = resolveSafeSlug(this.basePath, `${slug}.mdx`);
    await fs.unlink(filePath);
  }

  async exists(slug: string): Promise<boolean> {
    const filePath = resolveSafeSlug(this.basePath, `${slug}.mdx`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const searchPath = prefix
      ? resolveSafeSlug(this.basePath, prefix)
      : this.basePath;
    const files: string[] = [];
    await this.walk(searchPath, files);
    return files
      .map((file) => path.relative(this.basePath, file))
      .map((relative) => relative.replace(BACKSLASH_REGEX, "/"))
      .filter((relative) => relative.endsWith(".mdx"))
      .map((relative) => relative.replace(MDX_EXTENSION_REGEX, ""))
      .sort();
  }

  private async walk(dir: string, files: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(fullPath, files);
      } else {
        files.push(fullPath);
      }
    }
  }
}
