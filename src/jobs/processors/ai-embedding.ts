export async function processAiEmbedding(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { generateAndStoreEmbedding } = await import(
    "../../federation/ai-tasks.js"
  );
  await generateAndStoreEmbedding(
    config as never,
    payload.slug as string,
    payload.rawMdx as string
  );
}
