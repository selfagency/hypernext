import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageS3Config } from "../types/config.js";
import type { StorageProvider } from "./types.js";

const LEADING_SLASH_REGEX = /^\/+/;
const MDX_EXTENSION_REGEX = /\.mdx$/;

function sanitizeKey(key: string): string {
  const trimmed = key.replace(LEADING_SLASH_REGEX, "");
  if (trimmed.includes("..")) {
    throw new Error(`Path traversal blocked: ${key}`);
  }
  return trimmed;
}

function buildPrefix(prefix: string, searchPrefix: string): string {
  if (prefix) {
    return searchPrefix ? `${prefix}/${searchPrefix}/` : `${prefix}/`;
  }
  return searchPrefix ? `${searchPrefix}/` : "";
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: StorageS3Config) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucket = config.bucket;
    this.prefix = config.prefix ? sanitizeKey(config.prefix) : "";
  }

  private keyForSlug(slug: string): string {
    const sanitized = sanitizeKey(slug);
    return this.prefix ? `${this.prefix}/${sanitized}.mdx` : `${sanitized}.mdx`;
  }

  async read(slug: string): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.keyForSlug(slug) })
    );
    const body = await response.Body?.transformToString("utf-8");
    if (body === undefined) {
      throw new Error(`Empty body for ${slug}`);
    }
    return body;
  }

  async write(slug: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyForSlug(slug),
        Body: content,
        ContentType: "text/markdown",
      })
    );
  }

  async delete(slug: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.keyForSlug(slug),
      })
    );
  }

  async exists(slug: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.keyForSlug(slug),
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const searchPrefix = prefix ? sanitizeKey(prefix) : "";
    const fullPrefix = buildPrefix(this.prefix, searchPrefix);

    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const object of response.Contents ?? []) {
        if (object.Key?.endsWith(".mdx")) {
          keys.push(object.Key.replace(MDX_EXTENSION_REGEX, ""));
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys.sort();
  }
}
