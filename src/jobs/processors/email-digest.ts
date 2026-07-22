export async function processEmailDigest(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { getEm } = await import("../../database/index.js");
  const { Subscriber } = await import("../../database/entities/subscriber.js");
  const { sendWeeklyDigest } = await import("../../federation/email-tasks.js");

  const em = getEm();
  const sub = await em.findOne(Subscriber, {
    id: payload.subscriberId as string,
  });
  if (sub) {
    await sendWeeklyDigest(
      config as never,
      sub,
      payload.docs as { slug: string; title: string; description?: string }[]
    );
  }
}
