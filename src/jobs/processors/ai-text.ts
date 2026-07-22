export async function processAiText(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const op = payload.op as string;
  const slug = payload.slug as string;
  const rawMdx = payload.rawMdx as string;

  const { suggestTags, generateSeoMeta, generateSummary } = await import(
    "../../federation/ai-tasks.js"
  );

  if (op === "suggestTags") {
    const tags = await suggestTags(config as never, rawMdx, []);
    return { op, slug, tags };
  }

  if (op === "generateSeoMeta") {
    const description = await generateSeoMeta(config as never, rawMdx);
    return { op, slug, description };
  }

  if (op === "summary") {
    const summary = await generateSummary(config as never, rawMdx);
    return { op, slug, summary };
  }

  throw new Error(`Unknown ai-text operation: ${op}`);
}
