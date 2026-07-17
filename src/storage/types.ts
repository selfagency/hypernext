export interface StorageProvider {
  delete(slug: string): Promise<void>;
  exists(slug: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  read(slug: string): Promise<string>;
  write(slug: string, content: string): Promise<void>;
}
