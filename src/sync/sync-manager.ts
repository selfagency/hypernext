import fs from "node:fs";
import path from "node:path";
import { getEm } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

type SyncProgress = (msg: string) => void;

interface RemoteDoc {
  mtime?: string;
  rawMdx?: string;
  slug: string;
}

const MDX_EXT_REGEX = /\.mdx$/;
const BACKSLASH_REGEX = /\\/g;

async function pushLocalChanges(
  localMap: Map<string, number>,
  remoteDocs: RemoteDoc[],
  remoteUrl: string,
  remoteToken: string,
  contentDir: string,
  onProgress: SyncProgress
): Promise<void> {
  for (const [slug, localMtime] of localMap) {
    const remote = remoteDocs.find((r) => r.slug === slug);
    const remoteMtime = remote?.mtime ? new Date(remote.mtime).getTime() : 0;

    if (!remote || localMtime > remoteMtime) {
      onProgress(`Pushing ${slug} to remote...`);
      const filePath = path.join(contentDir, `${slug}.mdx`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        await fetch(`${remoteUrl}/api/v1/docs/${slug}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${remoteToken}`,
            "Content-Type": "text/plain",
          },
          body: content,
        });
      }
    }
  }
}

async function pullRemoteChanges(
  localMap: Map<string, number>,
  remoteDocs: RemoteDoc[],
  remoteUrl: string,
  remoteToken: string,
  contentDir: string,
  onProgress: SyncProgress
): Promise<void> {
  for (const remote of remoteDocs) {
    const localMtime = localMap.get(remote.slug) ?? 0;
    const remoteMtime = remote.mtime ? new Date(remote.mtime).getTime() : 0;

    if (!localMap.has(remote.slug) || remoteMtime > localMtime) {
      onProgress(`Pulling ${remote.slug} from remote...`);
      const docRes = await fetch(`${remoteUrl}/api/v1/docs/${remote.slug}`, {
        headers: { Authorization: `Bearer ${remoteToken}` },
      });
      if (docRes.ok) {
        const docData = (await docRes.json()) as { rawMdx?: string };
        const localFilePath = path.join(contentDir, `${remote.slug}.mdx`);
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, docData.rawMdx ?? "");
      }
    }
  }
}

export async function pushToRemote(
  config: HypernextConfig,
  onProgress: SyncProgress
): Promise<void> {
  const remote = config.remote;
  if (!remote?.enabled) {
    throw new Error("Remote server not configured");
  }

  const contentDir = path.resolve(config.storage.local?.path ?? "content");

  if (!fs.existsSync(contentDir)) {
    throw new Error("No content directory found");
  }

  const files = fs.readdirSync(contentDir, { recursive: true }) as string[];
  const mdxFiles = files.filter(
    (f) => f.endsWith(".mdx") && !f.startsWith(".")
  );

  for (const file of mdxFiles) {
    const slug = file.replace(MDX_EXT_REGEX, "").replace(BACKSLASH_REGEX, "/");
    onProgress(`Pushing ${slug}...`);

    const filePath = path.join(contentDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    const res = await fetch(`${remote.url}/api/v1/docs/${slug}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${remote.token}`,
        "Content-Type": "text/plain",
      },
      body: content,
    });

    if (!res.ok) {
      console.error(`Failed to push ${slug}: ${res.status}`);
    }
  }

  onProgress("Push complete.");
}

export async function syncTwoWay(
  config: HypernextConfig,
  onProgress: SyncProgress
): Promise<void> {
  const remote = config.remote;
  if (!remote?.enabled) {
    throw new Error("Remote server not configured");
  }

  const contentDir = path.resolve(config.storage.local?.path ?? "content");

  // 1. Fetch remote index
  onProgress("Fetching remote index...");
  const indexRes = await fetch(`${remote.url}/api/v1/docs?limit=1000`, {
    headers: { Authorization: `Bearer ${remote.token}` },
  });
  const indexData = (await indexRes.json()) as { docs: RemoteDoc[] };
  const remoteDocs = indexData.docs ?? [];

  // 2. Get local index
  onProgress("Reading local index...");
  const em = getEm();
  const localDocs = await em.find(
    "DocMeta",
    {},
    { fields: ["slug", "updatedAt"] }
  );

  const localMap = new Map<string, number>();
  for (const doc of localDocs) {
    const d = doc as Record<string, unknown>;
    const slug = d.slug as string;
    const updatedAt = d.updatedAt as string | undefined;
    if (slug) {
      localMap.set(slug, updatedAt ? new Date(updatedAt).getTime() : 0);
    }
  }

  // 3. Push local changes
  await pushLocalChanges(
    localMap,
    remoteDocs,
    remote.url,
    remote.token,
    contentDir,
    onProgress
  );

  // 4. Pull remote changes
  await pullRemoteChanges(
    localMap,
    remoteDocs,
    remote.url,
    remote.token,
    contentDir,
    onProgress
  );

  onProgress("Sync complete.");
}
