export async function processEmailVerification(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { processNewSubscription } = await import(
    "../../federation/email-tasks.js"
  );
  await processNewSubscription(
    config as never,
    payload as { email: string; frequency: string }
  );
}
