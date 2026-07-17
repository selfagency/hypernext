import { create } from "kubo-rpc-client";
import { getDocBySlug, getEm } from "../database/index.js";
import type { HypernextConfig, IpfsConfig } from "../types/config.js";
import type { StorageProvider } from "./types.js";

let clientInstance: ReturnType<typeof create> | null = null;

function getClient(config: IpfsConfig): ReturnType<typeof create> {
  if (!clientInstance) {
    clientInstance = create({ url: config.apiEndpoint });
  }
  return clientInstance;
}

export async function pinToIpfs(
  content: string | Uint8Array,
  config: IpfsConfig
): Promise<string> {
  const ipfs = getClient(config);
  const { cid } = await ipfs.add(content);
  if (config.pinning) {
    await ipfs.pin.add(cid);
  }
  return cid.toString();
}

export async function readFromIpfs(
  cid: string,
  config: IpfsConfig
): Promise<string> {
  const ipfs = getClient(config);
  const chunks: Uint8Array[] = [];
  for await (const chunk of ipfs.cat(cid)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function getDocCids(
  slug: string
): Promise<{ contentCid: string | null; htmlCid: string | null }> {
  const doc = await getDocBySlug(slug);
  if (!doc) {
    throw new Error(`Document not found: ${slug}`);
  }
  return {
    contentCid: (doc.contentCid as string | null) ?? null,
    htmlCid: (doc.htmlCid as string | null) ?? null,
  };
}

export async function updateDocCids(
  slug: string,
  cids: Partial<{ contentCid: string; htmlCid: string }>
): Promise<void> {
  const em = getEm();
  const existing = await em.findOne("DocMeta", { slug });
  if (existing) {
    em.assign(existing, cids);
    await em.flush();
  }
}

export async function pinDoc(
  config: HypernextConfig,
  slug: string
): Promise<{ contentCid: string; htmlCid: string }> {
  if (!config.ipfs?.enabled) {
    throw new Error("IPFS is not enabled in configuration");
  }

  const ipfsConfig = config.ipfs;
  const doc = await getDocBySlug(slug);
  if (!doc) {
    throw new Error(`Document not found: ${slug}`);
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  const contentCid = await pinToIpfs(rawMdx, ipfsConfig);

  let htmlCid: string | undefined;
  if (ipfsConfig.cacheHtml) {
    const { parseToIR, resolveComponentNodes } = await import(
      "../parser/pipeline.js"
    );
    const { renderHTML } = await import("../renderers/html.js");
    const result = parseToIR(rawMdx, slug);
    await resolveComponentNodes(result.ir, config, slug);
    const html = renderHTML(result, config, slug);
    htmlCid = await pinToIpfs(html, ipfsConfig);
  }

  await updateDocCids(slug, {
    contentCid,
    ...(htmlCid === undefined ? {} : { htmlCid }),
  });

  return { contentCid, htmlCid: htmlCid ?? "" };
}

export class IPFSStorageProvider implements StorageProvider {
  private readonly config: IpfsConfig;

  constructor(config: IpfsConfig) {
    this.config = config;
  }

  async read(slug: string): Promise<string> {
    const doc = await getDocBySlug(slug);
    if (!doc) {
      throw new Error(`Document not found: ${slug}`);
    }
    const cid = (doc.contentCid as string | undefined) ?? "";
    if (!cid) {
      throw new Error(`No content CID for: ${slug}`);
    }
    return readFromIpfs(cid, this.config);
  }

  async write(slug: string, content: string): Promise<void> {
    const cid = await pinToIpfs(content, this.config);
    await updateDocCids(slug, { contentCid: cid });
  }

  async delete(slug: string): Promise<void> {
    await updateDocCids(slug, { contentCid: null });
  }

  async exists(slug: string): Promise<boolean> {
    const doc = await getDocBySlug(slug);
    return !!doc?.contentCid;
  }

  async list(prefix?: string): Promise<string[]> {
    const { listDocSlugs } = await import("../database/index.js");
    const slugs = await listDocSlugs();
    if (prefix) {
      return slugs.filter((s) => s.startsWith(prefix));
    }
    return slugs;
  }
}
