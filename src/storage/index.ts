import type { HypernextConfig } from "../types/config.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";
import type { StorageProvider } from "./types.js";

export type { StorageProvider } from "./types.js";

let storageInstance: StorageProvider | null = null;

export function createStorage(config: HypernextConfig): StorageProvider {
  if (storageInstance) {
    return storageInstance;
  }

  if (config.storage.type === "s3") {
    if (!config.storage.s3) {
      throw new Error("Missing storage.s3 configuration");
    }
    storageInstance = new S3StorageProvider(config.storage.s3);
  } else if (config.storage.type === "local") {
    if (!config.storage.local) {
      throw new Error("Missing storage.local configuration");
    }
    storageInstance = new LocalStorageProvider(config.storage.local.path);
  } else {
    throw new Error(`Unsupported storage type: ${config.storage.type}`);
  }

  return storageInstance;
}

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    throw new Error("Storage not initialized. Call createStorage() first.");
  }
  return storageInstance;
}

export function writeStorage(slug: string, content: string): Promise<void> {
  return getStorage().write(slug, content);
}

export function deleteStorage(slug: string): Promise<void> {
  return getStorage().delete(slug);
}
