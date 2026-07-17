import type { HypernextConfig } from "../types/config.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";

export type { StorageProvider } from "./types.js";

export function createStorage(config: HypernextConfig): StorageProvider {
  if (config.storage.type === "s3") {
    if (!config.storage.s3) {
      throw new Error("Missing storage.s3 configuration");
    }
    return new S3StorageProvider(config.storage.s3);
  }

  if (config.storage.type === "local") {
    if (!config.storage.local) {
      throw new Error("Missing storage.local configuration");
    }
    return new LocalStorageProvider(config.storage.local.path);
  }

  throw new Error(`Unsupported storage type: ${config.storage.type}`);
}
