export async function processIpfsPinning(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { pinDoc } = await import("../../storage/ipfs.js");
  await pinDoc(config as never, payload.slug as string);
}
