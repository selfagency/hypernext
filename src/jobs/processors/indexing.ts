export async function processIndexing(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const dbPath = (payload.__dbPath as string) ?? ":memory:";
  await initOrm(dbPath);

  const config = payload.__config as Record<string, unknown> | undefined;

  const { indexDocument } = await import("../../indexer/index.js");
  await indexDocument(
    payload.slug as string,
    payload.rawMdx as string,
    config as never
  );

  // If AI is enabled, enqueue embedding generation
  const agent = config?.agent as Record<string, unknown> | undefined;
  const ai = config?.ai as Record<string, unknown> | undefined;
  if (agent?.enabled && ai?.enabled) {
    const { schedule } = await import("../queue.js");
    await schedule("ai-embedding", {
      slug: payload.slug,
      rawMdx: payload.rawMdx,
      __config: config,
    });
  }

  // If IPFS is enabled, enqueue pinning
  const ipfs = config?.ipfs as Record<string, unknown> | undefined;
  if (ipfs?.enabled) {
    const { schedule } = await import("../queue.js");
    await schedule("ipfs-pinning", {
      slug: payload.slug,
      __config: config,
    });
  }
}
