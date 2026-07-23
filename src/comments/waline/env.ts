import type {
  HypernextConfig,
  WalineCommentConfig,
} from "../../types/config.js";

/**
 * Maps WalineCommentConfig to environment variables for the Waline server process.
 */
export function walineConfigToEnv(
  config: HypernextConfig,
  jwtToken: string
): Record<string, string> {
  const waline = config.comments?.waline;
  if (!waline) {
    return {};
  }

  const env: Record<string, string> = {};

  // Site info
  env.SITE_URL = config.site?.canonicalBase || "http://localhost:8080";
  env.SITE_NAME = config.site?.meta?.title || "Hypernext";
  env.LOGIN = waline?.auth?.login || "disable";

  // Storage
  mapStorage(waline as NonNullable<typeof waline>, env);

  // JWT token for admin
  env.JWT_TOKEN = jwtToken;

  // Notifications
  mapNotifications(waline as NonNullable<typeof waline>, env);

  // Anti-spam
  mapAntiSpam(waline as NonNullable<typeof waline>, env);

  // Markdown
  mapMarkdown(waline as NonNullable<typeof waline>, env);

  // OAuth
  mapOAuth(waline as NonNullable<typeof waline>, env);

  return env;
}

function mapStorage(
  waline: WalineCommentConfig,
  env: Record<string, string>
): void {
  if (waline.storage?.type !== "sqlite") {
    return;
  }
  env.SQLITE_PATH = waline.storage.path;
}

function mapNotifications(
  waline: WalineCommentConfig,
  env: Record<string, string>
): void {
  if (!waline?.notifications) {
    return;
  }
  // Email
  if (waline.notifications.email) {
    const email = waline.notifications.email;
    env.SMTP_HOST = email.host;
    env.SMTP_PORT = String(email.port);
    env.SMTP_SECURE = email.secure ? "true" : "false";
    env.SMTP_USER = email.user;
    env.SMTP_PASS = email.password;
    env.SENDER_EMAIL = email.senderEmail;
    if (email.senderName) {
      env.SENDER_NAME = email.senderName;
    }
  }

  // Webhook
  if (waline.notifications.webhook) {
    env.WEBHOOK = waline.notifications.webhook;
  }

  // Discord
  if (waline.notifications.discord) {
    env.DISCORD_WEBHOOK = waline.notifications.discord;
  }

  // Telegram
  if (waline.notifications.telegram) {
    const tg = waline.notifications.telegram;
    env.TG_BOT_TOKEN = tg.botToken;
    env.TG_CHAT_ID = tg.chatId;
  }
}

function mapAntiSpam(
  waline: WalineCommentConfig,
  env: Record<string, string>
): void {
  if (!waline?.antiSpam) {
    return;
  }

  const spam = waline.antiSpam;
  env.AKISMET_KEY = spam.akismet ? "true" : "false";
  env.IPQPS = String(spam.ipqps);
  env.COMMENT_AUDIT = spam.audit ? "true" : "false";
  if (spam.secureDomains.length > 0) {
    env.SECURE_DOMAINS = spam.secureDomains.join(",");
  }
}

function mapMarkdown(
  waline: WalineCommentConfig,
  env: Record<string, string>
): void {
  if (!waline?.markdown) {
    return;
  }

  const md = waline.markdown;
  env.MARKDOWN_HIGHLIGHT = md.highlight ? "true" : "false";
  env.MARKDOWN_EMOJI = md.emoji ? "true" : "false";
  if (md.tex) {
    env.MARKDOWN_TEX = md.tex;
  }
}

function mapOAuth(
  waline: WalineCommentConfig,
  env: Record<string, string>
): void {
  if (!waline?.oauth?.gateway) {
    return;
  }

  env.OAUTH_URL = waline.oauth.gateway;
  if (waline.oauth.github?.clientId) {
    env.GITHUB_ID = waline.oauth.github.clientId;
    env.GITHUB_SECRET = waline.oauth.github.clientSecret;
  }
}
