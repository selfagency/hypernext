export async function processEmailSend(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const { processContactForm, sendInstantNotification, sendTestEmail } =
    await import("../../federation/email-tasks.js");

  const type = payload.type as string;

  if (type === "instant") {
    const data = payload.data as Record<string, unknown>;
    const { getEm } = await import("../../database/index.js");
    const { Subscriber } = await import(
      "../../database/entities/subscriber.js"
    );
    const em = getEm();
    const sub = await em.findOne(Subscriber, { email: data.email as string });
    if (sub) {
      await sendInstantNotification(config as never, sub, {
        slug: data.slug as string,
        title: data.title as string,
        html: data.html as string | undefined,
      });
    }
  } else if (type === "contact") {
    await processContactForm(
      config as never,
      payload.data as {
        captchaSolution?: string;
        captchaToken?: string;
        email: string;
        ip: string;
        message: string;
        name: string;
        userAgent?: string;
      }
    );
  } else if (type === "test") {
    await sendTestEmail(
      config as never,
      String((payload.data as Record<string, unknown>).to)
    );
  }
}
